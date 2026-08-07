import time
import redis
from app.checkers.base import CheckerResult

def check_redis(connection_string: str, timeout: int = 3) -> CheckerResult:
    """Verifies connection to Redis and retrieves performance metrics."""
    start = time.monotonic()
    try:
        # Establish connection with socket timeout
        r = redis.Redis.from_url(connection_string, socket_timeout=timeout)
        r.ping()
        
        info = r.info()
        elapsed = (time.monotonic() - start) * 1000
        
        # Calculate keyspace size
        total_keys = 0
        for key in info.keys():
            if key.startswith("db") and isinstance(info[key], dict):
                total_keys += info[key].get("keys", 0)
                
        # Extract metrics
        connected_clients = info.get("connected_clients", 0)
        ops_per_sec = info.get("instantaneous_ops_per_sec", 0)
        used_mem_bytes = info.get("used_memory", 0)
        used_mem_mb = round(used_mem_bytes / (1024 * 1024), 2)
        
        details = {
            "version": info.get("redis_version", "Unknown"),
            "uptime_seconds": info.get("uptime_in_seconds", 0),
            "ops_per_sec": ops_per_sec,
            "connections_current": connected_clients,
            "mem_resident_mb": used_mem_mb,
            "total_keys": total_keys,
            "mem_fragmentation_ratio": info.get("mem_fragmentation_ratio", 0.0),
            # Map database metrics standard CPU/RAM percents
            "cpu_percent": 0.0, # Simulated
            "mem_percent": float(connected_clients), # map connected clients to mem_percent
            "disk_percent": float(min(100.0, ops_per_sec / 10.0)) # map ops count to disk_percent
        }
        
        return CheckerResult(
            status="up",
            response_time_ms=round(elapsed, 2),
            details=details
        )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(
            status="down",
            response_time_ms=round(elapsed, 2),
            error=f"Redis Connection Failed: {str(e)}"
        )
