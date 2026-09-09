"""
Backup and restore router for Snoomp.
# ponytail: Zero-dependency JSON export/import using Python stdlib and atomic DB transactions.
"""
import datetime
import json
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.security import require_admin
from app.models.target import Target
from app.models.notification import Notification
from app.models.status_page import StatusPage
from app.models.setting import Setting

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup", tags=["Backup & Restore"])


@router.get("/export")
def export_backup(db: Session = Depends(get_db), _user=Depends(require_admin)):
    """
    Export all Snoomp configurations (targets, notifications, status pages, settings) as JSON.
    # ponytail: Dump directly from SQLAlchemy models without intermediary DTO boilerplate.
    """
    targets = db.query(Target).all()
    notifications = db.query(Notification).all()
    status_pages = db.query(StatusPage).all()
    settings = db.query(Setting).all()

    backup_payload = {
        "version": "1.0",
        "generator": "Snoomp Enterprise Observability",
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "data": {
            "targets": [
                {
                    "id": t.id,
                    "name": t.name,
                    "type": t.type,
                    "host": t.host,
                    "port": t.port,
                    "path": t.path,
                    "check_interval": t.check_interval,
                    "enabled": t.enabled,
                    "tags": t.tags or [],
                    "config_json": t.config_json_raw(),
                }
                for t in targets
            ],
            "notifications": [
                {
                    "id": n.id,
                    "name": n.name,
                    "type": n.type,
                    "is_default": n.is_default,
                    "active": n.active,
                    "config_json": n.config_json_raw(),
                }
                for n in notifications
            ],
            "status_pages": [
                {
                    "id": sp.id,
                    "name": sp.name,
                    "slug": sp.slug,
                    "description": sp.description,
                    "monitor_ids": sp.monitor_ids or [],
                    "is_public": sp.is_public,
                    "logo_url": sp.logo_url,
                    "custom_css": sp.custom_css,
                }
                for sp in status_pages
            ],
            "settings": [
                {
                    "key": s.key,
                    "value_json": s.value_json,
                }
                for s in settings
            ],
        },
    }

    content = json.dumps(backup_payload, indent=2, ensure_ascii=False)
    date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    filename = f"snoomp-backup-{date_str}.json"

    logger.info("Admin '%s' generated backup archive (%d targets, %d notifications)",
                _user.username, len(targets), len(notifications))

    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/import")
