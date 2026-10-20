import asyncio
import io
import logging
import re
import tarfile
import tempfile
import time
import zipfile
import datetime
from typing import Any, Dict, List, Optional, Tuple
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.hcp import HcpTenant
from app.models.hcp_stream import (
    HcpNodeMetric,
    HcpSyntheticProbeResult,
    HcpStreamAggregate,
    HcpLogIngestJob,
)
from app.services.hcp_service import generate_hcp_auth_header

logger = logging.getLogger(__name__)


def derive_namespace_endpoint(tenant_name: str, namespace_name: str, cluster_host: str, port: int = 443) -> str:
    """
    Constructs the standard HCP S3/REST HTTP URL for a namespace.
    Translates 'admin.hcp.corp.internal' -> 'tenant.hcp.corp.internal'.
    """
    clean_host = (cluster_host or "").strip()
    base_host = clean_host[6:] if clean_host.lower().startswith("admin.") else clean_host
    clean_tenant = tenant_name.strip()
    clean_ns = namespace_name.strip()
    port_suffix = f":{port}" if port and port not in (80, 443) else ""
    return f"https://{clean_ns}.{clean_tenant}.{base_host}{port_suffix}"


async def fetch_hcp_node_statistics(hcp: HcpTenant, db: Session) -> Dict[str, Any]:
    """
    Queries /mapi/nodes/statistics on the HCP cluster and stores historical node metrics.
    Captures CPU user/system %, I/O wait, open connections, and front-end read/write bytes/sec.
    """
    auth = generate_hcp_auth_header(hcp.username, hcp.password)
    headers = {
        "Authorization": auth,
        "Accept": "application/json",
    }
    url = f"https://{hcp.host}:{hcp.port}/mapi/nodes/statistics"

    async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=8.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code in (401, 403):
            raise PermissionError(f"HCP authentication failed ({resp.status_code}). Verify cluster admin credentials.")
        resp.raise_for_status()
        data = resp.json()

    raw_nodes = data.get("nodes", {}).get("node", [])
    if isinstance(raw_nodes, dict):
        raw_nodes = [raw_nodes]

    now = datetime.datetime.utcnow()
    nodes_summary = []
    total_frontend_read = 0.0
    total_frontend_written = 0.0
    total_conns = 0

    for item in raw_nodes:
        node_num = int(item.get("nodeNumber", 0))
        fe_ips = item.get("frontendIpAddresses", {}).get("ipAddress", [])
        fe_ip = fe_ips[0] if fe_ips else None
        be_ip = item.get("backendIpAddress")

        cpu_u = float(item.get("cpuUser", 0.0))
        cpu_s = float(item.get("cpuSystem", 0.0))
        cpu_tot = round(cpu_u + cpu_s, 2)
        io_w = float(item.get("ioWait", 0.0))
        swap = float(item.get("swapOut", 0.0))

        http_conn = int(item.get("openHttpConnections", 0))
        https_conn = int(item.get("openHttpsConnections", 0))
        max_http = int(item.get("maxHttpConnections", 255))
        max_https = int(item.get("maxHttpsConnections", 255))

        fe_read = float(item.get("frontEndBytesRead", 0.0))
        fe_written = float(item.get("frontEndBytesWritten", 0.0))
        be_read = float(item.get("backEndBytesRead", 0.0))
        be_written = float(item.get("backEndBytesWritten", 0.0))

        metric_record = HcpNodeMetric(
            hcp_id=hcp.id,
            node_number=node_num,
            frontend_ip=fe_ip,
            backend_ip=be_ip,
            cpu_user=cpu_u,
            cpu_system=cpu_s,
            cpu_total=cpu_tot,
            io_wait=io_w,
            swap_out=swap,
            open_http_connections=http_conn,
            open_https_connections=https_conn,
            max_http_connections=max_http,
            max_https_connections=max_https,
            frontend_bytes_read=fe_read,
            frontend_bytes_written=fe_written,
            backend_bytes_read=be_read,
            backend_bytes_written=be_written,
            timestamp=now,
        )
        db.add(metric_record)

        total_frontend_read += fe_read
        total_frontend_written += fe_written
        total_conns += (http_conn + https_conn)

        nodes_summary.append(metric_record.to_dict())

    db.commit()

    # Sort nodes by node_number ascending
    nodes_summary.sort(key=lambda n: n["node_number"])

    total_mb_sec = round((total_frontend_read + total_frontend_written) / (1024 * 1024), 2)
    avg_cpu = round(sum(n["cpu_total"] for n in nodes_summary) / max(1, len(nodes_summary)), 2)
    avg_io_wait = round(sum(n["io_wait"] for n in nodes_summary) / max(1, len(nodes_summary)), 2)

    return {
        "timestamp": now.isoformat(),
        "total_nodes": len(nodes_summary),
        "cluster_frontend_mb_per_sec": total_mb_sec,
        "cluster_total_connections": total_conns,
        "cluster_avg_cpu_percent": avg_cpu,
        "cluster_avg_io_wait_percent": avg_io_wait,
        "nodes": nodes_summary,
    }


