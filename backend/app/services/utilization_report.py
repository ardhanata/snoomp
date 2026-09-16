"""
Metric utilization reporting service.

Aggregates time-series system and database engine metrics (CPU, RAM, Disk,
load averages, database connections, cache hit ratios) into summary statistics,
saturation analysis, and downsampled timeline intervals for reporting.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.metrics import SystemMetrics
from app.models.target import Target


def _metric_stats(samples: List[Tuple[float, datetime.datetime]]) -> Optional[Dict[str, Any]]:
    """Compute summary statistics (current, avg, min, max/peak, p95, peak_time) for metric series."""
    if not samples:
        return None
    vals = [v for v, _ in samples]
    vals_sorted = sorted(vals)
    n = len(vals)
    cur_val = vals[-1]
    avg_val = sum(vals) / n
    min_val = vals_sorted[0]
    max_val = vals_sorted[-1]
    p95_val = vals_sorted[min(n - 1, int(n * 0.95))]

    peak_ts: Optional[str] = None
    for v, ts in samples:
        if v == max_val:
            peak_ts = ts.isoformat() if ts else None
            break

    return {
        "current": round(cur_val, 2),
        "avg": round(avg_val, 2),
        "min": round(min_val, 2),
        "max": round(max_val, 2),
        "p95": round(p95_val, 2),
        "samples": n,
        "peak_time": peak_ts,
    }


def get_target_utilization_report(target_id: str, hours: int = 168, db: Session = None) -> Dict[str, Any]:
    """
    Generate comprehensive utilization report for a monitor over the specified hours window.
    """
    hours = max(1, min(hours, 24 * 400))
    target = db.query(Target).filter_by(id=target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    now = datetime.datetime.now(datetime.timezone.utc)
    window_start = now - datetime.timedelta(hours=hours)

    rows = (
        db.query(SystemMetrics)
        .filter(SystemMetrics.target_id == target_id)
        .filter(SystemMetrics.checked_at >= window_start)
        .order_by(SystemMetrics.checked_at.asc())
        .all()
    )

    is_metric_target = target.type.lower() in ["ssh", "snmp", "push", "db", "mongodb", "redis"]

    if not rows:
        return {
            "target_id": target_id,
            "target_name": target.name or target_id,
            "target_host": target.host or "",
            "target_type": target.type.lower(),
            "range_hours": hours,
            "has_metrics": False,
            "supports_metrics": is_metric_target,
            "total_samples": 0,
            "message": (
                "No system telemetry recorded in this window."
                if is_metric_target
                else f"Monitor type {target.type.upper()} does not collect OS resource metrics."
            ),
            "verdict": "No Data",
            "verdict_level": "nodata",
            "verdict_summary": "No resource utilization samples recorded in the selected period.",
            "cpu": None,
            "memory": None,
            "disk": None,
            "host_info": {},
            "partitions": [],
            "database": None,
            "spikes": [],
            "saturation": {
                "cpu_warning_pct": 0.0,
                "cpu_critical_pct": 0.0,
                "mem_warning_pct": 0.0,
                "mem_critical_pct": 0.0,
                "disk_warning_pct": 0.0,
                "disk_critical_pct": 0.0,
                "total_spikes": 0,
            },
            "timeline": [],
        }

    cpu_samples: List[Tuple[float, datetime.datetime]] = []
    mem_samples: List[Tuple[float, datetime.datetime]] = []
    disk_samples: List[Tuple[float, datetime.datetime]] = []

    latest_details: Dict[str, Any] = {}
    latest_uptime: Optional[str] = None

    # Custom database metrics series
    db_conns: List[Tuple[float, datetime.datetime]] = []
    db_cache_hits: List[Tuple[float, datetime.datetime]] = []
    db_ops: List[Tuple[float, datetime.datetime]] = []

    # Saturation threshold tracking
    cpu_warn_count = 0
    cpu_crit_count = 0
    mem_warn_count = 0
    mem_crit_count = 0
    disk_warn_count = 0
    disk_crit_count = 0
    spikes: List[Dict[str, Any]] = []

    for r in rows:
        ts = r.checked_at
        if not ts:
            continue
        # Ensure UTC timezone awareness
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=datetime.timezone.utc)

        if r.uptime:
            latest_uptime = r.uptime
        if r.details_json and isinstance(r.details_json, dict):
            latest_details = r.details_json

        # CPU
        if r.cpu_percent is not None:
            c = float(r.cpu_percent)
            cpu_samples.append((c, ts))
            if c >= 90.0:
                cpu_crit_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "CPU",
                    "value": round(c, 1),
                    "threshold": 90.0,
                    "severity": "critical",
                    "note": f"Critical CPU load: {c:.1f}%",
                })
            elif c >= 80.0:
                cpu_warn_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "CPU",
                    "value": round(c, 1),
                    "threshold": 80.0,
                    "severity": "warning",
                    "note": f"Elevated CPU load: {c:.1f}%",
                })

        # Memory
        if r.mem_percent is not None:
            m = float(r.mem_percent)
            mem_samples.append((m, ts))
            if m >= 95.0:
                mem_crit_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "Memory",
                    "value": round(m, 1),
                    "threshold": 95.0,
                    "severity": "critical",
                    "note": f"Critical Memory exhaustion: {m:.1f}%",
                })
            elif m >= 85.0:
                mem_warn_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "Memory",
                    "value": round(m, 1),
                    "threshold": 85.0,
                    "severity": "warning",
                    "note": f"Elevated Memory consumption: {m:.1f}%",
                })

        # Disk
        if r.disk_percent is not None:
            d = float(r.disk_percent)
            disk_samples.append((d, ts))
            if d >= 90.0:
                disk_crit_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "Disk",
                    "value": round(d, 1),
                    "threshold": 90.0,
                    "severity": "critical",
                    "note": f"Critical Storage capacity: {d:.1f}%",
                })
            elif d >= 85.0:
                disk_warn_count += 1
                spikes.append({
                    "timestamp": ts.isoformat(),
                    "metric": "Disk",
                    "value": round(d, 1),
                    "threshold": 85.0,
                    "severity": "warning",
                    "note": f"Elevated Storage utilization: {d:.1f}%",
                })

        # Database metric series extraction from details_json
        if r.details_json and isinstance(r.details_json, dict):
            dj = r.details_json
            # Connections / Clients
            conns = dj.get("active_connections") or dj.get("connected_clients") or dj.get("current_connections")
            if conns is not None and isinstance(conns, (int, float)):
                db_conns.append((float(conns), ts))
            # Cache hit ratio
            chr_val = dj.get("cache_hit_ratio") or dj.get("buffer_cache_hit_ratio")
            if chr_val is not None and isinstance(chr_val, (int, float)):
                db_cache_hits.append((float(chr_val), ts))
            # Throughput / ops / qps
            qps = dj.get("queries_per_sec") or dj.get("ops_per_sec") or dj.get("qps")
            if qps is not None and isinstance(qps, (int, float)):
                db_ops.append((float(qps), ts))

    cpu_stats = _metric_stats(cpu_samples)
    mem_stats = _metric_stats(mem_samples)
    disk_stats = _metric_stats(disk_samples)

    total_n = len(rows)

    # Host info
    host_info = {
        "uptime": latest_uptime or latest_details.get("uptime") or "Active",
        "cpu_cores": latest_details.get("cpu_cores") or 1,
        "ram_total_gb": latest_details.get("ram_total_gb"),
        "disk_total_gb": latest_details.get("disk_total_gb"),
        "load_1min": latest_details.get("load_1min"),
        "load_percent": latest_details.get("load_percent"),
        "os_type": latest_details.get("os_type") or ("Windows" if "Windows" in str(latest_uptime) else "Linux/POSIX"),
    }

    # Disk partitions
    partitions: List[Dict[str, Any]] = []
    raw_disks = latest_details.get("disks") or []
    if isinstance(raw_disks, list):
        for d in raw_disks:
            if isinstance(d, dict):
                partitions.append({
                    "mount": d.get("mount") or d.get("filesystem") or "/",
                    "size_gb": d.get("size_gb") or d.get("total_gb"),
                    "used_gb": d.get("used_gb"),
                    "use_pct": d.get("use_pct") or d.get("percent"),
                    "fstype": d.get("fstype", ""),
                })
        partitions.sort(key=lambda p: float(p.get("use_pct") or 0.0), reverse=True)

    # Database summary
    database_summary = None
    if target.type.lower() in ["db", "mongodb", "redis"] or db_conns or db_cache_hits:
        database_summary = {
            "connections": _metric_stats(db_conns),
            "cache_hit_ratio": _metric_stats(db_cache_hits),
            "ops_per_sec": _metric_stats(db_ops),
            "total_size_mb": latest_details.get("total_db_size_mb") or latest_details.get("db_size_mb"),
            "keyspace_keys": latest_details.get("keyspace_keys"),
        }

    # Saturation metrics
    saturation = {
        "cpu_warning_pct": round(cpu_warn_count / total_n * 100, 2) if total_n else 0.0,
        "cpu_critical_pct": round(cpu_crit_count / total_n * 100, 2) if total_n else 0.0,
        "mem_warning_pct": round(mem_warn_count / total_n * 100, 2) if total_n else 0.0,
        "mem_critical_pct": round(mem_crit_count / total_n * 100, 2) if total_n else 0.0,
        "disk_warning_pct": round(disk_warn_count / total_n * 100, 2) if total_n else 0.0,
        "disk_critical_pct": round(disk_crit_count / total_n * 100, 2) if total_n else 0.0,
        "total_spikes": len(spikes),
    }

    # Capacity Verdict
    peak_cpu = cpu_stats["max"] if cpu_stats else 0.0
    peak_mem = mem_stats["max"] if mem_stats else 0.0
    peak_disk = disk_stats["max"] if disk_stats else 0.0

    if peak_cpu >= 90.0 or peak_mem >= 95.0 or peak_disk >= 90.0:
        verdict = "Critical Saturation"
        verdict_level = "critical"
        verdict_summary = "One or more resources exceeded critical operating capacity limits."
    elif peak_cpu >= 80.0 or peak_mem >= 85.0 or peak_disk >= 85.0:
        verdict = "Elevated Load"
        verdict_level = "warning"
        verdict_summary = "Elevated resource demand observed during peak operational periods."
    else:
        verdict = "Optimal Headroom"
        verdict_level = "optimal"
        verdict_summary = "Monitored resources maintained safe operational headroom throughout the period."

    # Downsampled Timeline Bucketing
    bucket_count = 24 if hours <= 24 else (14 if hours <= 168 else 30)
    bucket_seconds = (hours * 3600) / bucket_count
    buckets: List[Dict[str, Any]] = [
        {"cpus": [], "mems": [], "disks": []} for _ in range(bucket_count)
    ]

    for r in rows:
        ts = r.checked_at
        if not ts:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=datetime.timezone.utc)
        idx = int((ts - window_start).total_seconds() // bucket_seconds)
        if 0 <= idx < bucket_count:
            b = buckets[idx]
            if r.cpu_percent is not None:
                b["cpus"].append(float(r.cpu_percent))
            if r.mem_percent is not None:
                b["mems"].append(float(r.mem_percent))
            if r.disk_percent is not None:
                b["disks"].append(float(r.disk_percent))

    timeline = []
    for i, b in enumerate(buckets):
        b_start = window_start + datetime.timedelta(seconds=bucket_seconds * i)
        c_vals = b["cpus"]
        m_vals = b["mems"]
        d_vals = b["disks"]
        timeline.append({
            "start": b_start.isoformat(),
            "samples": max(len(c_vals), len(m_vals), len(d_vals)),
            "avg_cpu": round(sum(c_vals) / len(c_vals), 1) if c_vals else None,
            "max_cpu": round(max(c_vals), 1) if c_vals else None,
            "avg_mem": round(sum(m_vals) / len(m_vals), 1) if m_vals else None,
            "max_mem": round(max(m_vals), 1) if m_vals else None,
            "avg_disk": round(sum(d_vals) / len(d_vals), 1) if d_vals else None,
            "max_disk": round(max(d_vals), 1) if d_vals else None,
        })

    # Sort spikes descending by timestamp, cap at 25 items
    spikes.sort(key=lambda s: s["timestamp"], reverse=True)
    recent_spikes = spikes[:25]

    return {
        "target_id": target_id,
        "target_name": target.name or target_id,
        "target_host": target.host or "",
        "target_type": target.type.lower(),
        "range_hours": hours,
        "has_metrics": True,
        "supports_metrics": True,
        "total_samples": total_n,
        "verdict": verdict,
        "verdict_level": verdict_level,
        "verdict_summary": verdict_summary,
        "cpu": cpu_stats,
        "memory": mem_stats,
        "disk": disk_stats,
        "host_info": host_info,
        "partitions": partitions,
        "database": database_summary,
        "spikes": recent_spikes,
        "saturation": saturation,
        "timeline": timeline,
    }
