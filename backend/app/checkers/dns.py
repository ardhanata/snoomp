import time
import dns.resolver
from app.checkers.base import CheckerResult

def check_dns(
    hostname: str,
    dns_server: str | None = None,
    resolve_type: str = "A",
    timeout: int = 5
) -> CheckerResult:
    """Performs a DNS query for hostname using a specific record type (A, AAAA, MX, TXT, etc.)."""
    start = time.monotonic()
    details = {
        "hostname": hostname,
        "resolve_type": resolve_type,
        "dns_server": dns_server or "system"
    }
    
    try:
        resolver = dns.resolver.Resolver()
        if dns_server:
            # Set target DNS server IP
            resolver.nameservers = [dns_server]
        resolver.lifetime = timeout
        
        # Query record
        answers = resolver.resolve(hostname, resolve_type)
        elapsed = (time.monotonic() - start) * 1000
        
        records = [str(rdata) for rdata in answers]
        details["records"] = records
        
        return CheckerResult(
            status="up",
            response_time_ms=round(elapsed, 2),
            details=details
        )
        
    except dns.resolver.NXDOMAIN:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error="DNS Record not found (NXDOMAIN)", details=details)
    except dns.resolver.Timeout:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error="DNS Query Timeout", details=details)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=str(e), details=details)
