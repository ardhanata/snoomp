from dataclasses import dataclass, field
from typing import Optional, Any

@dataclass
class CheckerResult:
    status: str                          # up, down, degraded, warning, critical, off
    response_time_ms: float
    error: Optional[str] = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "response_time_ms": self.response_time_ms,
            "error": self.error,
            "details": self.details,
        }

# Fallback thresholds.
#
# These are only a floor for the checker's own first pass. The authoritative
# evaluation happens in app/services/thresholds.py once the worker has the
# target in hand, because only there are the fleet settings and the monitor's
# own overrides available. A checker has no database session.
#
# Kept deliberately permissive: if this pass marked a host "warning" at a
# hardcoded 80% CPU, a monitor configured to tolerate 90% would still show as
# warning — the later evaluation can escalate a status but never relaxes one.
CPU_WARN, CPU_CRIT = 80.0, 95.0
MEM_WARN, MEM_CRIT = 85.0, 95.0
DISK_WARN, DISK_CRIT = 85.0, 95.0


def evaluate_resource_status(
    cpu: float,
    mem: float,
    disk: float,
    thresholds: dict[str, float | None] | None = None,
) -> tuple[str, str | None]:
    """
    Classify a set of resource readings.

    `thresholds` overrides the module defaults when the caller has resolved
    values for a specific monitor; the keys match app/services/thresholds.py
    (cpu_warn, cpu_crit, mem_warn, …). A None value disables that check.
    """
    t = thresholds or {}

    def limit(key: str, fallback: float) -> float | None:
        # Explicit None means "no ceiling"; a missing key means "use default".
        if key in t:
            return t[key]
        return fallback

    cpu_warn, cpu_crit = limit("cpu_warn", CPU_WARN), limit("cpu_crit", CPU_CRIT)
    mem_warn, mem_crit = limit("mem_warn", MEM_WARN), limit("mem_crit", MEM_CRIT)
    disk_warn, disk_crit = limit("disk_warn", DISK_WARN), limit("disk_crit", DISK_CRIT)

    def over(value: float, ceiling: float | None) -> bool:
        return ceiling is not None and value >= ceiling

    reasons = []
    if over(cpu, cpu_warn) or over(cpu, cpu_crit): reasons.append(f"CPU at {cpu:.1f}%")
    if over(mem, mem_warn) or over(mem, mem_crit): reasons.append(f"Memory at {mem:.1f}%")
    if over(disk, disk_warn) or over(disk, disk_crit): reasons.append(f"Disk at {disk:.1f}%")

    if over(cpu, cpu_crit) or over(mem, mem_crit) or over(disk, disk_crit):
        return "critical", f"Threshold exceeded: {', '.join(reasons)}"
    if over(cpu, cpu_warn) or over(mem, mem_warn) or over(disk, disk_warn):
        return "warning", f"Threshold exceeded: {', '.join(reasons)}"
    return "up", None
