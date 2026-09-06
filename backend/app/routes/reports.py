"""
PDF report downloads.

Each endpoint returns a finished application/pdf with a Content-Disposition
attachment header, so the browser downloads a file rather than opening a print
dialog. Metrics are computed here from the same helpers the dashboard uses, so
the document and the screen cannot disagree.
"""

import datetime
import re
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth.security import require_viewer
from app.database import get_db
from app.models.incident import Incident
from app.models.target import Target
from app.reports import build_executive_report, build_fleet_report, build_monitor_report
from app.routes.dashboard import get_sla_trend, get_target_report
from app.services.dashboard import compile_initial_data

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
