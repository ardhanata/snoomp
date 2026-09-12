import pytest
import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from app.checkers.http import (
    parse_cert_expiry_days,
    check_http
)

def test_parse_cert_expiry_days():
    # Valid certificate in future
    now = datetime.datetime.utcnow()
    future = now + datetime.timedelta(days=45)
    expiry_str = future.strftime("%b %d %H:%M:%S %Y GMT")
    
    cert = {"notAfter": expiry_str}
    days = parse_cert_expiry_days(cert)
    assert days is not None
    assert 44 <= days <= 46

    # Empty cert
    assert parse_cert_expiry_days({}) is None
    assert parse_cert_expiry_days(None) is None

    # Malformed cert string
    assert parse_cert_expiry_days({"notAfter": "invalid-date"}) is None

@pytest.mark.asyncio
async def test_check_http_timing_breakdown():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.aread = AsyncMock(return_value=b"OK")
    mock_resp.aclose = AsyncMock()

    mock_client = MagicMock()
    mock_client.build_request.return_value = MagicMock()
    mock_client.send = AsyncMock(return_value=mock_resp)

    class MockAsyncClientCtx:
        async def __aenter__(self):
            return mock_client
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return None

    with patch("httpx.AsyncClient", return_value=MockAsyncClientCtx()), \
         patch("app.checkers.http.asyncio.get_running_loop") as mock_loop:
        
        loop_inst = MagicMock()
        loop_inst.getaddrinfo = AsyncMock(return_value=[(None, None, None, None, ("93.184.216.34", 443))])
        # Probe returns tcp_ms=15.0, tls_ms=45.0, exp_days=90, is_valid_ssl=True
        loop_inst.run_in_executor = AsyncMock(return_value=(15.0, 45.0, 90, True))
        mock_loop.return_value = loop_inst

        result = await check_http(
            host="example.com",
            scheme="https",
            timeout=5
        )

        assert result.status == "up"
        assert result.response_time_ms > 0
        assert "timing" in result.details
        timing = result.details["timing"]
        
        assert "dns_ms" in timing
        assert "tcp_ms" in timing
        assert "tls_ms" in timing
        assert "ttfb_ms" in timing
        assert "transfer_ms" in timing
        assert "total_ms" in timing
        assert "bottleneck" in timing
        assert "bottleneck_pct" in timing
        
        assert result.details["valid_ssl"] is True
        assert result.details["ssl_expiry_days"] == 90
        assert result.details["status_code"] == 200
