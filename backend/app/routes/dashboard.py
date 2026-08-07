import datetime
import json
import redis
import os
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Dict, Any

from app.database import get_db
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics
from app.models.incident import Incident
from app.auth.security import require_viewer, require_editor
from app.checkers.base import evaluate_resource_status

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

# Redis client for WebSockets / manual push updates
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client = redis.Redis.from_url(REDIS_URL)

@router.get("/stats", dependencies=[Depends(require_viewer)])
def get_stats(db: Session = Depends(get_db)):
    """Returns aggregated stats for all monitor targets."""
    # Fetch all targets
    targets = db.query(Target).all()
    
    total = len(targets)
    active = sum(1 for t in targets if t.enabled)
    paused = total - active
    
    # We find the latest status of each enabled target
    up_count = 0
    down_count = 0
    warning_count = 0
    critical_count = 0
    
    for t in targets:
        if not t.enabled:
            continue
            
        latest_hb = (
            db.query(Heartbeat)
            .filter_by(target_id=t.id)
            .order_by(Heartbeat.checked_at.desc())
            .first()
        )
        
        if latest_hb:
            status = latest_hb.status.lower()
            if status == "up":
                up_count += 1
            elif status == "down":
                down_count += 1
            elif status == "warning":
                warning_count += 1
            elif status == "critical":
                critical_count += 1
        else:
            # If no heartbeat, default to down/unknown
            down_count += 1
            
    return {
        "total_targets": total,
        "active_targets": active,
        "paused_targets": paused,
        "status_summary": {
            "up": up_count,
            "down": down_count,
            "warning": warning_count,
            "critical": critical_count
        }
    }

@router.get("/targets/{target_id}/heartbeats", dependencies=[Depends(require_viewer)])
def get_target_heartbeats(target_id: str, limit: int = 50, db: Session = Depends(get_db)):
    """Returns the last N heartbeats for a monitor to build the status timeline blocks."""
    heartbeats = (
        db.query(Heartbeat)
        .filter_by(target_id=target_id)
        .order_by(Heartbeat.checked_at.desc())
        .limit(limit)
        .all()
    )
    # Reverse to keep chronological order
    return [hb.to_dict() for hb in reversed(heartbeats)]

