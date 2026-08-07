import time
import httpx
import ssl
import socket
import datetime
from typing import Dict, Any, List
from app.checkers.base import CheckerResult

DEGRADED_THRESHOLD_MS = 5000

def get_ssl_expiry_days(hostname: str, port: int = 443) -> int | None:
    try:
        # Resolve hostname to avoid connection errors if invalid
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        
        with socket.create_connection((hostname, port or 443), timeout=3) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                if not cert:
                    return None
                expiry_str = cert.get('notAfter')
                if not expiry_str:
                    return None
                # Format: 'Jan  5 12:00:00 2026 GMT' or similar
                # Let's handle different formats or standard OpenSSL date format
                try:
                    expire_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                except ValueError:
                    expire_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y')
                
                remaining = expire_date - datetime.datetime.utcnow()
                return max(0, remaining.days)
    except Exception:
        return None

async def check_http(
    host: str,
    path: str = "/",
    port: int | None = None,
    timeout: int = 10,
    scheme: str = "http",
    method: str = "GET",
    headers: Dict[str, str] | None = None,
    body: str | None = None,
    accepted_status_codes: List[int] | None = None,
    ignore_tls: bool = False
) -> CheckerResult:
    # Build URL
    port_str = f":{port}" if port else ""
    # Ensure path starts with /
    clean_path = path if path.startswith("/") else f"/{path}"
    url = f"{scheme}://{host}{port_str}{clean_path}"

    if accepted_status_codes is None:
        accepted_status_codes = [200, 201, 202, 301, 302]

    start = time.monotonic()
    details = {"url": url}
    
    # Calculate SSL Expiry if HTTPS and verify SSL is enabled
    if scheme == "https" and not ignore_tls:
        ssl_days = get_ssl_expiry_days(host, port or 443)
        if ssl_days is not None:
            details["ssl_expiry_days"] = ssl_days
            details["valid_ssl"] = True
        else:
            details["valid_ssl"] = False
    
    try:
        # Configure client
        verify = not ignore_tls
        async with httpx.AsyncClient(verify=verify, timeout=timeout, follow_redirects=True) as client:
            # Execute request
            req_headers = headers or {}
            if method.upper() in ["POST", "PUT", "PATCH"] and body:
                response = await client.request(method, url, headers=req_headers, content=body)
            else:
                response = await client.request(method, url, headers=req_headers)
                
        elapsed = (time.monotonic() - start) * 1000
        details["status_code"] = response.status_code
        
        if response.status_code in accepted_status_codes:
            status = "degraded" if elapsed > DEGRADED_THRESHOLD_MS else "up"
            return CheckerResult(
                status=status,
                response_time_ms=round(elapsed, 2),
                details=details
            )
        else:
            return CheckerResult(
                status="down",
                response_time_ms=round(elapsed, 2),
                error=f"Unaccepted status code: {response.status_code}",
                details=details
            )
            
    except httpx.TimeoutException as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=f"Timeout: {e}", details=details)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=str(e), details=details)
