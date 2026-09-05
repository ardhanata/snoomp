import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.security import require_admin, require_viewer
from app.models.notification import Notification
from app.models.target import Target
from app.services.notification_service import test_notification_channel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])

class NotificationCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: str = Field(..., min_length=1, max_length=64)
    config: Dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False
    active: bool = True
    apply_existing: bool = False

class NotificationUpdateRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None
    active: Optional[bool] = None
    apply_existing: bool = False

class NotificationTestRequest(BaseModel):
    name: str = "Test Channel"
    type: str
    config: Dict[str, Any] = Field(default_factory=dict)


@router.get("", response_model=List[Dict[str, Any]])
def list_notifications(db: Session = Depends(get_db), _user=Depends(require_viewer)):
    """List all configured notification channels."""
    notifs = db.query(Notification).order_by(Notification.created_at.asc()).all()
    return [n.to_dict() for n in notifs]


@router.get("/{notification_id}", response_model=Dict[str, Any])
def get_notification(notification_id: str, db: Session = Depends(get_db), _user=Depends(require_viewer)):
    """Get single notification channel by ID."""
    notif = db.query(Notification).filter_by(id=notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification channel not found")
    return notif.to_dict()


@router.post("", response_model=Dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_notification(
    payload: NotificationCreateRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_admin)
):
    """Create a new notification channel using Apprise alert engine."""
    notif = Notification(
        name=payload.name.strip(),
        type=payload.type.strip().lower(),
        is_default=payload.is_default,
        active=payload.active,
        config_json=payload.config or {},
    )
    db.add(notif)
    db.flush()

    # ponytail: apply_existing updates all existing targets in place
    if payload.apply_existing:
        targets = db.query(Target).all()
        for t in targets:
            cfg = dict(t.config_json or {})
            notif_ids = list(cfg.get("notification_ids") or [])
            if notif.id not in notif_ids:
                notif_ids.append(notif.id)
                cfg["notification_ids"] = notif_ids
                t.config_json = cfg

    db.commit()
    db.refresh(notif)
    logger.info("Notification channel '%s' (%s) created by %s", notif.name, notif.type, _user.username)
    return notif.to_dict()


@router.put("/{notification_id}", response_model=Dict[str, Any])
def update_notification(
    notification_id: str,
    payload: NotificationUpdateRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_admin)
):
    """Update an existing notification channel."""
    notif = db.query(Notification).filter_by(id=notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification channel not found")

    if payload.name is not None:
        notif.name = payload.name.strip()
    if payload.type is not None:
        notif.type = payload.type.strip().lower()
    if payload.is_default is not None:
        notif.is_default = payload.is_default
    if payload.active is not None:
        notif.active = payload.active
    if payload.config is not None:
        # Preserve redacted secrets if user submitted placeholder
        merged = dict(notif.config_json or {})
        for k, v in payload.config.items():
            if v == "••••••••":
                continue  # keep existing secret
            merged[k] = v
        notif.config_json = merged

    if payload.apply_existing:
        targets = db.query(Target).all()
        for t in targets:
            cfg = dict(t.config_json or {})
            notif_ids = list(cfg.get("notification_ids") or [])
            if notif.id not in notif_ids:
                notif_ids.append(notif.id)
                cfg["notification_ids"] = notif_ids
                t.config_json = cfg

    db.commit()
    db.refresh(notif)
    logger.info("Notification channel '%s' updated by %s", notif.name, _user.username)
    return notif.to_dict()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_admin)
):
    """Delete a notification channel and dissociate from monitors."""
    notif = db.query(Notification).filter_by(id=notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification channel not found")

    # Clean up reference from all targets
    targets = db.query(Target).all()
    for t in targets:
        cfg = dict(t.config_json or {})
        notif_ids = cfg.get("notification_ids")
        if notif_ids and notification_id in notif_ids:
            cfg["notification_ids"] = [nid for nid in notif_ids if nid != notification_id]
            t.config_json = cfg

    db.delete(notif)
    db.commit()
    logger.info("Notification channel '%s' deleted by %s", notif.name, _user.username)
    return None


@router.post("/test", response_model=Dict[str, Any])
def test_notification(
    payload: NotificationTestRequest,
    _user=Depends(require_admin)
):
    """Send immediate test alert to verify notification channel settings."""
    result = test_notification_channel(
        notif_type=payload.type,
        name=payload.name,
        cfg=payload.config
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Test alert delivery failed"))
    return result
