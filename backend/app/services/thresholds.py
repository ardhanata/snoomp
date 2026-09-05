"""
Effective alarm thresholds for a monitor, and the status they imply.

Resolution order, most specific first:

    target.config_json["thresholds"]  →  global settings  →  DEFAULTS

Evaluation runs in the worker once the checker has returned, rather than inside
each checker. That keeps every checker signature untouched, gives latency
ceilings a home (checkers do not see their own response time), and means there
is exactly one place where a resource reading becomes a status.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Ordered worst-first. Used to decide whether an escalation is real.
_SEVERITY = ["up", "warning", "degraded", "critical", "down", "off"]

#: Monitor types whose cpu/mem/disk readings are genuine resource percentages.
#:
#: Everything else must be excluded, because the database checkers reuse those
#: same field names for unrelated quantities so the existing resource chart has
#: something to plot:
#:
#:     db_check.py      disk_percent := cache hit ratio   (100% is ideal)
#:     mongodb.py       disk_percent := op counter scaled
#:     redis_check.py   disk_percent := ops/sec scaled
#:     worker/tasks.py  cpu_percent  := queries/sec,  mem_percent := connections
#:
#: Treating those as utilisation inverts their meaning — a perfectly healthy
#: Postgres with a 100% buffer cache hit ratio reads as "disk at 100%".
RESOURCE_METRIC_TYPES = frozenset({"snmp", "ssh", "push"})

_KEYS = (
    "cpu_warn", "cpu_crit",
    "mem_warn", "mem_crit",
    "disk_warn", "disk_crit",
    "latency_warn", "latency_crit",
)


def _num(value: Any) -> float | None:
    """Coerce to float, treating blanks and junk as 'not configured'."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def resolve(target_cfg: dict | None, global_thresholds: dict | None) -> dict[str, float | None]:
    """Merge a monitor's overrides onto the fleet-wide values."""
    from app.services.settings_store import DEFAULTS

    base = dict(DEFAULTS["thresholds"])
    if global_thresholds:
        for k in _KEYS:
            if k in global_thresholds:
                base[k] = global_thresholds[k]

    overrides = ((target_cfg or {}).get("thresholds")) or {}
    for k in _KEYS:
        # Only a genuinely supplied value overrides; an empty string in the
        # form means "inherit", not "zero".
        if k in overrides:
            v = _num(overrides[k])
            if v is not None:
                base[k] = v

    return {k: _num(base.get(k)) for k in _KEYS}


def _worst(a: str, b: str) -> str:
    try:
        return a if _SEVERITY.index(a) >= _SEVERITY.index(b) else b
    except ValueError:
        return b


def evaluate(
    status: str,
    response_time_ms: float | None,
    details: dict | None,
    thresholds: dict[str, float | None],
    target_type: str | None = None,
) -> tuple[str, str | None]:
    """
    Escalate `status` if any reading breaches its ceiling.

    Resource ceilings only apply to types in RESOURCE_METRIC_TYPES; latency
    applies to everything, since response time means the same thing for every
    monitor. Never de-escalates: a monitor that is down stays down regardless
    of what its last known CPU reading was.
    """
    # Connectivity failures outrank resource pressure — and their `details`
    # are stale or empty anyway.
    if status in ("down", "off"):
        return status, None

    details = details or {}
    breaches: list[str] = []
    is_resource_type = (target_type or "").lower() in RESOURCE_METRIC_TYPES

    # For host types the resource verdict is recomputed from "up" rather than
    # escalated from what the checker decided.
    #
    # evaluate_resource_status() runs inside the SNMP and SSH checkers against
    # hardcoded 80/95 fallbacks, because a checker has no database session and
    # cannot know this monitor's configuration. Escalating from its answer
    # would make those fallbacks a floor: a host at 85% CPU whose monitor is
    # configured to tolerate 90% would arrive here already marked "warning",
    # and since escalation never relaxes a status, the override would be
    # silently ignored. Recomputing makes the resolved thresholds
    # authoritative in both directions.
    result = "up" if is_resource_type else status

    def check(label: str, value: Any, warn_key: str, crit_key: str, unit: str) -> None:
        nonlocal result
        v = _num(value)
        if v is None:
            return
        crit = thresholds.get(crit_key)
        warn = thresholds.get(warn_key)
        if crit is not None and v >= crit:
            result = _worst(result, "critical")
            breaches.append(f"{label} {v:.1f}{unit} ≥ {crit:g}{unit}")
        elif warn is not None and v >= warn:
            result = _worst(result, "warning")
            breaches.append(f"{label} {v:.1f}{unit} ≥ {warn:g}{unit}")

    if is_resource_type:
        check("CPU", details.get("cpu_percent"), "cpu_warn", "cpu_crit", "%")
        check("Memory", details.get("mem_percent"), "mem_warn", "mem_crit", "%")
        check("Disk", details.get("disk_percent"), "disk_warn", "disk_crit", "%")

    check("Latency", response_time_ms, "latency_warn", "latency_crit", "ms")

    reason = "Threshold exceeded: " + ", ".join(breaches) if breaches else None

    if is_resource_type:
        # Never report better than the checker's own connectivity verdict.
        return _worst(result, "up"), reason
    return (result, reason) if breaches else (status, None)


def apply(target, status: str, response_time_ms: float | None, details: dict | None,
          global_thresholds: dict | None = None) -> tuple[str, str | None]:
    """Convenience wrapper: resolve this target's thresholds, then evaluate."""
    try:
        th = resolve(target.config_json or {}, global_thresholds)
        return evaluate(status, response_time_ms, details, th,
                        target_type=getattr(target, "type", None))
    except Exception as exc:  # noqa: BLE001 — a bad threshold must not drop a check
        logger.warning("Threshold evaluation failed for %s: %s", getattr(target, "id", "?"), exc)
        return status, None