@router.get("/targets/{target_id}/metrics", dependencies=[Depends(require_viewer)])
def get_target_metrics(target_id: str, hours: int = 24, db: Session = Depends(get_db)):
    """Returns system metrics time-series (CPU, RAM, Disk) for SNMP/SSH/DB monitors."""
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    
    raw_metrics = (
        db.query(SystemMetrics)
        .filter(SystemMetrics.target_id == target_id)
        .filter(SystemMetrics.checked_at >= since)
        .order_by(SystemMetrics.checked_at.asc())
        .all()
    )
    if not raw_metrics or hours <= 24:
        return [m.to_dict() for m in raw_metrics]

    # ponytail: downsample metrics for multi-day timeframes (1h buckets for 7d, 6h buckets for 30d)
    bucket_seconds = 3600 if hours <= 168 else 21600
    buckets: Dict[int, Dict[str, List[float]]] = {}
    for m in raw_metrics:
        if not m.checked_at:
            continue
        ts = m.checked_at.timestamp()
        bucket_ts = int(ts // bucket_seconds) * bucket_seconds
        if bucket_ts not in buckets:
            buckets[bucket_ts] = {"cpus": [], "mems": [], "disks": []}
        if m.cpu_percent is not None: buckets[bucket_ts]["cpus"].append(m.cpu_percent)
        if m.mem_percent is not None: buckets[bucket_ts]["mems"].append(m.mem_percent)
        if m.disk_percent is not None: buckets[bucket_ts]["disks"].append(m.disk_percent)

    result = []
    for b_ts in sorted(buckets.keys()):
        b = buckets[b_ts]
        dt_str = datetime.datetime.fromtimestamp(b_ts, tz=datetime.timezone.utc).isoformat()
        result.append({
            "id": b_ts,
            "target_id": target_id,
            "checked_at": dt_str,
            "cpu_percent": round(sum(b["cpus"]) / len(b["cpus"]), 1) if b["cpus"] else None,
            "mem_percent": round(sum(b["mems"]) / len(b["mems"]), 1) if b["mems"] else None,
            "disk_percent": round(sum(b["disks"]) / len(b["disks"]), 1) if b["disks"] else None,
        })
    return result

@router.get("/incidents", dependencies=[Depends(require_viewer)])
def get_recent_incidents(limit: int = 20, db: Session = Depends(get_db)):
    """Returns the most recent incidents and outages."""
    incidents = (
        db.query(Incident)
        .order_by(Incident.started_at.desc())
        .limit(limit)
        .all()
    )
    
    # Map target names to incidents
    result = []
    for inc in incidents:
        target = db.query(Target).filter_by(id=inc.target_id).first()
        item = inc.to_dict()
        item["target_name"] = target.name if target else "Unknown Target"
        result.append(item)
        
    return result

# F9: Payload allowlist and size cap for push endpoint
_PUSH_ALLOWED_KEYS = frozenset({
    "cpu", "cpu_percent", "memory", "mem_percent", "disk", "disk_percent",
    "uptime", "hostname", "msg", "status", "push_received",
})
_PUSH_MAX_PAYLOAD_BYTES = 32 * 1024  # 32 KB

# Push endpoint: publicly accessible (or optionally secured by query token, but target_id acts as token)
@router.api_route("/push/{target_id}", methods=["GET", "POST"])
def receive_push_heartbeat(target_id: str, request: Request = None, payload: Dict[str, Any] = None, db: Session = Depends(get_db)):
    """
    Public push monitor endpoint. 
    Accepts GET or POST requests. Can accept JSON metrics for CPU, RAM, and Disk.
    """
    target = db.query(Target).filter_by(id=target_id).first()
    if not target or not target.enabled or target.type.lower() != "push":
        raise HTTPException(status_code=404, detail="Active push target not found")
        
    cpu = None
    mem = None
    disk = None
    uptime = None
    details = {"push_received": True}
    
    # If payload is provided (POST JSON)
    if payload:
        # F9: Reject oversized payloads
        import sys
        if sys.getsizeof(str(payload)) > _PUSH_MAX_PAYLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Payload too large")

        # F9: Only keep allowed keys
        filtered = {k: v for k, v in payload.items() if k in _PUSH_ALLOWED_KEYS}

        # Check standard names: cpu, cpu_percent, memory, mem_percent, disk, disk_percent
        cpu = filtered.get("cpu") or filtered.get("cpu_percent")
        mem = filtered.get("memory") or filtered.get("mem_percent")
        disk = filtered.get("disk") or filtered.get("disk_percent")
        uptime = filtered.get("uptime")
        details.update(filtered)
        
    # Evaluate status based on resource metrics if provided, else "up"
    if cpu is not None and mem is not None and disk is not None:
        try:
            status = evaluate_resource_status(float(cpu), float(mem), float(disk))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="cpu, memory, and disk must be numeric values")
    else:
        status = "up"
        
    # Query previous status
    prev_hb = (
        db.query(Heartbeat)
        .filter_by(target_id=target_id)
        .order_by(Heartbeat.checked_at.desc())
        .first()
    )
    prev_status = prev_hb.status if prev_hb else "up"
    
    # Log Heartbeat
    hb = Heartbeat(
        target_id=target_id,
        status=status,
        response_time_ms=0.0,
        msg="Push heartbeat received"
    )
    db.add(hb)
    db.flush()
    
    # Log metrics if provided
    if cpu is not None or mem is not None or disk is not None:
        metric_row = SystemMetrics(
            target_id=target_id,
            cpu_percent=float(cpu) if cpu is not None else None,
            mem_percent=float(mem) if mem is not None else None,
            disk_percent=float(disk) if disk is not None else None,
            uptime=str(uptime) if uptime is not None else None,
            details_json=details
        )
        db.add(metric_row)
        
    # Handle Incident Transitions
    if prev_status != status:
        now = datetime.datetime.utcnow()
        if status in ["down", "degraded", "warning", "critical"]:
            incident = Incident(
                target_id=target_id,
                from_status=prev_status,
                to_status=status,
                started_at=now
            )
            db.add(incident)
        elif status == "up":
            open_inc = (
                db.query(Incident)
                .filter_by(target_id=target_id)
                .filter(Incident.resolved_at.is_(None))
                .order_by(Incident.started_at.desc())
                .first()
            )
            if open_inc:
                open_inc.resolved_at = now
            recovery = Incident(
                target_id=target_id,
                from_status=prev_status,
                to_status=status,
                started_at=now,
                resolved_at=now
            )
            db.add(recovery)
            
    db.commit()
    
    # Publish to Redis for WebSockets
    update_payload = {
        "target_id": target_id,
        "status": status,
        "response_time_ms": 0.0,
        "details": details,
        "checked_at": datetime.datetime.utcnow().isoformat()
    }
    redis_client.publish("snoomp_updates", json.dumps(update_payload))
    
    return {"status": "ok", "message": "Heartbeat registered"}

