import time
import httpx
import ssl
import socket
import asyncio
import datetime
from typing import Dict, Any, List, Tuple
from app.checkers.base import CheckerResult

DEGRADED_THRESHOLD_MS = 5000

def parse_cert_expiry_days(cert: dict) -> int | None:
    """Extract remaining validity days from an SSL peer certificate."""
    if not cert:
        return None
    expiry_str = cert.get('notAfter')
    if not expiry_str:
        return None
    try:
        expire_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
    except ValueError:
        try:
            expire_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y')
        except ValueError:
            return None
    remaining = expire_date - datetime.datetime.utcnow()
    return max(0, remaining.days)

def get_ssl_expiry_days(hostname: str, port: int = 443) -> int | None:
    try:
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        with socket.create_connection((hostname, port or 443), timeout=3) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                return parse_cert_expiry_days(ssock.getpeercert())
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
    clean_path = path if path.startswith("/") else f"/{path}"
    url = f"{scheme}://{host}{port_str}{clean_path}"

    if accepted_status_codes is None:
        accepted_status_codes = [200, 201, 202, 301, 302]

    start = time.monotonic()
    details: Dict[str, Any] = {"url": url}
    target_port = port or (443 if scheme == "https" else 80)

    dns_ms = 0.0
    tcp_ms = 0.0
    tls_ms = 0.0
    ttfb_ms = 0.0
    transfer_ms = 0.0

    # 1. Measure DNS & Socket Connection Phases (TCP + TLS)
    loop = asyncio.get_running_loop()
    resolved_ip = host
    
    # DNS Phase
    try:
        t_dns_start = time.monotonic()
        addr_info = await asyncio.wait_for(
            loop.getaddrinfo(host, target_port, type=socket.SOCK_STREAM),
            timeout=min(timeout, 3.0)
        )
        dns_ms = max(0.1, round((time.monotonic() - t_dns_start) * 1000, 1))
        if addr_info:
            resolved_ip = addr_info[0][4][0]
    except Exception:
        dns_ms = max(0.1, round((time.monotonic() - start) * 1000, 1))

    # TCP & TLS Handshake Phase + SSL Expiry Inspection
    def _probe_socket_and_tls() -> Tuple[float, float, int | None, bool]:
        t_tcp = 0.0
        t_tls = 0.0
        exp_days = None
        is_valid_ssl = False
        
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(min(timeout, 3.0))
        t0 = time.monotonic()
        try:
            sock.connect((resolved_ip, target_port))
            t_tcp = max(0.1, round((time.monotonic() - t0) * 1000, 1))
            
            if scheme == "https" and not ignore_tls:
                t_tls_start = time.monotonic()
                context = ssl.create_default_context()
                context.check_hostname = True
                context.verify_mode = ssl.CERT_REQUIRED
                with context.wrap_socket(sock, server_hostname=host) as ssock:
                    t_tls = max(0.1, round((time.monotonic() - t_tls_start) * 1000, 1))
                    cert = ssock.getpeercert()
                    exp_days = parse_cert_expiry_days(cert)
                    is_valid_ssl = (exp_days is not None)
            else:
                sock.close()
        except Exception:
            try:
                sock.close()
            except Exception:
                pass
        return t_tcp, t_tls, exp_days, is_valid_ssl

    try:
        p_tcp, p_tls, p_exp_days, p_valid_ssl = await loop.run_in_executor(None, _probe_socket_and_tls)
        tcp_ms = p_tcp
        tls_ms = p_tls
        if scheme == "https" and not ignore_tls:
            details["valid_ssl"] = p_valid_ssl
            if p_exp_days is not None:
                details["ssl_expiry_days"] = p_exp_days
    except Exception:
        pass

    # Fallback for SSL expiry if socket probe didn't capture it
    if scheme == "https" and not ignore_tls and "ssl_expiry_days" not in details:
        ssl_days = await loop.run_in_executor(None, get_ssl_expiry_days, host, target_port)
        if ssl_days is not None:
            details["ssl_expiry_days"] = ssl_days
            details["valid_ssl"] = True
        else:
            details["valid_ssl"] = False

    try:
        # Configure client and measure HTTP TTFB & Body Transfer
        verify = not ignore_tls
        req_headers = headers or {}
        content_bytes = body.encode("utf-8") if body else None

        async with httpx.AsyncClient(verify=verify, timeout=timeout, follow_redirects=True) as client:
            req = client.build_request(method, url, headers=req_headers, content=content_bytes)
            
            t_ttfb_start = time.monotonic()
            response = await client.send(req, stream=True)
            ttfb_ms = max(0.1, round((time.monotonic() - t_ttfb_start) * 1000, 1))

            t_trans_start = time.monotonic()
            await response.aread()
            transfer_ms = max(0.1, round((time.monotonic() - t_trans_start) * 1000, 1))
            await response.aclose()

        elapsed = (time.monotonic() - start) * 1000
        details["status_code"] = response.status_code

        # Bottleneck calculation
        phases = [
            ("DNS Resolution", dns_ms),
            ("TCP Connect", tcp_ms),
            ("TLS Handshake", tls_ms if scheme == "https" and not ignore_tls else 0.0),
            ("Server Processing (TTFB)", ttfb_ms),
            ("Content Download", transfer_ms)
        ]
        bottleneck_name, bottleneck_val = max(phases, key=lambda x: x[1])
        bottleneck_pct = round((bottleneck_val / max(elapsed, 0.001)) * 100, 1) if elapsed > 0 else 0.0

        details["timing"] = {
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "tls_ms": tls_ms if scheme == "https" and not ignore_tls else 0.0,
            "ttfb_ms": ttfb_ms,
            "transfer_ms": transfer_ms,
            "total_ms": round(elapsed, 1),
            "bottleneck": bottleneck_name,
            "bottleneck_pct": bottleneck_pct
        }

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
        details["timing"] = {
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "tls_ms": tls_ms,
            "ttfb_ms": round(elapsed, 1),
            "transfer_ms": 0.0,
            "total_ms": round(elapsed, 1),
            "bottleneck": "Request Timeout",
            "bottleneck_pct": 100.0
        }
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=f"Timeout: {e}", details=details)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        details["timing"] = {
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "tls_ms": tls_ms,
            "ttfb_ms": ttfb_ms,
            "transfer_ms": transfer_ms,
            "total_ms": round(elapsed, 1),
            "bottleneck": "Connection Error",
            "bottleneck_pct": 100.0
        }
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=str(e), details=details)

