import subprocess
import time
import re
from icmplib import ping, SocketPermissionError
from app.checkers.base import CheckerResult

def _ping_subprocess(host: str, count: int = 3, timeout_sec: int = 2) -> CheckerResult:
    """Fallback ping using system ping command."""
    # F12: Validate host to prevent argument injection
    if not re.match(r'^[a-zA-Z0-9._:-]+$', host) or host.startswith('-'):
        return CheckerResult(status="down", response_time_ms=0.0, error=f"Invalid host: {host}")

    start = time.monotonic()

    # iputils-ping (see Dockerfile). '--' separates flags from the host so a
    # host beginning with '-' cannot be read as an option.
    cmd = ["ping", "-c", str(count), "-W", str(timeout_sec), "--", host]


    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout_sec * count + 1)
        elapsed = (time.monotonic() - start) * 1000
        
        if res.returncode == 0:
            # Parse avg rtt from output
            avg_rtt = elapsed / count
            match = re.search(r'(?:Average = |/)([\d\.]+)(?:ms)?', res.stdout)
            if match:
                avg_rtt = float(match.group(1))
                    
            return CheckerResult(
                status="up",
                response_time_ms=round(elapsed, 2),
                details={"avg_rtt": round(avg_rtt, 2), "method": "subprocess"}
            )
        else:
            return CheckerResult(
                status="down",
                response_time_ms=round(elapsed, 2),
                error=res.stderr or f"Ping command exited with code {res.returncode}",
                details={"output": res.stdout[:100]}
            )
    except subprocess.TimeoutExpired:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error="Subprocess timeout expired")
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=str(e))

def check_icmp(host: str, count: int = 3, timeout: int = 2) -> CheckerResult:
    """Sends ICMP echo requests using icmplib, falling back to subprocess if permissions fail."""
    try:
        # privileged=False uses UDP sockets (available on most modern OS)
        result = ping(host, count=count, timeout=timeout, privileged=False)
        if result.is_alive:
            return CheckerResult(
                status="up",
                response_time_ms=round(result.avg_rtt, 2),
                details={"packet_loss": result.packet_loss, "method": "icmplib"}
            )
        return CheckerResult(
            status="down",
            response_time_ms=0.0,
            error="Host unreachable",
            details={"packet_loss": result.packet_loss, "method": "icmplib"}
        )
    except SocketPermissionError:
        # Fallback to subprocess ping which runs as the system user (inheriting permissions)
        return _ping_subprocess(host, count, timeout)
    except Exception:
        # Final fallback
        return _ping_subprocess(host, count, timeout)
