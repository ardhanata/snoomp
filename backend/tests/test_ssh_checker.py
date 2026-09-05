import time
import pytest
from app.checkers.ssh import (
    parse_proc_stat,
    calculate_proc_stat_cpu_percent,
    parse_metrics_output,
    _memory_cpustat_cache
)

SAMPLE_PROC_STAT_1 = "cpu  1000 50 200 8000 100 10 20 0 0 0"
# total1 = 1000+50+200+8000+100+10+20+0 = 9380, idle1 = 8000

SAMPLE_PROC_STAT_2 = "cpu  1100 50 250 8600 100 10 20 0 0 0"
# total2 = 1100+50+250+8600+100+10+20+0 = 10130, idle2 = 8600
# delta_total = 10130 - 9380 = 750
# delta_idle = 8600 - 8000 = 600
# cpu_percent = 100 * (1 - 600/750) = 100 * (1 - 0.8) = 20.0%

SAMPLE_OUTPUT_1 = """
up 12 days, 3 hours, 2 users, load average: 3.20, 2.10, 1.50
Mem: 16000 8000 8000
/dev/sda1 100G 40G 60G 40% /
cpu  1000 50 200 8000 100 10 20 0 0 0
3.20 2.10 1.50 2/500 12345
8
"""

SAMPLE_OUTPUT_2 = """
up 12 days, 3 hours, 2 users, load average: 3.20, 2.10, 1.50
Mem: 16000 8000 8000
/dev/sda1 100G 40G 60G 40% /
cpu  1100 50 250 8600 100 10 20 0 0 0
3.20 2.10 1.50 2/500 12346
8
"""

def setup_function():
    _memory_cpustat_cache.clear()

def test_parse_proc_stat():
    res = parse_proc_stat(SAMPLE_PROC_STAT_1)
    assert res is not None
    total, idle = res
    assert total == 9380
    assert idle == 8000

def test_calculate_proc_stat_cpu_percent_two_samples():
    target_id = "test_target_1"
    # First sample
    res1 = calculate_proc_stat_cpu_percent(target_id, 9380, 8000)
    assert res1 is None  # First check returns None (triggers load-avg fallback)

    # Simulate 60s poll gap
    _memory_cpustat_cache[target_id]["ts"] = time.time() - 60

    # Second sample
    res2 = calculate_proc_stat_cpu_percent(target_id, 10130, 8600)
    assert res2 == 20.0

def test_first_check_and_stale_cache_fallback():
    target_id = "test_target_fallback"
    
    # 1. First check ever: returns load_percent fallback (3.20 / 8 cores * 100 = 40%)
    m1 = parse_metrics_output(SAMPLE_OUTPUT_1, target_id=target_id)
    assert m1["cpu_percent"] == 40.0
    assert m1["load_1min"] == 3.20
    assert m1["load_percent"] == 40.0

    # 2. Simulate stale cache (host down for 10 minutes)
    _memory_cpustat_cache[target_id]["ts"] = time.time() - 600

    m2 = parse_metrics_output(SAMPLE_OUTPUT_2, target_id=target_id)
    # Cache was expired/stale (> ttl), so it falls back to load_percent without crashing
    assert m2["cpu_percent"] == 40.0
    assert m2["load_1min"] == 3.20
    assert m2["load_percent"] == 40.0

def test_host_reboot_guardrail():
    target_id = "test_reboot"
    # Initial sample before reboot
    parse_metrics_output(SAMPLE_OUTPUT_2, target_id=target_id)

    # After reboot, /proc/stat counters reset to lower values (delta_total <= 0)
    _memory_cpustat_cache[target_id]["ts"] = time.time() - 60

    m_reboot = parse_metrics_output(SAMPLE_OUTPUT_1, target_id=target_id)
    # Negative delta total correctly guarded: returns load_percent fallback
    assert m_reboot["cpu_percent"] == 40.0


@pytest.mark.asyncio
async def test_check_ssh_timeout_retries_and_reports_real_error(monkeypatch):
    from unittest.mock import AsyncMock, patch
    from app.checkers.ssh import check_ssh
    import asyncssh

    attempts = 0

    class MockConnectCtx:
        async def __aenter__(self):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise asyncssh.DisconnectError(1, "Login timeout expired")
            # 2nd attempt succeeds
            mock_conn = AsyncMock()
            mock_result = AsyncMock()
            mock_result.exit_status = 0
            mock_result.stdout = SAMPLE_OUTPUT_1
            mock_conn.run = AsyncMock(return_value=mock_result)
            return mock_conn

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return None

    with patch("asyncssh.connect", side_effect=lambda *args, **kwargs: MockConnectCtx()):
        res = await check_ssh(
            host="192.168.1.50",
            username="root",
            password="secretpassword",
            timeout=5
        )
        assert attempts == 2
        assert res.status in ["up", "warning", "critical"]
        assert res.details is not None
        assert res.details["cpu_percent"] == 40.0

