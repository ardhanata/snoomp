import uuid
import json
import redis
import os
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

from app.database import get_db
from app.models.target import Target
from app.auth.security import require_editor, require_viewer
from app.scheduler.runner import add_target_job, remove_target_job
from worker.tasks import execute_checker

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client = redis.Redis.from_url(REDIS_URL)

router = APIRouter(prefix="/api/targets", tags=["Targets"])

class TargetCreateUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., pattern="^(http|ping|tcp|dns|push|snmp|ssh|db|mongodb|redis)$")
    host: str = Field(...)
    port: Optional[int] = None
    path: Optional[str] = None
    check_interval: int = Field(60, ge=10, le=86400)
    enabled: bool = True
    tags: List[str] = []
    config_json: Dict[str, Any] = {}



@router.get("", dependencies=[Depends(require_viewer)])
def list_targets(db: Session = Depends(get_db)):
    from app.main import compile_initial_data
    return compile_initial_data(db)

@router.get("/{target_id}", dependencies=[Depends(require_viewer)])
def get_target(target_id: str, db: Session = Depends(get_db)):
    target = db.query(Target).filter(Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target monitor not found")
    return target.to_dict()

@router.post("", dependencies=[Depends(require_editor)])
def create_target(target_in: TargetCreateUpdate, request: Request, db: Session = Depends(get_db)):
    cfg = dict(target_in.config_json or {})
    if "notification_ids" not in cfg:
        from app.models.notification import Notification
        default_notifs = db.query(Notification).filter(
            Notification.is_default.is_(True),
            Notification.active.is_(True)
        ).all()
        if default_notifs:
            cfg["notification_ids"] = [n.id for n in default_notifs]

    target = Target(
        id=str(uuid.uuid4()),
        name=target_in.name,
        type=target_in.type,
        host=target_in.host,
        port=target_in.port,
        path=target_in.path,
        check_interval=target_in.check_interval,
        enabled=target_in.enabled,
        tags=target_in.tags,
        config_json=cfg
    )
    db.add(target)
    db.commit()
    db.refresh(target)
    
    # Register to dynamic scheduler if enabled
    if target.enabled and hasattr(request.app.state, "scheduler"):
        add_target_job(request.app.state.scheduler, target)
        
    try:
        redis_client.publish("snoomp_updates", json.dumps({"type": "reload"}))
    except Exception:
        pass

    return target.to_dict()

@router.put("/{target_id}", dependencies=[Depends(require_editor)])
def update_target(target_id: str, target_in: TargetCreateUpdate, request: Request, db: Session = Depends(get_db)):
    target = db.query(Target).filter(Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target monitor not found")
        
    target.name = target_in.name
    target.type = target_in.type
    target.host = target_in.host
    target.port = target_in.port
    target.path = target_in.path
    target.check_interval = target_in.check_interval
    target.enabled = target_in.enabled
    target.tags = target_in.tags

    # F3: merge — if frontend sends the redaction sentinel, keep the old secret
    REDACT_SENTINEL = "••••••••"
    old_cfg = target.config_json or {}
    new_cfg = dict(target_in.config_json)
    for key, val in new_cfg.items():
        if val == REDACT_SENTINEL:
            new_cfg[key] = old_cfg.get(key, "")
    target.config_json = new_cfg
    
    db.commit()
    db.refresh(target)
    
    # Update scheduler job
    if hasattr(request.app.state, "scheduler"):
        if target.enabled:
            add_target_job(request.app.state.scheduler, target)
        else:
            remove_target_job(request.app.state.scheduler, target.id)
            
    try:
        redis_client.publish("snoomp_updates", json.dumps({"type": "reload"}))
    except Exception:
        pass

    return target.to_dict()

@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_editor)])
def delete_target(target_id: str, request: Request, db: Session = Depends(get_db)):
    target = db.query(Target).filter(Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target monitor not found")
        
    db.delete(target)
    db.commit()
    
    # Remove from scheduler
    if hasattr(request.app.state, "scheduler"):
        remove_target_job(request.app.state.scheduler, target_id)

    try:
        redis_client.publish("snoomp_updates", json.dumps({"type": "reload"}))
    except Exception:
        pass

@router.post("/test", dependencies=[Depends(require_editor)])
async def test_target_connection(
    target_in: TargetCreateUpdate,
    target_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Executes a one-off immediate test connection without saving to the DB."""
    # ponytail: merge redacted secrets if testing an existing saved target
    cfg = dict(target_in.config_json or {})
    if target_id:
        existing = db.query(Target).filter(Target.id == target_id).first()
        if existing and existing.config_json:
            REDACT_SENTINEL = "••••••••"
            old_cfg = existing.config_json or {}
            for k, v in cfg.items():
                if v == REDACT_SENTINEL:
                    cfg[k] = old_cfg.get(k, "")

    temp_target = Target(
        id="test-temp",
        name=target_in.name,
        type=target_in.type,
        host=target_in.host,
        port=target_in.port,
        path=target_in.path,
        enabled=True,
        config_json=cfg
    )
    
    try:
        res = await execute_checker(temp_target)
        return res
    except Exception as e:
        return {
            "status": "down",
            "response_time_ms": 0.0,
            "error": f"Connection test failed: {str(e)}",
            "details": {}
        }

@router.post("/{target_id}/refresh", dependencies=[Depends(require_editor)])
def refresh_target(target_id: str, db: Session = Depends(get_db)):
    """Triggers an immediate background check for the monitor."""
    from worker.tasks import run_check_task
    target = db.query(Target).filter_by(id=target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target monitor not found")
    run_check_task.delay(target.id)
    return {"status": "ok", "message": "Check queued"}