@router.get("/targets/{target_id}/db-engine-status", dependencies=[Depends(require_viewer)])
def get_db_engine_status(target_id: str, db: Session = Depends(get_db)):
    """Fetches real-time database details and slow logs directly from the target database."""
    target = db.query(Target).filter_by(id=target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
        
    t_type = target.type.lower()
    cfg = target.config_json or {}
    conn_str = cfg.get("connection_string", "")
    
    if not conn_str:
        raise HTTPException(status_code=400, detail="Connection URI not configured for this target")
        
    try:
        if t_type == "db":
            # PostgreSQL Engine Diagnostics
            import psycopg2
            import psycopg2.extras
            with psycopg2.connect(conn_str, connect_timeout=5) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                    # 1. Version
                    cursor.execute("SELECT version()")
                    version_full = cursor.fetchone()["version"]
                    
                    # 2. Uptime
                    cursor.execute("SELECT pg_postmaster_start_time()")
                    uptime_start = cursor.fetchone()["pg_postmaster_start_time"]
                    uptime_seconds = None
                    if uptime_start:
                        import datetime as dt
                        uptime_seconds = (dt.datetime.now(uptime_start.tzinfo) - uptime_start).total_seconds()
                    
                    # 3. Total server size (ALL databases)
                    cursor.execute("""
                        SELECT sum(pg_database_size(datname)) / (1024.0 * 1024.0) AS total_mb,
                               count(*) AS db_count
                        FROM pg_database WHERE datistemplate = false
                    """)
                    size_row = cursor.fetchone()
                    total_server_mb = round(float(size_row["total_mb"] or 0), 2)
                    db_count = size_row["db_count"]
                    
                    # 4. Connection stats
                    cursor.execute("SELECT count(*) AS active FROM pg_stat_activity WHERE state IS NOT NULL")
                    active_conns = cursor.fetchone()["active"]
                    cursor.execute("SELECT setting::int FROM pg_settings WHERE name = 'max_connections'")
                    max_conns = cursor.fetchone()["setting"]
                    
                    # 5. Server config
                    cursor.execute("""
                        SELECT name, setting, unit FROM pg_settings 
                        WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem')
                    """)
                    config_rows = cursor.fetchall()
                    server_config = {}
                    for cr in config_rows:
                        val = int(cr["setting"])
                        unit = cr["unit"] or ""
                        if unit == "8kB":
                            server_config[cr["name"]] = f"{round(val * 8 / 1024)} MB"
                        elif unit == "kB":
                            server_config[cr["name"]] = f"{round(val / 1024)} MB"
                        else:
                            server_config[cr["name"]] = f"{val} {unit}".strip()
                    
                    # 6. Active Slow Queries (> 1s) & Idle-in-Transaction / Long-Idle Connection Leaks (> 3m)
                    cursor.execute("""
                        SELECT pid, usename, datname, client_addr, application_name, state, 
                               COALESCE(now() - query_start, now() - state_change) AS duration, query 
                        FROM pg_stat_activity 
                        WHERE (
                            (state = 'active' AND (now() - query_start) > interval '1 second')
                            OR (state = 'idle' AND (now() - state_change) > interval '3 minutes')
                        )
                          AND pid <> pg_backend_pid()
                          AND query NOT LIKE '%pg_stat_activity%'
                        ORDER BY duration DESC 
                        LIMIT 25
                    """)
                    slow_queries = cursor.fetchall()
                    for sq in slow_queries:
                        if sq.get("duration"):
                            sq["duration_sec"] = sq["duration"].total_seconds()
                            del sq["duration"]
                        if sq.get("client_addr"):
                            sq["client_addr"] = str(sq["client_addr"])
                            
                    # 7. List ALL databases with sizes
                    cursor.execute("""
                        SELECT d.datname AS table_name,
                               pg_size_pretty(pg_database_size(d.datname)) AS total_size,
                               pg_database_size(d.datname) AS size_bytes
                        FROM pg_database d
                        WHERE d.datistemplate = false
                        ORDER BY pg_database_size(d.datname) DESC
                    """)
                    databases = cursor.fetchall()
                    for db_row in databases:
                        db_row.pop("size_bytes", None)

                    # 8. List Tablespaces with size and location
                    tablespaces = []
                    try:
                        cursor.execute("""
                            SELECT spcname AS tablespace_name,
                                   pg_size_pretty(pg_tablespace_size(oid)) AS size,
                                   COALESCE(NULLIF(pg_tablespace_location(oid), ''), 'pg_default') AS location
                            FROM pg_tablespace
                            ORDER BY pg_tablespace_size(oid) DESC
                        """)
                        tablespaces = cursor.fetchall()
                    except Exception:
                        tablespaces = []
                    
                    return {
                        "type": "postgresql",
                        "info": {
                            "version": version_full,
                            "uptime_start": uptime_start.isoformat() if uptime_start else None,
                            "uptime_seconds": uptime_seconds,
                            "storage_size_mb": total_server_mb,
                            "database_count": db_count,
                            "active_connections": active_conns,
                            "max_connections": max_conns,
                            "shared_buffers": server_config.get("shared_buffers"),
                            "effective_cache_size": server_config.get("effective_cache_size"),
                            "work_mem": server_config.get("work_mem"),
                        },
                        "slow_queries": slow_queries,
                        "tables": databases,
                        "tablespaces": tablespaces
                    }
                    
        elif t_type == "mongodb":
            # MongoDB Engine Diagnostics
            from pymongo import MongoClient
            client = MongoClient(conn_str, serverSelectionTimeoutMS=3000)
            server_status = client.admin.command("serverStatus")
            
            # Fetch current running operations
            current_ops = client.admin.command("currentOp", {"$all": True})
            in_progress = []
            for op in current_ops.get("inprog", []):
                # Filter client queries/commands taking > 1 second
                if op.get("secs_running", 0) > 1 and op.get("op") != "none":
                    in_progress.append({
                        "pid": op.get("opid"),
                        "usename": op.get("appName", "N/A"),
                        "client_addr": op.get("client", "N/A"),
                        "state": op.get("op"),
                        "duration_sec": op.get("secs_running"),
                        "query": str(op.get("command", {}))
                    })
                    
            # Fetch storage stats for all databases
            total_storage_mb = 0
            tables_info = []
            
            try:
                dbs = client.list_database_names()
                for db_name in dbs:
                    db_stats = client[db_name].command("dbStats")
                    size_mb = round(db_stats.get("storageSize", 0) / (1024 * 1024), 2)
                    total_storage_mb += size_mb
                    tables_info.append({"table_name": db_name, "total_size": f"{size_mb} MB"})
            except Exception:
                tables_info = []

            # Admin DB for global objects count
            admin_stats = client.admin.command("dbStats")
            
            client.close()
            
            connections = server_status.get("connections", {})
            mem = server_status.get("mem", {})
            
            return {
                "type": "mongodb",
                "info": {
                    "version": server_status.get("version"),
                    "uptime_seconds": server_status.get("uptime"),
                    "storage_size_mb": round(total_storage_mb, 2),
                    "database_count": len(tables_info),
                    "active_connections": connections.get("current", 0),
                    "max_connections": connections.get("current", 0) + connections.get("available", 0),
                    "shared_buffers": f"{mem.get('resident', 0)} MB",
                    "effective_cache_size": f"{mem.get('virtual', 0)} MB",
                    "objects_count": admin_stats.get("objects", 0),
                    "collections_count": admin_stats.get("collections", 0)
                },
                "slow_queries": in_progress[:15],
                "tables": sorted(tables_info, key=lambda x: float(x["total_size"].replace(" MB", "")), reverse=True)
            }
            
        elif t_type == "redis":
            # Redis Engine Diagnostics
            import redis
            r = redis.Redis.from_url(conn_str, socket_timeout=3)
            info = r.info()
            
            # Fetch slowlog entries
            slowlog = r.slowlog_get(num=15)
            formatted_slowlog = []
            for entry in slowlog:
                # Redis returns: {id, start_time, duration, command}
                formatted_slowlog.append({
                    "pid": entry.get("id"),
                    "usename": "Redis Client",
                    "client_addr": "N/A",
                    "state": "SLOWLOG",
                    "duration_sec": entry.get("duration", 0) / 1000000.0, # convert microseconds to seconds
                    "query": " ".join([c.decode("utf-8", errors="ignore") if isinstance(c, bytes) else str(c) for c in entry.get("command", [])])
                })
                
            return {
                "type": "redis",
                "info": {
                    "version": info.get("redis_version"),
                    "uptime_seconds": info.get("uptime_in_seconds"),
                    "used_memory_human": info.get("used_memory_human"),
                    "peak_memory_human": info.get("used_memory_peak_human")
                },
                "slow_queries": formatted_slowlog,
                "tables": [{"table_name": f"DB {k.replace('db', '')}", "total_size": f"{v.get('keys', 0)} keys"} for k, v in info.items() if k.startswith("db") and isinstance(v, dict)]
            }
            
        else:
            raise HTTPException(status_code=400, detail="Diagnostics only supported for PostgreSQL, MongoDB, and Redis targets")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query database engine diagnostics: {str(e)}")