async def fetch_hcp_services_statistics(hcp: HcpTenant) -> List[Dict[str, Any]]:
    """
    Queries /mapi/services/statistics to inspect background service execution,
    tiering throughput, and objects examined per second.
    """
    auth = generate_hcp_auth_header(hcp.username, hcp.password)
    headers = {"Authorization": auth, "Accept": "application/json"}
    url = f"https://{hcp.host}:{hcp.port}/mapi/services/statistics"

    async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=8.0) as client:
        resp = await client.get(url, headers=headers)
        if not resp.is_success:
            return []
        data = resp.json()

    raw_services = data.get("services", {}).get("service", [])
    if isinstance(raw_services, dict):
        raw_services = [raw_services]

    result = []
    for s in raw_services:
        result.append({
            "name": s.get("name", "Unknown"),
            "state": s.get("state", "UNKNOWN"),
            "performance_level": s.get("performanceLevel", "NORMAL"),
            "objects_examined": int(s.get("objectsExamined", 0)),
            "objects_examined_per_second": float(s.get("objectsExaminedPerSecond", 0.0)),
            "objects_serviced": int(s.get("objectsServiced", 0)),
            "objects_serviced_per_second": float(s.get("objectsServicedPerSecond", 0.0)),
        })
    return result


async def run_synthetic_namespace_probe(
    hcp: HcpTenant,
    tenant_name: str,
    namespace_name: str,
    db: Session,
    timeout_sec: float = 4.0,
) -> Dict[str, Any]:
    """
    Executes a live synthetic probe against a single namespace to verify
    data-path reachability, measure round-trip latency, and record HTTP status.
    """
    auth = generate_hcp_auth_header(hcp.username, hcp.password)
    headers = {
        "Authorization": auth,
        "User-Agent": "Snoomp-HCP-Probe/1.0",
    }
    target_url = derive_namespace_endpoint(tenant_name, namespace_name, hcp.host)
    probe_url = f"{target_url}/rest/.snoomp-probe-check"

    t0 = time.perf_counter()
    status_code = 0
    error_msg = None
    success = False

    try:
        async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=timeout_sec) as client:
            resp = await client.head(probe_url, headers=headers)
            status_code = resp.status_code
            # 2xx, 404 (namespace reachable, object absent), or 204 are valid data path responses
            if status_code in (200, 204, 404):
                success = True
            elif status_code == 403:
                # Target returned 403: namespace reached, but probe user credentials lack access
                success = False
                error_msg = "HTTP 403: Namespace exists but probe credentials lack read permissions"
            elif status_code >= 500:
                success = False
                error_msg = f"HTTP {status_code}: Storage server error returned by HCP node"
            else:
                success = False
                error_msg = f"HTTP {status_code}: Unexpected response code"
    except httpx.ConnectTimeout:
        status_code = 504
        error_msg = "Connection timed out connecting to namespace endpoint"
    except httpx.ConnectError as ce:
        status_code = 502
        error_msg = f"Connection error: {ce}"
    except Exception as e:
        status_code = 500
        error_msg = str(e)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    probe_record = HcpSyntheticProbeResult(
        hcp_id=hcp.id,
        tenant_name=tenant_name,
        namespace_name=namespace_name,
        operation="HEAD",
        status_code=status_code,
        latency_ms=elapsed_ms,
        success=success,
        error_message=error_msg,
        timestamp=datetime.datetime.utcnow(),
    )
    db.add(probe_record)
    db.commit()

    return probe_record.to_dict()


