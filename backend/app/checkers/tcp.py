import socket
import time
from app.checkers.base import CheckerResult

def check_tcp(host: str, port: int, timeout: int = 5) -> CheckerResult:
    """Checks if a TCP port is open and returns the connection latency."""
    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            elapsed = (time.monotonic() - start) * 1000
            return CheckerResult(
                status="up",
                response_time_ms=round(elapsed, 2),
                details={"port": port}
            )
    except socket.timeout:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(
            status="down",
            response_time_ms=round(elapsed, 2),
            error=f"Connection timeout after {timeout} seconds",
            details={"port": port}
        )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(
            status="down",
            response_time_ms=round(elapsed, 2),
            error=str(e),
            details={"port": port}
        )
