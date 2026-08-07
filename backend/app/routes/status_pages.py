import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.status_page import StatusPage
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.auth.security import require_viewer, require_editor, get_current_user

router = APIRouter(prefix="/api/status-pages", tags=["Status Pages"])

# ── Pydantic schemas ──

class StatusPageCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    monitor_ids: List[str] = []
    is_public: bool = True
    logo_url: Optional[str] = None
    custom_css: Optional[str] = None

class StatusPageUpdate(StatusPageCreate):
    pass


# ── CRUD endpoints (auth required) ──

@router.get("/", dependencies=[Depends(require_viewer)])
def list_status_pages(db: Session = Depends(get_db)):
    """List all status pages."""
    pages = db.query(StatusPage).all()
    return [p.to_dict() for p in pages]


@router.post("/", dependencies=[Depends(require_editor)])
def create_status_page(payload: StatusPageCreate, db: Session = Depends(get_db)):
    """Create a new status page."""
    # Check slug uniqueness
    existing = db.query(StatusPage).filter_by(slug=payload.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{payload.slug}' is already taken.")

    page = StatusPage(
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        monitor_ids=payload.monitor_ids,
        is_public=payload.is_public,
        logo_url=payload.logo_url,
        custom_css=payload.custom_css,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return page.to_dict()


@router.put("/{page_id}", dependencies=[Depends(require_editor)])
def update_status_page(page_id: str, payload: StatusPageUpdate, db: Session = Depends(get_db)):
    """Update an existing status page."""
    page = db.query(StatusPage).filter_by(id=page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Status page not found.")

    # Check slug uniqueness (excluding self)
    conflict = db.query(StatusPage).filter(StatusPage.slug == payload.slug, StatusPage.id != page_id).first()
    if conflict:
        raise HTTPException(status_code=409, detail=f"Slug '{payload.slug}' is already taken.")

    page.name = payload.name
    page.slug = payload.slug
    page.description = payload.description
    page.monitor_ids = payload.monitor_ids
    page.is_public = payload.is_public
    page.logo_url = payload.logo_url
    page.custom_css = payload.custom_css
    page.updated_at = datetime.datetime.utcnow()

    db.commit()
    db.refresh(page)
    return page.to_dict()


@router.delete("/{page_id}", dependencies=[Depends(require_editor)])
def delete_status_page(page_id: str, db: Session = Depends(get_db)):
    """Delete a status page."""
    page = db.query(StatusPage).filter_by(id=page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Status page not found.")
    db.delete(page)
    db.commit()
    return {"detail": "Deleted."}


# ── Public endpoint (no auth) ──

@router.get("/public/{slug}")
def get_public_status_page(slug: str, db: Session = Depends(get_db)):
    """
    Public status page data — no authentication required.
    Returns page info plus current status of each selected monitor.
    """
    page = db.query(StatusPage).filter_by(slug=slug, is_public=True).first()
    if not page:
        raise HTTPException(status_code=404, detail="Status page not found.")

    monitors_data = []
    for mid in (page.monitor_ids or []):
        target = db.query(Target).filter_by(id=mid).first()
        if not target:
            continue

        latest_hb = (
            db.query(Heartbeat)
            .filter_by(target_id=mid)
            .order_by(Heartbeat.checked_at.desc())
            .first()
        )

        # Last 30 heartbeats for mini bar
        recent_hbs = (
            db.query(Heartbeat)
            .filter_by(target_id=mid)
            .order_by(Heartbeat.checked_at.desc())
            .limit(30)
            .all()
        )
        # Calculate 24h uptime %
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
        hbs_24h = db.query(Heartbeat).filter(
            Heartbeat.target_id == mid,
            Heartbeat.checked_at >= cutoff
        ).all()
        up_24h = sum(1 for h in hbs_24h if h.status == 'up')
        total_24h = len(hbs_24h) or 1
        uptime_pct = round((up_24h / total_24h) * 100, 2)

        monitors_data.append({
            "id": target.id,
            "name": target.name,
            "type": target.type,
            "tags": target.tags,
            # F10: host intentionally omitted — internal IPs must not leak to public pages
            "status": latest_hb.status if latest_hb else "unknown",
            "response_time_ms": latest_hb.response_time_ms if latest_hb else 0,
            "uptime_24h": uptime_pct,
            "recent_heartbeats": [
                {"status": h.status, "checked_at": h.checked_at.isoformat()}
                for h in reversed(recent_hbs)
            ],
        })

    return {
        "page": page.to_dict(),
        "monitors": monitors_data,
        "generated_at": datetime.datetime.utcnow().isoformat(),
    }