async def import_backup(
    file: Optional[UploadFile] = File(None),
    mode: str = Query("merge", pattern="^(merge|replace)$"),
    db: Session = Depends(get_db),
    _user=Depends(require_admin)
):
    """
    Import and restore Snoomp configurations from backup JSON.
    mode="merge": upserts records without deleting unreferenced items.
    mode="replace": wipes existing targets, notifications, status pages, settings and loads backup.
    # ponytail: Handled inside an atomic DB transaction with full rollback on validation error.
    """
    if not file:
        raise HTTPException(status_code=400, detail="Backup file is required")

    try:
        raw_bytes = await file.read()
        payload = json.loads(raw_bytes.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file format: {str(e)}")

    data = payload.get("data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid backup file: missing root 'data' object")

    imported_counts = {"targets": 0, "notifications": 0, "status_pages": 0, "settings": 0}

    try:
        # 1. Clean existing records if replace mode
        if mode == "replace":
            # ponytail: In replace mode, wipe existing records first
            db.query(StatusPage).delete()
            db.query(Target).delete()
            db.query(Notification).delete()
            db.query(Setting).delete()
            db.flush()

        # 2. Restore Notifications
        for n_data in data.get("notifications", []):
            nid = n_data.get("id")
            notif = db.query(Notification).filter_by(id=nid).first() if nid else None
            if not notif:
                notif = Notification(
                    id=nid,
                    name=n_data.get("name", "Restored Channel"),
                    type=n_data.get("type", "apprise"),
                    is_default=bool(n_data.get("is_default", False)),
                    active=bool(n_data.get("active", True)),
                    config_json=n_data.get("config_json") or {},
                )
                db.add(notif)
            else:
                notif.name = n_data.get("name", notif.name)
                notif.type = n_data.get("type", notif.type)
                notif.is_default = bool(n_data.get("is_default", notif.is_default))
                notif.active = bool(n_data.get("active", notif.active))
                notif.config_json = n_data.get("config_json") or {}
            imported_counts["notifications"] += 1

        db.flush()

        # 3. Restore Targets
        for t_data in data.get("targets", []):
            tid = t_data.get("id")
            target = db.query(Target).filter_by(id=tid).first() if tid else None
            if not target:
                target = Target(
                    id=tid,
                    name=t_data.get("name", "Restored Target"),
                    type=t_data.get("type", "http"),
                    host=t_data.get("host", "localhost"),
                    port=t_data.get("port"),
                    path=t_data.get("path"),
                    check_interval=int(t_data.get("check_interval", 60)),
                    enabled=bool(t_data.get("enabled", True)),
                    tags=t_data.get("tags") or [],
                    config_json=t_data.get("config_json") or {},
                )
                db.add(target)
            else:
                target.name = t_data.get("name", target.name)
                target.type = t_data.get("type", target.type)
                target.host = t_data.get("host", target.host)
                target.port = t_data.get("port", target.port)
                target.path = t_data.get("path", target.path)
                target.check_interval = int(t_data.get("check_interval", target.check_interval))
                target.enabled = bool(t_data.get("enabled", target.enabled))
                target.tags = t_data.get("tags") or []
                target.config_json = t_data.get("config_json") or {}
            imported_counts["targets"] += 1

        db.flush()

        # 4. Restore Status Pages
        for sp_data in data.get("status_pages", []):
            spid = sp_data.get("id")
            slug = sp_data.get("slug", "restored-page")
            sp = db.query(StatusPage).filter((StatusPage.id == spid) | (StatusPage.slug == slug)).first()
            if not sp:
                sp = StatusPage(
                    id=spid,
                    name=sp_data.get("name", "Restored Status Page"),
                    slug=slug,
                    description=sp_data.get("description"),
                    monitor_ids=sp_data.get("monitor_ids") or [],
                    is_public=bool(sp_data.get("is_public", True)),
                    logo_url=sp_data.get("logo_url"),
                    custom_css=sp_data.get("custom_css"),
                )
                db.add(sp)
            else:
                sp.name = sp_data.get("name", sp.name)
                sp.slug = slug
                sp.description = sp_data.get("description", sp.description)
                sp.monitor_ids = sp_data.get("monitor_ids") or []
                sp.is_public = bool(sp_data.get("is_public", sp.is_public))
                sp.logo_url = sp_data.get("logo_url", sp.logo_url)
                sp.custom_css = sp_data.get("custom_css", sp.custom_css)
            imported_counts["status_pages"] += 1

        db.flush()

        # 5. Restore Settings
        for s_data in data.get("settings", []):
            key = s_data.get("key")
            if not key:
                continue
            setting = db.query(Setting).filter_by(key=key).first()
            if not setting:
                setting = Setting(key=key, value_json=s_data.get("value_json"))
                db.add(setting)
            else:
                setting.value_json = s_data.get("value_json")
            imported_counts["settings"] += 1

        db.commit()

        logger.info(
            "Admin '%s' restored backup (mode=%s): %d targets, %d notifications, %d status pages, %d settings",
            _user.username, mode, imported_counts["targets"], imported_counts["notifications"],
            imported_counts["status_pages"], imported_counts["settings"]
        )

        return {
            "success": True,
            "mode": mode,
            "imported": imported_counts,
            "stats": {
                "targets": imported_counts["targets"],
                "notification_channels": imported_counts["notifications"],
                "status_pages": imported_counts["status_pages"],
                "settings": imported_counts["settings"],
            },
            "message": f"Successfully restored {imported_counts['targets']} target(s), {imported_counts['notifications']} notification(s), and {imported_counts['status_pages']} status page(s)."
        }

    except Exception as e:
        db.rollback()
        logger.error("Failed importing backup: %s", e)
        raise HTTPException(status_code=500, detail=f"Database transaction failed during restore: {str(e)}")