async def run_all_synthetic_probes(hcp: HcpTenant, db: Session) -> Dict[str, Any]:
    """
    Executes synthetic probes across all discovered namespaces with bounded concurrency.
    Returns overall pass rate, p50 and p95 latency, and probe results list.
    """
    namespaces = []
    if hcp.metrics_cache and "namespaces" in hcp.metrics_cache:
        namespaces = hcp.metrics_cache["namespaces"]

    if not namespaces:
        return {
            "total_probed": 0,
            "pass_rate_percent": 100.0,
            "avg_latency_ms": 0.0,
            "p50_latency_ms": 0.0,
            "p95_latency_ms": 0.0,
            "results": [],
        }

    sem = asyncio.Semaphore(5)

    async def probe_bound(ns_dict: Dict[str, Any]) -> Dict[str, Any]:
        async with sem:
            t_name = ns_dict.get("tenant_name") or hcp.tenant_name
            ns_name = ns_dict.get("name") or "default"
            return await run_synthetic_namespace_probe(hcp, t_name, ns_name, db)

    results = await asyncio.gather(*(probe_bound(ns) for ns in namespaces))

    success_count = sum(1 for r in results if r.get("success"))
    total_count = len(results)
    pass_rate = round((success_count / max(1, total_count)) * 100.0, 1)

    latencies = sorted([r.get("latency_ms", 0.0) for r in results])
    avg_lat = round(sum(latencies) / max(1, len(latencies)), 1)
    p50_lat = latencies[len(latencies) // 2] if latencies else 0.0
    p95_idx = int(len(latencies) * 0.95)
    p95_lat = latencies[min(p95_idx, len(latencies) - 1)] if latencies else 0.0

    return {
        "total_probed": total_count,
        "successful_probes": success_count,
        "pass_rate_percent": pass_rate,
        "avg_latency_ms": avg_lat,
        "p50_latency_ms": p50_lat,
        "p95_latency_ms": p95_lat,
        "results": results,
    }


_HCP_ACCESS_LOG_REGEX = re.compile(
    r'^(?P<ip>\S+)\s+'
    r'\S+\s+'
    r'(?P<user>\S+)\s+'
    r'\[(?P<time>[^\]]+)\]\s+'
    r'"(?P<method>\S+)\s+(?P<path>\S+)(?:\s+(?P<proto>[^"]+))?"\s+'
    r'(?P<status>\d{3})\s+'
    r'(?P<resp_bytes>\S+)'
    r'(?:\s+(?P<target>\S+))?'
    r'(?:\s+(?P<duration>\d+))?'
    r'(?:\s+(?P<node>\d+))?'
    r'(?:\s+(?P<req_bytes>\d+))?'
)


def parse_hcp_access_log_line(line: str) -> Optional[Dict[str, Any]]:
    """
    Parses a single HCP access log entry into structured telemetry fields.
    Supports standard HCP HTTP gateway logs (CLF-extended) and whitespace-delimited logs.
    """
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None

    m = _HCP_ACCESS_LOG_REGEX.match(raw)
    if m:
        d = m.groupdict()
        status_code = int(d["status"])
        target = (d.get("target") or "").split("@")[0]
        if "." in target:
            parts = target.split(".", 1)
            namespace = parts[0]
            tenant = parts[1]
        else:
            namespace = "default"
            tenant = target or "system"

        resp_bytes = int(d["resp_bytes"]) if d["resp_bytes"].isdigit() else 0
        req_bytes = int(d["req_bytes"]) if d.get("req_bytes") and d["req_bytes"].isdigit() else 0
        duration_ms = float(d["duration"]) if d.get("duration") and d["duration"].isdigit() else 0.0
        node = int(d["node"]) if d.get("node") and d["node"].isdigit() else None

        return {
            "timestamp": d["time"],
            "client_ip": d["ip"],
            "user": d["user"] if d["user"] != "-" else "",
            "method": d["method"].upper(),
            "path": d["path"],
            "status_code": status_code,
            "status_class": f"{status_code // 100}xx",
            "response_bytes": resp_bytes,
            "request_bytes": req_bytes,
            "duration_ms": duration_ms,
            "tenant_name": tenant,
            "namespace_name": namespace,
            "node_number": node,
        }

    tokens = re.findall(r'(?:[^\s"]+|"[^"]*")+|(?<=\s)(?=\s)|(?<=^)(?=\s)', raw)
    tokens = [t.strip('"') for t in tokens if t.strip()]
    if len(tokens) >= 7:
        try:
            status_code = int(tokens[5]) if tokens[5].isdigit() else 200
            return {
                "timestamp": tokens[0],
                "client_ip": tokens[1] if len(tokens) > 1 else "",
                "user": tokens[2] if len(tokens) > 2 else "",
                "method": tokens[3].upper() if len(tokens) > 3 else "GET",
                "path": tokens[4] if len(tokens) > 4 else "/",
                "status_code": status_code,
                "status_class": f"{status_code // 100}xx",
                "response_bytes": int(tokens[6]) if len(tokens) > 6 and tokens[6].isdigit() else 0,
                "request_bytes": int(tokens[7]) if len(tokens) > 7 and tokens[7].isdigit() else 0,
                "duration_ms": float(tokens[8]) if len(tokens) > 8 and re.match(r"^\d+(?:\.\d+)?$", tokens[8]) else 0.0,
                "tenant_name": tokens[9] if len(tokens) > 9 else "default",
                "namespace_name": tokens[10] if len(tokens) > 10 else "default",
                "node_number": int(tokens[11]) if len(tokens) > 11 and tokens[11].isdigit() else None,
            }
        except Exception:
            return None

    return None


async def start_access_log_ingest_job(hcp: HcpTenant, db: Session) -> HcpLogIngestJob:
    """
    Initiates or tracks access log preparation on HCP MAPI.
    Checks /mapi/logs first to determine if a package is already prepared or streaming.
    """
    job = HcpLogIngestJob(
        hcp_id=hcp.id,
        status="preparing",
        records_processed=0,
        started_at=datetime.datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    auth = generate_hcp_auth_header(hcp.username, hcp.password)
    status_url = f"https://{hcp.host}:{hcp.port}/mapi/logs"
    status_headers = {"Authorization": auth, "Accept": "application/json"}

    try:
        async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=12.0) as client:
            st_resp = await client.get(status_url, headers=status_headers)
            if st_resp.is_success:
                st_data = st_resp.json()
                if st_data.get("readyForStreaming"):
                    job.status = "ready"
                    db.commit()
                    return job
                if st_data.get("streamingInProgress"):
                    job.status = "preparing"
                    job.error_message = "Log streaming is already active on HCP cluster"
                    db.commit()
                    return job
                if st_data.get("started"):
                    job.status = "preparing"
                    db.commit()
                    return job

            # Package not started yet: invoke prepare with startDate and endDate
            url = f"https://{hcp.host}:{hcp.port}/mapi/logs/prepare"
            now = datetime.datetime.utcnow()
            start_date = (now - datetime.timedelta(days=1)).strftime("%m/%d/%Y")
            end_date = now.strftime("%m/%d/%Y")
            prepare_xml = f"<logDownloadPrepare><startDate>{start_date}</startDate><endDate>{end_date}</endDate></logDownloadPrepare>"

            prep_headers = {
                "Authorization": auth,
                "Accept": "application/json",
                "Content-Type": "application/xml",
            }
            resp = await client.post(url, headers=prep_headers, content=prepare_xml)
            if not resp.is_success:
                err_msg = resp.headers.get("x-hcp-errormessage") or resp.text[:200]
                if "already" in (err_msg or "").lower() or resp.status_code == 400:
                    job.status = "preparing"
                    job.error_message = err_msg or "HCP package preparation in progress"
                    db.commit()
                    return job

                job.status = "failed"
                job.error_message = f"HCP logs prepare error: {err_msg}"
                job.completed_at = datetime.datetime.utcnow()
                db.commit()
                return job
    except Exception as e:
        job.status = "failed"
        job.error_message = f"Connection to logs prepare failed: {e}"
        job.completed_at = datetime.datetime.utcnow()
        db.commit()
        return job

    return job


async def check_and_process_log_ingest_job(hcp: HcpTenant, job_id: str, db: Session) -> Dict[str, Any]:
    """
    Polls /mapi/logs status. When readyForStreaming == true, downloads via POST /mapi/logs/download,
    extracts access logs, aggregates traffic metrics, and persists to HcpStreamAggregate.
    """
    job = db.query(HcpLogIngestJob).filter_by(id=job_id).first()
    if not job:
        raise LookupError("Ingest job not found")

    if job.status in ("completed", "failed"):
        return job.to_dict()

    auth = generate_hcp_auth_header(hcp.username, hcp.password)
    headers = {"Authorization": auth, "Accept": "application/json"}
    status_url = f"https://{hcp.host}:{hcp.port}/mapi/logs"

    try:
        async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=10.0) as client:
            resp = await client.get(status_url, headers=headers)
            if not resp.is_success:
                return job.to_dict()
            status_data = resp.json()

        ready = status_data.get("readyForStreaming", False)
        error = status_data.get("error", False)
        in_progress = status_data.get("streamingInProgress", False)

        if in_progress:
            job.status = "preparing"
            job.error_message = "Log streaming is currently active on the cluster"
            db.commit()
            return job.to_dict()

        if not ready:
            if error:
                job.status = "failed"
                job.error_message = "HCP reported an internal error during log package preparation"
                job.completed_at = datetime.datetime.utcnow()
                db.commit()
                return job.to_dict()

            job.status = "preparing"
            db.commit()
            return job.to_dict()

        job.status = "downloading"
        db.commit()

        download_url = f"https://{hcp.host}:{hcp.port}/mapi/logs/download"
        dl_headers = {
            "Authorization": auth,
            "Accept": "application/octet-stream, application/zip",
            "Content-Type": "application/json",
        }
        dl_timeout = httpx.Timeout(connect=15.0, read=300.0, write=15.0, pool=15.0)

        total_records = 0
        with tempfile.NamedTemporaryFile() as tmp_file:
            async with httpx.AsyncClient(verify=not hcp.ignore_tls, timeout=dl_timeout) as client:
                async with client.stream("POST", download_url, headers=dl_headers, json={"content": "ACCESS"}) as dl_resp:
                    if not dl_resp.is_success:
                        err_msg = dl_resp.headers.get("x-hcp-errormessage") or f"HTTP {dl_resp.status_code}"
                        if "already in progress" in err_msg.lower():
                            job.status = "preparing"
                            job.error_message = "Another download is currently active on HCP"
                            db.commit()
                            return job.to_dict()

                        job.status = "failed"
                        job.error_message = f"Log download failed: {err_msg}"
                        job.completed_at = datetime.datetime.utcnow()
                        db.commit()
                        return job.to_dict()

                    job.status = "parsing"
                    db.commit()

                    async for chunk in dl_resp.aiter_bytes(chunk_size=131072):
                        tmp_file.write(chunk)

            tmp_file.seek(0)

            with zipfile.ZipFile(tmp_file) as zf:
                for outer_name in zf.namelist():
                    if outer_name.endswith((".tar.xz", ".tar.gz", ".tar")):
                        try:
                            with zf.open(outer_name) as node_tar_bytes:
                                with tarfile.open(fileobj=node_tar_bytes, mode="r:*") as node_tar:
                                    for node_member in node_tar.getmembers():
                                        if "access" in node_member.name.lower() and node_member.name.endswith((".tar.xz", ".tar.gz", ".tar")):
                                            inner_tar_file = node_tar.extractfile(node_member)
                                            if inner_tar_file:
                                                with tarfile.open(fileobj=inner_tar_file, mode="r:*") as access_tar:
                                                    for acc_member in access_tar.getmembers():
                                                        if acc_member.isfile() and ("request" in acc_member.name or "access" in acc_member.name):
                                                            acc_f = access_tar.extractfile(acc_member)
                                                            if acc_f:
                                                                parsed_records = []
                                                                for line_bytes in acc_f:
                                                                    line_str = line_bytes.decode("utf-8", errors="replace").strip()
                                                                    rec = parse_hcp_access_log_line(line_str)
                                                                    if rec:
                                                                        parsed_records.append(rec)
                                                                if parsed_records:
                                                                    _persist_log_aggregates(hcp.id, parsed_records, db)
                                                                    total_records += len(parsed_records)
                                        elif node_member.isfile() and ("access" in node_member.name.lower() or "request" in node_member.name.lower()):
                                            acc_f = node_tar.extractfile(node_member)
                                            if acc_f:
                                                parsed_records = []
                                                for line_bytes in acc_f:
                                                    line_str = line_bytes.decode("utf-8", errors="replace").strip()
                                                    rec = parse_hcp_access_log_line(line_str)
                                                    if rec:
                                                        parsed_records.append(rec)
                                                if parsed_records:
                                                    _persist_log_aggregates(hcp.id, parsed_records, db)
                                                    total_records += len(parsed_records)
                        except Exception as e:
                            logger.warning(f"Error parsing tarball {outer_name}: {e}")

                    elif "access" in outer_name.lower() and not outer_name.endswith("/"):
                        with zf.open(outer_name) as acc_f:
                            parsed_records = []
                            for line_bytes in acc_f:
                                line_str = line_bytes.decode("utf-8", errors="replace").strip()
                                rec = parse_hcp_access_log_line(line_str)
                                if rec:
                                    parsed_records.append(rec)
                            if parsed_records:
                                _persist_log_aggregates(hcp.id, parsed_records, db)
                                total_records += len(parsed_records)

        job.status = "completed"
        job.records_processed = total_records
        job.completed_at = datetime.datetime.utcnow()
        db.commit()

    except Exception as e:
        job.status = "failed"
        job.error_message = f"Error streaming and processing logs: {e}"
        job.completed_at = datetime.datetime.utcnow()
        db.commit()

    return job.to_dict()


