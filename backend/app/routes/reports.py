"""
PDF report downloads.

Each endpoint returns a finished application/pdf with a Content-Disposition
attachment header, so the browser downloads a file rather than opening a print
dialog. Metrics are computed here from the same helpers the dashboard uses, so
the document and the screen cannot disagree.
"""

import datetime
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth.security import require_viewer
from app.database import get_db
from app.models.hcp import HcpTenant
from app.models.incident import Incident
from app.models.target import Target
from app.reports import (
    build_executive_report,
    build_fleet_report,
    build_hcp_cluster_report,
    build_hcp_tenant_report,
    build_monitor_report,
    build_utilization_report,
)
from app.routes.dashboard import get_sla_trend, get_target_report
from app.services.dashboard import compile_initial_data
from app.services.hcp_service import query_hcp_cluster_mapi, query_hcp_tenant_mapi
from app.services.utilization_report import get_target_utilization_report

router = APIRouter(prefix="/api/reports", tags=["reports"])

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _filename(*parts: str) -> str:
    """Filesystem-safe, sortable filename: leading date, then the subject."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    slug = "-".join(_SAFE.sub("-", p).strip("-") for p in parts if p).strip("-")
    return f"snoomp-{slug}-{stamp}.pdf"[:120]


def _pdf(data: bytes, filename: str) -> Response:
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # The report is a point-in-time snapshot; a cached copy would be wrong.
            "Cache-Control": "no-store",
        },
    )


def _sla_target(db: Session) -> float:
    """
    Instance SLA target from settings.

    Settings are key/value with a JSON payload, and the SLA block is one key
    holding {normal, warning, critical}. Falls back to the documented default
    rather than failing the download — a report with the default target is more
    useful than no report.
    """
    try:
        from app.models.setting import Setting
        row = db.query(Setting).filter(Setting.key == "sla").first()
        if row and isinstance(row.value_json, dict):
            value = row.value_json.get("normal")
            if value is not None:
                return float(value)
    except Exception:
        pass
    return 99.9


@router.get("/targets/{target_id}.pdf", dependencies=[Depends(require_viewer)])
def monitor_report_pdf(target_id: str, hours: int = 168, db: Session = Depends(get_db)):
    """Availability report for one monitor."""
    target = db.query(Target).filter_by(id=target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    report = get_target_report(target_id=target_id, hours=hours, db=db)
    pdf = build_monitor_report(target, report, _sla_target(db))
    return _pdf(pdf, _filename("availability", target.name or target_id))


@router.get("/targets/{target_id}/utilization.pdf", dependencies=[Depends(require_viewer)])
def monitor_utilization_pdf(target_id: str, hours: int = 168, db: Session = Depends(get_db)):
    """Metric utilization report for one monitor."""
    target = db.query(Target).filter_by(id=target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    report = get_target_utilization_report(target_id=target_id, hours=hours, db=db)
    pdf = build_utilization_report(target, report)
    return _pdf(pdf, _filename("utilization", target.name or target_id))


@router.get("/fleet.pdf", dependencies=[Depends(require_viewer)])
def fleet_report_pdf(db: Session = Depends(get_db)):
    """Whole-fleet health report."""
    monitors: List[Dict[str, Any]] = compile_initial_data(db)

    incidents = (
        db.query(Incident)
        .order_by(Incident.started_at.desc())
        .limit(25)
        .all()
    )
    names = {t.id: t.name for t in db.query(Target.id, Target.name).all()}
    incident_rows = [{
        "target_name": names.get(i.target_id, i.target_id),
        "from_status": i.from_status,
        "to_status": i.to_status,
        "started_at": i.started_at.isoformat() + "Z" if i.started_at else None,
    } for i in incidents]

    pdf = build_fleet_report(monitors, incident_rows, _sla_target(db))
    return _pdf(pdf, _filename("fleet"))


@router.get("/executive.pdf", dependencies=[Depends(require_viewer)])
def executive_report_pdf(months: int = 6, db: Session = Depends(get_db)):
    """Executive availability summary."""
    monitors: List[Dict[str, Any]] = compile_initial_data(db)
    try:
        trend = get_sla_trend(months=months, db=db)
    except TypeError:
        # Signature drift between versions shouldn't take the whole report down;
        # the summary is still useful without the trend section.
        trend = None
    except Exception:
        trend = None

    pdf = build_executive_report(monitors, trend, _sla_target(db))
    return _pdf(pdf, _filename("executive-summary"))


@router.get("/hcp/{hcp_id}/cluster.pdf", dependencies=[Depends(require_viewer)])
async def hcp_cluster_report_pdf(hcp_id: str, db: Session = Depends(get_db)):
    """Cluster-wide capacity, quota threshold watchlist, and tenant directory PDF report."""
    hcp = db.query(HcpTenant).filter_by(id=hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP endpoint not found")

    cluster_data = hcp.metrics_cache
    if not cluster_data:
        try:
            if hcp.is_cluster:
                cluster_data = await query_hcp_cluster_mapi(
                    host=hcp.host,
                    port=hcp.port,
                    username=hcp.username,
                    password=hcp.password,
                    ignore_tls=hcp.ignore_tls,
                    timeout_sec=8.0,
                )
            else:
                single_data = await query_hcp_tenant_mapi(
                    host=hcp.host,
                    port=hcp.port,
                    tenant_name=hcp.tenant_name,
                    username=hcp.username,
                    password=hcp.password,
                    ignore_tls=hcp.ignore_tls,
                    timeout_sec=8.0,
                )
                t_info = single_data.get("tenant", {})
                cluster_data = {
                    "status": single_data.get("status", "ok"),
                    "cluster": {
                        "storage_used_formatted": t_info.get("storage_used_formatted", "0 B"),
                        "object_count": t_info.get("object_count", 0),
                    },
                    "tenants_summary": {"total_count": 1, "healthy_count": 1, "warning_count": 0, "critical_count": 0},
                    "tenants": [t_info],
                    "namespaces": single_data.get("namespaces", []),
                }
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed querying HCP cluster data: {e}")

    pdf = build_hcp_cluster_report(hcp, cluster_data)
    return _pdf(pdf, _filename("hcp-cluster", hcp.name or hcp.host))


@router.get("/hcp/{hcp_id}/tenant.pdf", dependencies=[Depends(require_viewer)])
async def hcp_tenant_report_pdf(
    hcp_id: str,
    tenant_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Tenant S3 quota envelope, bucket breakdown, and object statistics PDF report."""
    hcp = db.query(HcpTenant).filter_by(id=hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP endpoint not found")

    target_tenant = (tenant_name or "").strip()
    if not target_tenant:
        if not hcp.is_cluster:
            target_tenant = hcp.tenant_name
        else:
            raise HTTPException(status_code=400, detail="tenant_name parameter is required for cluster endpoints")

    tenant_data = None
    if hcp.metrics_cache:
        if not hcp.is_cluster and (hcp.tenant_name.lower() == target_tenant.lower()):
            tenant_data = hcp.metrics_cache
        elif hcp.is_cluster:
            cached_tenants = hcp.metrics_cache.get("tenants", [])
            match = next((t for t in cached_tenants if (t.get("name") or "").lower() == target_tenant.lower()), None)
            if match:
                matched_namespaces = [
                    ns for ns in hcp.metrics_cache.get("namespaces", [])
                    if (ns.get("tenant_name") or "").lower() == target_tenant.lower()
                ]
                tenant_data = {
                    "status": match.get("status", "ok"),
                    "tenant": match,
                    "namespaces": matched_namespaces,
                }

    if not tenant_data or not tenant_data.get("namespaces"):
        try:
            tenant_data = await query_hcp_tenant_mapi(
                host=hcp.host,
                port=hcp.port,
                tenant_name=target_tenant,
                username=hcp.username,
                password=hcp.password,
                ignore_tls=hcp.ignore_tls,
                timeout_sec=8.0,
            )
        except Exception as e:
            if not tenant_data:
                raise HTTPException(status_code=502, detail=f"Failed querying HCP tenant '{target_tenant}': {e}")

    pdf = build_hcp_tenant_report(hcp, target_tenant, tenant_data)
    return _pdf(pdf, _filename("hcp-tenant", target_tenant))
