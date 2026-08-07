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

# Standardized Thresholds
CPU_WARN, CPU_CRIT = 80.0, 95.0
MEM_WARN, MEM_CRIT = 85.0, 95.0
DISK_WARN, DISK_CRIT = 85.0, 95.0

def evaluate_resource_status(cpu: float, mem: float, disk: float) -> str:
    if cpu >= CPU_CRIT or mem >= MEM_CRIT or disk >= DISK_CRIT:
        return "critical"
    if cpu >= CPU_WARN or mem >= MEM_WARN or disk >= DISK_WARN:
        return "warning"
    return "up"