def _persist_log_aggregates(hcp_id: str, records: List[Dict[str, Any]], db: Session) -> None:
    """
    Groups raw access records by (tenant, namespace, status_class, client_ip)
    and persists compact rolling aggregates.
    """
    now = datetime.datetime.utcnow()
    interval_start = now - datetime.timedelta(hours=1)
    groups: Dict[Tuple[str, str, str, str], List[Dict[str, Any]]] = {}

    for r in records:
        key = (r["tenant_name"], r["namespace_name"], r["status_class"], r["client_ip"] or "unknown")
        if key not in groups:
            groups[key] = []
        groups[key].append(r)

    for (tenant, namespace, s_class, c_ip), group_recs in groups.items():
        durations = sorted([g["duration_ms"] for g in group_recs])
        p50 = durations[len(durations) // 2] if durations else 0.0
        p95_idx = int(len(durations) * 0.95)
        p95 = durations[min(p95_idx, len(durations) - 1)] if durations else 0.0
        avg_dur = sum(durations) / max(1, len(durations))

        total_in = sum(g["request_bytes"] for g in group_recs)
        total_out = sum(g["response_bytes"] for g in group_recs)
        code = group_recs[0]["status_code"]
        method = group_recs[0]["method"]

        agg = HcpStreamAggregate(
            hcp_id=hcp_id,
            tenant_name=tenant,
            namespace_name=namespace,
            client_ip=c_ip if c_ip != "unknown" else None,
            http_method=method,
            status_class=s_class,
            status_code=code,
            requests_count=len(group_recs),
            bytes_in=float(total_in),
            bytes_out=float(total_out),
            duration_ms_avg=round(avg_dur, 2),
            duration_ms_p50=round(p50, 2),
            duration_ms_p95=round(p95, 2),
            interval_start=interval_start,
            interval_end=now,
        )
        db.add(agg)

    db.commit()


def get_stream_overview(hcp: HcpTenant, db: Session, hours: int = 24) -> Dict[str, Any]:
    """
    Aggregates the top-level platform overview metrics:
    total requests, 2xx/4xx/5xx error rates, throughput MB/s, latency percentiles,
    latest node health, probe pass rate, and flagged tenants.
    """
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    aggs = db.query(HcpStreamAggregate).filter(
        HcpStreamAggregate.hcp_id == hcp.id,
        HcpStreamAggregate.interval_start >= cutoff,
    ).all()

    total_requests = sum(a.requests_count for a in aggs)
    c_2xx = sum(a.requests_count for a in aggs if a.status_class == "2xx")
    c_4xx = sum(a.requests_count for a in aggs if a.status_class == "4xx")
    c_5xx = sum(a.requests_count for a in aggs if a.status_class == "5xx")

    p2xx = round((c_2xx / max(1, total_requests)) * 100.0, 2)
    p4xx = round((c_4xx / max(1, total_requests)) * 100.0, 2)
    p5xx = round((c_5xx / max(1, total_requests)) * 100.0, 2)

    total_bytes_in = sum(a.bytes_in for a in aggs)
    total_bytes_out = sum(a.bytes_out for a in aggs)
    total_mb_in = round(total_bytes_in / (1024 * 1024), 2)
    total_mb_out = round(total_bytes_out / (1024 * 1024), 2)

    avg_latency = 0.0
    p50_latency = 0.0
    p95_latency = 0.0
    if aggs:
        all_lats = sorted([a.duration_ms_avg for a in aggs])
        avg_latency = round(sum(all_lats) / len(all_lats), 1)
        p50_latency = round(all_lats[len(all_lats) // 2], 1)
        p95_idx = int(len(all_lats) * 0.95)
        p95_latency = round(all_lats[min(p95_idx, len(all_lats) - 1)], 1)

    probes = db.query(HcpSyntheticProbeResult).filter(
        HcpSyntheticProbeResult.hcp_id == hcp.id,
        HcpSyntheticProbeResult.timestamp >= cutoff,
    ).order_by(HcpSyntheticProbeResult.timestamp.desc()).limit(100).all()

    probe_pass_rate = 100.0
    probe_avg_latency = 0.0
    if probes:
        pass_count = sum(1 for p in probes if p.success)
        probe_pass_rate = round((pass_count / len(probes)) * 100.0, 1)
        probe_avg_latency = round(sum(p.latency_ms for p in probes) / len(probes), 1)

    latest_metrics = (
        db.query(HcpNodeMetric)
        .filter(HcpNodeMetric.hcp_id == hcp.id)
        .order_by(HcpNodeMetric.timestamp.desc())
        .limit(8)
        .all()
    )
    seen_nodes = set()
    node_list = []
    for m in latest_metrics:
        if m.node_number not in seen_nodes:
            seen_nodes.add(m.node_number)
            node_list.append(m.to_dict())
    node_list.sort(key=lambda x: x["node_number"])

    cluster_mb_sec = round(sum(n["frontend_mb_per_sec"] for n in node_list), 2)
    cluster_conns = sum(n["total_connections"] for n in node_list)

    flagged = []
    if hcp.metrics_cache and "tenants" in hcp.metrics_cache:
        for t in hcp.metrics_cache["tenants"]:
            st = (t.get("status") or "ok").lower()
            if not t.get("namespaces_accessible") or st in ("warning", "critical"):
                code = 403 if not t.get("namespaces_accessible") else (503 if st == "critical" else 200)
                flagged.append({
                    "name": t.get("name"),
                    "tenant_name": t.get("name"),
                    "status": st,
                    "status_code": code,
                    "reason": "Namespace access restricted (HTTP 403)" if not t.get("namespaces_accessible") else f"Elevated quota ({t.get('used_percent', 0)}% used)",
                    "used_percent": t.get("used_percent", 0),
                    "storage_used": t.get("storage_used_formatted", "0 B"),
                })

    req_per_sec = round(total_requests / max(1, hours * 3600), 2)
    share_2xx = p2xx if total_requests else 100.0

    return {
        "hcp_id": hcp.id,
        "name": hcp.name,
        "host": hcp.host,
        "total_requests_per_sec": req_per_sec,
        "rate_2xx_percent": share_2xx,
        "rate_4xx_percent": p4xx,
        "rate_5xx_percent": p5xx,
        "p95_latency_ms": p95_latency,
        "total_bandwidth_mb_sec": cluster_mb_sec,
        "probe_pass_rate_percent": probe_pass_rate,
        "traffic": {
            "total_requests": total_requests,
            "requests_per_sec": req_per_sec,
            "share_2xx_percent": share_2xx,
            "share_4xx_percent": p4xx,
            "share_5xx_percent": p5xx,
            "total_mb_in": total_mb_in,
            "total_mb_out": total_mb_out,
            "duration_ms_avg": avg_latency,
            "duration_ms_p50": p50_latency,
            "duration_ms_p95": p95_latency,
        },
        "probe": {
            "pass_rate_percent": probe_pass_rate,
            "avg_latency_ms": probe_avg_latency,
            "total_probes_evaluated": len(probes),
        },
        "cluster_nodes": {
            "active_nodes_count": len(node_list),
            "total_connections": cluster_conns,
            "frontend_mb_per_sec": cluster_mb_sec,
            "nodes": node_list,
        },
        "flagged_tenants": flagged,
    }


def get_stream_investigation_insights(hcp: HcpTenant, db: Session, hours: int = 48) -> Dict[str, Any]:
    """
    Summarizes log investigation findings:
    - Top client IPs by request volume and errors
    - 4xx & 413 error breakdown by user and path
    - Slowest transfers with calculated MB/s throughput
    """
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    aggs = db.query(HcpStreamAggregate).filter(
        HcpStreamAggregate.hcp_id == hcp.id,
        HcpStreamAggregate.interval_start >= cutoff,
    ).all()

    client_counts: Dict[str, Dict[str, Any]] = {}
    for a in aggs:
        ip = a.client_ip or "internal"
        if ip not in client_counts:
            client_counts[ip] = {
                "client_ip": ip,
                "total_requests": 0,
                "requests": 0,
                "error_requests": 0,
                "errors": 0,
                "mb_transferred": 0.0,
            }
        client_counts[ip]["total_requests"] += a.requests_count
        client_counts[ip]["requests"] += a.requests_count
        if a.status_class in ("4xx", "5xx"):
            client_counts[ip]["error_requests"] += a.requests_count
            client_counts[ip]["errors"] += a.requests_count
        client_counts[ip]["mb_transferred"] += (a.bytes_in + a.bytes_out) / (1024 * 1024)

    top_clients = sorted(client_counts.values(), key=lambda x: x["total_requests"], reverse=True)[:8]
    for c in top_clients:
        tot = max(1, c["total_requests"])
        err = c["error_requests"]
        c["error_rate_percent"] = round((err / tot) * 100.0, 1)
        c["mb_transferred"] = round(c["mb_transferred"], 2)

    err_4xx = [a for a in aggs if a.status_class == "4xx"]
    err_breakdown = []
    for a in err_4xx[:10]:
        err_breakdown.append({
            "tenant_name": a.tenant_name,
            "namespace_name": a.namespace_name,
            "status_code": a.status_code,
            "requests_count": a.requests_count,
            "count": a.requests_count,
            "method": a.http_method,
            "path": f"/{a.tenant_name}/{a.namespace_name} ({a.http_method})",
            "user_name": a.client_ip or "client",
            "reason": f"HTTP {a.status_code}",
        })

    slow_items = sorted(aggs, key=lambda a: a.duration_ms_p95, reverse=True)[:8]
    slow_transfers = []
    for s in slow_items:
        tot_bytes = s.bytes_in + s.bytes_out
        mb = tot_bytes / (1024 * 1024)
        sec = round((s.duration_ms_avg or 0.0) / 1000.0, 2) if (s.duration_ms_avg or 0.0) > 0 else 0.1
        mb_per_sec = round(mb / max(0.01, sec), 2)
        slow_transfers.append({
            "tenant_name": s.tenant_name,
            "namespace_name": s.namespace_name,
            "client_ip": s.client_ip or "unspecified",
            "path": f"/{s.tenant_name}/{s.namespace_name}",
            "duration_ms": round(s.duration_ms_p95, 1),
            "duration_sec": sec,
            "bytes_transferred": tot_bytes,
            "mb_transferred": round(mb, 2),
            "effective_mb_per_sec": mb_per_sec,
            "mb_per_sec": mb_per_sec,
            "status_code": s.status_code,
        })

    return {
        "top_clients": top_clients,
        "client_errors_4xx": err_breakdown,
        "errors_4xx_breakdown": err_breakdown,
        "slow_transfers": slow_transfers,
        "slowest_transfers": slow_transfers,
    }
