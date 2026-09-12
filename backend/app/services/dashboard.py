import datetime as dt
from sqlalchemy.orm import Session
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics

def compile_initial_data(db: Session) -> list:
    targets_list = db.query(Target).all()
    initial_data = []
    for t in targets_list:
        latest_hb = (
            db.query(Heartbeat)
            .filter_by(target_id=t.id)
            .order_by(Heartbeat.checked_at.desc())
            .first()
        )
        
        # Get latest metrics for SNMP/SSH/DBs/HTTP
        metrics = None
        if t.type.lower() in ["snmp", "ssh", "db", "mongodb", "redis", "http"]:
            latest_metric = (
                db.query(SystemMetrics)
                .filter_by(target_id=t.id)
                .order_by(SystemMetrics.checked_at.desc())
                .first()
            )
            if latest_metric:
                metrics = latest_metric.details_json or {
                    "cpu_percent": latest_metric.cpu_percent,
                    "mem_percent": latest_metric.mem_percent,
                    "disk_percent": latest_metric.disk_percent,
                    "uptime": latest_metric.uptime
                }

        # Recent 30 heartbeats for sidebar mini bars
        recent_hbs = (
            db.query(Heartbeat)
            .filter_by(target_id=t.id)
            .order_by(Heartbeat.checked_at.desc())
            .limit(30)
            .all()
        )

        # Calculate 24h uptime %
        cutoff = dt.datetime.utcnow() - dt.timedelta(hours=24)
        hbs_24h = db.query(Heartbeat).filter(
            Heartbeat.target_id == t.id,
            Heartbeat.checked_at >= cutoff
        ).all()
        up_24h = sum(1 for h in hbs_24h if h.status != 'down')
        total_24h = len(hbs_24h) or 1
        uptime_pct = round((up_24h / total_24h) * 100, 2)

        item = t.to_dict()
        item["status"] = latest_hb.status if latest_hb else "down" if t.enabled else "off"
        item["response_time_ms"] = latest_hb.response_time_ms if latest_hb else 0.0
        item["error"] = latest_hb.error if latest_hb else None
        item["metrics"] = metrics
        item["uptime_24h"] = uptime_pct
        item["recent_heartbeats"] = [
            {"status": h.status} for h in reversed(recent_hbs)
        ]
        initial_data.append(item)
    return initial_data
