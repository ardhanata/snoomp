import os
import logging
import json
import datetime
import redis
from celery import Celery
from sqlalchemy.orm import Session

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
celery_app = Celery("snoomp_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)

# Redis client for publishing live updates
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client = redis.Redis.from_url(REDIS_URL)

# Add backend directory to path if needed for imports
import sys
sys.path.append("/workspace")

from app.database import SessionLocal
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics
from app.models.incident import Incident
from app.checkers.http import check_http
from app.checkers.ping import check_icmp
from app.checkers.snmp import check_snmp
from app.checkers.ssh import check_ssh
from app.checkers.tcp import check_tcp
from app.checkers.dns import check_dns
from app.checkers.db_check import check_postgres
from app.checkers.mongodb import check_mongodb
from app.checkers.redis_check import check_redis
from app.notifications.manager import build_apprise_uri, send_notification

async def execute_checker(target: Target) -> dict:
    """Executes the correct check based on target type and custom config."""
    cfg = target.config_json or {}
    t_type = target.type.lower()
    
    if t_type == "http":
        res = await check_http(
            host=target.host,
            path=target.path or "/",
            port=target.port,
            timeout=cfg.get("timeout", 10),
            scheme=cfg.get("scheme", "http"),
            method=cfg.get("method", "GET"),
            headers=cfg.get("headers"),
            body=cfg.get("body"),
            accepted_status_codes=cfg.get("accepted_status_codes"),
            ignore_tls=cfg.get("ignore_tls", False)
        )
        return res.to_dict()
        
    elif t_type == "ping":
        res = check_icmp(
            host=target.host,
            count=cfg.get("count", 3),
            timeout=cfg.get("timeout", 2)
        )
        return res.to_dict()
        
    elif t_type == "tcp":
        res = check_tcp(
            host=target.host,
            port=target.port or 80,
            timeout=cfg.get("timeout", 5)
        )
        return res.to_dict()
        
    elif t_type == "dns":
        res = check_dns(
            hostname=target.host,
            dns_server=cfg.get("dns_server"),
            resolve_type=cfg.get("resolve_type", "A"),
            timeout=cfg.get("timeout", 5)
        )
        return res.to_dict()
        
    elif t_type == "db":
        res = check_postgres(
            connection_string=cfg.get("connection_string", ""),
            query=cfg.get("query", "SELECT 1"),
            timeout=cfg.get("timeout", 5)
        )
        return res.to_dict()
        
    elif t_type == "mongodb":
        res = check_mongodb(
            connection_string=cfg.get("connection_string", ""),
            timeout=cfg.get("timeout", 5)
        )
        return res.to_dict()
        
    elif t_type == "redis":
        res = check_redis(
            connection_string=cfg.get("connection_string", ""),
            timeout=cfg.get("timeout", 5)
        )
        return res.to_dict()
        
    elif t_type == "snmp":
        res = await check_snmp(
            host=target.host,
            community=cfg.get("community", "public"),
            port=target.port or 161
        )
        try:
            ping_res = check_icmp(host=target.host, count=1, timeout=1)
            if ping_res.status == "up":
                res.response_time_ms = ping_res.response_time_ms
        except Exception:
            pass
        return res.to_dict()
        
    elif t_type == "ssh":
        res = await check_ssh(
            host=target.host,
            username=cfg.get("username", "root"),
            password=cfg.get("password"),
            private_key=cfg.get("private_key"),
            port=target.port or 22,
            timeout=cfg.get("timeout", 10),
            target_id=target.id,
            redis_conn=redis_client
        )
        try:
            ping_res = check_icmp(host=target.host, count=1, timeout=1)
            if ping_res.status == "up":
                res.response_time_ms = ping_res.response_time_ms
        except Exception:
            pass
        return res.to_dict()
        
    elif t_type == "push":
        # Push target is passive, if worker runs it, we check if it has timed out
        # We handle this by checking the last heartbeat in the task
        return {"status": "up", "response_time_ms": 0.0, "details": {"push": "waiting"}}
        
    return {"status": "down", "response_time_ms": 0.0, "error": f"Unknown target type: {target.type}"}

def trigger_alerts(target: Target, prev_status: str, new_status: str):
    """Sends notification using Apprise if notifications are configured."""
    cfg = target.config_json or {}
    notifications = cfg.get("notifications", []) # List of {type: 'discord', config: {...}}
    
    if not notifications:
        return
        
    uris = []
    for item in notifications:
        uri = build_apprise_uri(item.get("type"), item.get("config", {}))
        if uri:
            uris.append(uri)
            
    if not uris:
        return
        
    title = f"⚠️ Snoomp Alert: {target.name} is {new_status.upper()}"
    body = (
        f"Target: {target.name} ({target.host})\n"
        f"Type: {target.type.upper()}\n"
        f"Event: Status transitioned from {prev_status.upper()} to {new_status.upper()}\n"
        f"Time: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC"
    )
    
    send_notification(uris, title, body)
    logger.info(f"Triggered notifications for target {target.name} (status: {new_status})")

@celery_app.task
def run_check_task(target_id: str):
    """Celery task to run health check and log time-series data."""
    import asyncio
    
    db: Session = SessionLocal()
    try:
        target = db.query(Target).filter_by(id=target_id).first()
        if not target or not target.enabled:
            return
            
        # 1. Execute check
        # As Celery runs in a sync execution block, we run the async method executing
        # checkers in a new event loop.
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            res_dict = loop.run_until_complete(execute_checker(target))
        finally:
            loop.close()
            
        status = res_dict.get("status", "down")
        response_time_ms = res_dict.get("response_time_ms", 0.0)
        error = res_dict.get("error")
        details = res_dict.get("details", {})
        
        # 2. Query previous status
        prev_hb = (
            db.query(Heartbeat)
            .filter_by(target_id=target_id)
            .order_by(Heartbeat.checked_at.desc())
            .first()
        )
        prev_status = prev_hb.status if prev_hb else "up" # Default assuming UP
        
        # 3. Create Heartbeat log
        hb = Heartbeat(
            target_id=target_id,
            status=status,
            response_time_ms=response_time_ms,
            error=error,
            msg=res_dict.get("msg")
        )
        db.add(hb)
        db.flush()
        
        # 4. Handle time-series Metrics for SNMP, SSH, & Databases
        if target.type.lower() in ["snmp", "ssh", "db", "mongodb", "redis"] and status in ["up", "warning", "critical"]:
            # Extract CPU/RAM/Disk & DB details
            cpu = details.get("cpu_percent")
            if cpu is None:
                cpu = details.get("queries_per_sec") or details.get("ops_per_sec") or details.get("qps")

            mem = details.get("mem_percent")
            if mem is None:
                mem = details.get("active_connections") or details.get("connected_clients")

            disk = details.get("disk_percent")
            if disk is None:
                disk = details.get("cache_hit_ratio") or details.get("buffer_cache_hit_ratio")

            uptime = details.get("uptime")
            
            if cpu is not None or mem is not None or disk is not None or bool(details):
                metric_row = SystemMetrics(
                    target_id=target_id,
                    cpu_percent=cpu,
                    mem_percent=mem,
                    disk_percent=disk,
                    uptime=uptime,
                    details_json=details
                )
                db.add(metric_row)
                
        # 5. Handle Incident transitions
        if prev_status != status:
            now = datetime.datetime.utcnow()
            
            # Transition to a DOWN/Warning status
            if status in ["down", "degraded", "warning", "critical", "off"]:
                # Open new incident
                incident = Incident(
                    target_id=target_id,
                    from_status=prev_status,
                    to_status=status,
                    started_at=now
                )
                db.add(incident)
                db.commit()
                
                # Send alert notifications
                trigger_alerts(target, prev_status, status)
                
            # Transition to UP (recovered)
            elif status == "up":
                # Find the unresolved incident
                open_inc = (
                    db.query(Incident)
                    .filter_by(target_id=target_id)
                    .filter(Incident.resolved_at.is_(None))
                    .order_by(Incident.started_at.desc())
                    .first()
                )
                if open_inc:
                    open_inc.resolved_at = now
                    
                # Create a recovery transition record
                recovery = Incident(
                    target_id=target_id,
                    from_status=prev_status,
                    to_status=status,
                    started_at=now,
                    resolved_at=now
                )
                db.add(recovery)
                db.commit()
                
                # Send recovery notifications
                trigger_alerts(target, prev_status, status)
            else:
                db.commit()
        else:
            db.commit()
            
        # 6. Publish WebSocket update to Redis channel
        update_payload = {
            "target_id": target_id,
            "status": status,
            "response_time_ms": response_time_ms,
            "error": error,
            "details": details,
            "metrics": details,
            "checked_at": datetime.datetime.utcnow().isoformat()
        }
        redis_client.publish("snoomp_updates", json.dumps(update_payload))
        
        logger.info(f"Check completed for target {target.name} ({target_id}): Status {status.upper()}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error executing run_check_task for target_id {target_id}: {e}", exc_info=True)
    finally:
        db.close()
