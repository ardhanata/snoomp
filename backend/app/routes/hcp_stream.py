import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.security import require_viewer, require_editor
from app.models.hcp import HcpTenant
from app.models.hcp_stream import (
    HcpNodeMetric,
    HcpSyntheticProbeResult,
    HcpStreamAggregate,
    HcpLogIngestJob,
)
from app.services.hcp_stream_service import (
    fetch_hcp_node_statistics,
    fetch_hcp_services_statistics,
    run_all_synthetic_probes,
    run_synthetic_namespace_probe,
    start_access_log_ingest_job,
    check_and_process_log_ingest_job,
    get_stream_overview,
    get_stream_investigation_insights,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hcp/{hcp_id}/stream", tags=["HCP Data Stream"])


def _get_hcp(hcp_id: str, db: Session) -> HcpTenant:
    hcp = db.query(HcpTenant).filter(HcpTenant.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP endpoint not found")
    return hcp


@router.get("/overview", dependencies=[Depends(require_viewer)])
async def get_hcp_stream_overview(
    hcp_id: str,
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
):
    """
    Platform overview data stream: total requests/sec, 2xx/4xx/5xx error rates,
    p50/p95 latency, node cluster health, synthetic probe pass rate, and flagged tenants.
    """
    hcp = _get_hcp(hcp_id, db)
    return get_stream_overview(hcp, db, hours=hours)


@router.get("/nodes", dependencies=[Depends(require_viewer)])
async def get_hcp_nodes_telemetry(
    hcp_id: str,
    refresh: bool = Query(False),
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
):
    """
    Node health telemetry for nodes 101-104:
    CPU user/system %, I/O wait %, open connections, and front-end bytes read/written per second.
    """
    hcp = _get_hcp(hcp_id, db)

    latest_data = None
    if refresh:
        try:
            latest_data = await fetch_hcp_node_statistics(hcp, db)
        except Exception as e:
            logger.warning(f"Live node refresh failed for HCP {hcp_id}: {e}")

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
    records = (
        db.query(HcpNodeMetric)
        .filter(HcpNodeMetric.hcp_id == hcp_id, HcpNodeMetric.timestamp >= cutoff)
        .order_by(HcpNodeMetric.timestamp.desc())
        .limit(200)
        .all()
    )

    latest_by_node: Dict[int, Dict[str, Any]] = {}
    for r in records:
        if r.node_number not in latest_by_node:
            latest_by_node[r.node_number] = r.to_dict()

    nodes_list = sorted(latest_by_node.values(), key=lambda n: n["node_number"])

    # If no recorded metrics yet, trigger an initial fetch
    if not nodes_list and not refresh:
        try:
            latest_data = await fetch_hcp_node_statistics(hcp, db)
            nodes_list = latest_data.get("nodes", [])
        except Exception as e:
            logger.warning(f"Initial node fetch failed for HCP {hcp_id}: {e}")

    total_mb_sec = round(sum(n.get("frontend_mb_per_sec", 0.0) for n in nodes_list), 2)
    total_conns = sum(n.get("total_connections", 0) for n in nodes_list)
    avg_cpu = round(sum(n.get("cpu_total", 0.0) for n in nodes_list) / max(1, len(nodes_list)), 2)
    avg_io_wait = round(sum(n.get("io_wait", 0.0) for n in nodes_list) / max(1, len(nodes_list)), 2)

    return {
        "hcp_id": hcp.id,
        "total_nodes": len(nodes_list),
        "cluster_frontend_mb_per_sec": total_mb_sec,
        "cluster_total_connections": total_conns,
        "cluster_avg_cpu_percent": avg_cpu,
        "cluster_avg_io_wait_percent": avg_io_wait,
        "nodes": nodes_list,
        "history": [r.to_dict() for r in records[:60]],
    }


@router.post("/nodes/poll", dependencies=[Depends(require_editor)])
async def poll_hcp_nodes_now(hcp_id: str, db: Session = Depends(get_db)):
    """
    Forces an immediate live poll of /mapi/nodes/statistics.
    """
    hcp = _get_hcp(hcp_id, db)
    try:
        data = await fetch_hcp_node_statistics(hcp, db)
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed polling node statistics: {e}")


@router.get("/services", dependencies=[Depends(require_viewer)])
async def get_hcp_services_telemetry(hcp_id: str, db: Session = Depends(get_db)):
    """
    Returns background service execution telemetry (e.g. StorageTieringService)
    and objects examined per second.
    """
    hcp = _get_hcp(hcp_id, db)
    try:
        services = await fetch_hcp_services_statistics(hcp)
        return {"services": services}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed querying service statistics: {e}")


@router.get("/tenants", dependencies=[Depends(require_viewer)])
def get_hcp_tenant_streams(
    hcp_id: str,
    tenant_name: Optional[str] = None,
    namespace_name: Optional[str] = None,
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
):
    """
    Per-tenant and per-namespace request streams:
    requests per second, share of 2xx, 4xx, 5xx responses, p50 and p95 latency, MB/s in and out.
    """
    hcp = _get_hcp(hcp_id, db)
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    query = db.query(HcpStreamAggregate).filter(
        HcpStreamAggregate.hcp_id == hcp.id,
        HcpStreamAggregate.interval_start >= cutoff,
    )
    if tenant_name:
        query = query.filter(HcpStreamAggregate.tenant_name == tenant_name.strip())
    if namespace_name:
        query = query.filter(HcpStreamAggregate.namespace_name == namespace_name.strip())

    aggregates = query.all()

    by_ns: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for a in aggregates:
        key = (a.tenant_name, a.namespace_name)
        if key not in by_ns:
            by_ns[key] = {
                "tenant_name": a.tenant_name,
                "namespace_name": a.namespace_name,
                "total_requests": 0,
                "count_2xx": 0,
                "count_4xx": 0,
                "count_5xx": 0,
                "bytes_in": 0.0,
                "bytes_out": 0.0,
                "durations": [],
            }
        item = by_ns[key]
        item["total_requests"] += a.requests_count
        if a.status_class == "2xx":
            item["count_2xx"] += a.requests_count
        elif a.status_class == "4xx":
            item["count_4xx"] += a.requests_count
        elif a.status_class == "5xx":
            item["count_5xx"] += a.requests_count
        item["bytes_in"] += a.bytes_in
        item["bytes_out"] += a.bytes_out
        item["durations"].append(a.duration_ms_avg)

    streams_list = []
    for (t_name, ns_name), d in by_ns.items():
        tot = max(1, d["total_requests"])
        p2 = round((d["count_2xx"] / tot) * 100.0, 1)
        p4 = round((d["count_4xx"] / tot) * 100.0, 1)
        p5 = round((d["count_5xx"] / tot) * 100.0, 1)
        durations = sorted(d["durations"])
        p50 = durations[len(durations) // 2] if durations else 0.0
        p95_idx = int(len(durations) * 0.95)
        p95 = durations[min(p95_idx, len(durations) - 1)] if durations else 0.0

        streams_list.append({
            "tenant_name": t_name,
            "namespace_name": ns_name,
            "total_requests": d["total_requests"],
            "requests_per_sec": round(d["total_requests"] / max(1, hours * 3600), 2),
            "share_2xx_percent": p2,
            "share_4xx_percent": p4,
            "share_5xx_percent": p5,
            "p50_latency_ms": round(p50, 1),
            "p95_latency_ms": round(p95, 1),
            "mb_in": round(d["bytes_in"] / (1024 * 1024), 2),
            "mb_out": round(d["bytes_out"] / (1024 * 1024), 2),
        })

    streams_list.sort(key=lambda s: s["total_requests"], reverse=True)
    return {"streams": streams_list}


@router.get("/probes", dependencies=[Depends(require_viewer)])
def get_hcp_probes_history(
    hcp_id: str,
    tenant_name: Optional[str] = None,
    namespace_name: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Returns synthetic probe execution records and pass rates.
    """
    hcp = _get_hcp(hcp_id, db)
    query = db.query(HcpSyntheticProbeResult).filter(HcpSyntheticProbeResult.hcp_id == hcp.id)

    if tenant_name:
        query = query.filter(HcpSyntheticProbeResult.tenant_name == tenant_name.strip())
    if namespace_name:
        query = query.filter(HcpSyntheticProbeResult.namespace_name == namespace_name.strip())

    probes = query.order_by(HcpSyntheticProbeResult.timestamp.desc()).limit(limit).all()
    results = [p.to_dict() for p in probes]

    pass_count = sum(1 for p in results if p["success"])
    pass_rate = round((pass_count / max(1, len(results))) * 100.0, 1)

    return {
        "total_probes": len(results),
        "pass_rate_percent": pass_rate,
        "probes": results,
    }


@router.post("/probes/run", dependencies=[Depends(require_editor)])
async def trigger_hcp_probes_now(
    hcp_id: str,
    tenant_name: Optional[str] = None,
    namespace_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Triggers an immediate synthetic probe execution against namespaces.
    """
    hcp = _get_hcp(hcp_id, db)
    if tenant_name and namespace_name:
        res = await run_synthetic_namespace_probe(hcp, tenant_name, namespace_name, db)
        return {"single_probe": res}

    summary = await run_all_synthetic_probes(hcp, db)
    return summary


@router.get("/investigation", dependencies=[Depends(require_viewer)])
def get_hcp_investigation(
    hcp_id: str,
    hours: int = Query(48, ge=1, le=168),
    db: Session = Depends(get_db),
):
    """
    Access log investigation insights:
    top client IPs by requests and errors, 4xx/413 breakdown by user/path,
    and slowest transfers with throughput (MB/s).
    """
    hcp = _get_hcp(hcp_id, db)
    return get_stream_investigation_insights(hcp, db, hours=hours)


@router.post("/logs/prepare", dependencies=[Depends(require_editor)])
async def trigger_hcp_log_prepare(hcp_id: str, db: Session = Depends(get_db)):
    """
    Initiates asynchronous access log preparation via POST /mapi/logs/prepare.
    """
    hcp = _get_hcp(hcp_id, db)
    job = await start_access_log_ingest_job(hcp, db)
    return job.to_dict()


@router.get("/logs/jobs/{job_id}", dependencies=[Depends(require_viewer)])
async def get_hcp_log_job_status(hcp_id: str, job_id: str, db: Session = Depends(get_db)):
    """
    Checks the status of an ongoing log ingest job. If HCP has finished preparation,
    streams and parses access logs into stream aggregates.
    """
    hcp = _get_hcp(hcp_id, db)
    res = await check_and_process_log_ingest_job(hcp, job_id, db)
    return res
