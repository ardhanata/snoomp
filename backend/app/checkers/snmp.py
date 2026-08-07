import os
import asyncio
import time
import logging
from app.checkers.base import CheckerResult, evaluate_resource_status

logger = logging.getLogger(__name__)

def _get_mock_metrics() -> dict:
    import random
    # Generate realistic looking metrics
    return {
        "cpu_percent": round(random.uniform(5.0, 45.0), 2),
        "mem_percent": round(random.uniform(30.0, 75.0), 2),
        "disk_percent": round(random.uniform(40.0, 65.0), 2),
        "uptime": "5 days, 14 hours",
        "cpu_cores": 8,
        "ram_total_gb": 16.0,
        "disk_total_gb": 100.0
    }

async def check_snmp(host: str, community: str = "public", port: int = 161) -> CheckerResult:
    """Check server metrics via SNMP (CPU, Memory, Disk, Uptime)"""
    use_mock = os.getenv("USE_SNMP_MOCK", "false").lower() == "true"

    if use_mock or host in ["127.0.0.1", "localhost"]:
        metrics = _get_mock_metrics()
        status = evaluate_resource_status(metrics["cpu_percent"], metrics["mem_percent"], metrics["disk_percent"])
        return CheckerResult(status=status, response_time_ms=0.0, details=metrics)

    try:
        try:
            from pysnmp.hlapi.v3arch.asyncio import (
                get_cmd as getCmd, next_cmd as nextCmd, SnmpEngine, CommunityData, UdpTransportTarget,
                ContextData, ObjectType, ObjectIdentity,
            )
        except ImportError:
            from pysnmp.hlapi.asyncio import (
                getCmd, nextCmd, SnmpEngine, CommunityData, UdpTransportTarget,
                ContextData, ObjectType, ObjectIdentity,
            )

        async def _make_target(h, p, timeout_sec=3, retries_cnt=1):
            if hasattr(UdpTransportTarget, 'create'):
                return await UdpTransportTarget.create((h, p), timeout=timeout_sec, retries=retries_cnt)
            return UdpTransportTarget((h, p), timeout=timeout_sec, retries=retries_cnt)

        # OIDs (UCD-SNMP-MIB / HOST-RESOURCES-MIB)
        # CPU: use ssCpuUser + ssCpuSystem for true % (not load average)
        CPU_USER_OID   = "1.3.6.1.4.1.2021.11.9.0"      # ssCpuUser  - % user-space CPU
        CPU_SYS_OID    = "1.3.6.1.4.1.2021.11.10.0"     # ssCpuSystem - % kernel CPU
        MEM_TOTAL_OID  = "1.3.6.1.4.1.2021.4.5.0"       # memTotalReal (kB)
        MEM_FREE_OID   = "1.3.6.1.4.1.2021.4.11.0"      # memAvailReal (kB)
        DISK_PCT_OID   = "1.3.6.1.4.1.2021.9.1.9.1"     # dskPercent.1 (Partition /)
        UPTIME_OID     = "1.3.6.1.2.1.25.1.1.0"         # hrSystemUptime
        DISK_TOTAL_OID = "1.3.6.1.4.1.2021.9.1.6.1"     # dskTotal.1 (kB, Partition /)

        start = time.monotonic()
        target_obj = await _make_target(host, port, timeout_sec=3, retries_cnt=1)
        error_indication, error_status, _, var_binds = await getCmd(
            SnmpEngine(),
            CommunityData(community),
            target_obj,
            ContextData(),
            ObjectType(ObjectIdentity(CPU_USER_OID)),   # [0] ssCpuUser
            ObjectType(ObjectIdentity(CPU_SYS_OID)),    # [1] ssCpuSystem
            ObjectType(ObjectIdentity(MEM_TOTAL_OID)),  # [2] memTotalReal
            ObjectType(ObjectIdentity(MEM_FREE_OID)),   # [3] memAvailReal
            ObjectType(ObjectIdentity(DISK_PCT_OID)),   # [4] dskPercent.1
            ObjectType(ObjectIdentity(UPTIME_OID)),     # [5] hrSystemUptime
            ObjectType(ObjectIdentity(DISK_TOTAL_OID)), # [6] dskTotal.1
        )
            
        elapsed = (time.monotonic() - start) * 1000
        latency = round(elapsed, 2)

        if error_indication or error_status:
            return CheckerResult(
                status="down",
                response_time_ms=latency,
                error=str(error_indication or error_status),
            )

        # Parse CPU: ssCpuUser [0] + ssCpuSystem [1]
        # These are integer percentages (0-100), directly representing real CPU usage
        # Matches what `top` shows as %us + %sy
        try:
            cpu_user = int(var_binds[0][1])
            cpu_sys  = int(var_binds[1][1])
            cpu = min(100.0, round(float(cpu_user + cpu_sys), 2))
        except (IndexError, ValueError):
            cpu = 0.0
        
        # Calculate memory percentage and total RAM size [2][3]
        try:
            mem_total = int(var_binds[2][1])
            mem_free  = int(var_binds[3][1])
            mem_percent = round(((mem_total - mem_free) / mem_total) * 100, 2) if mem_total else 0.0
            ram_total_gb = round(mem_total / 1024 / 1024, 1)
        except (IndexError, ValueError):
            mem_percent = 0.0
            ram_total_gb = 0.0
            
        # Parse disk percentage [4] and total disk size [6]
        try:
            disk_percent = round(float(str(var_binds[4][1])), 2)
            disk_total = int(var_binds[6][1])
            disk_total_gb = round(disk_total / 1024 / 1024, 1)
        except (IndexError, ValueError):
            disk_percent = 0.0
            disk_total_gb = 0.0

        # Parse uptime [5]
        try:
            uptime_ticks = int(var_binds[5][1])
            # timeticks is in 1/100 of a second
            uptime_seconds = uptime_ticks // 100
            uptime_days = uptime_seconds // 86400
            uptime_hours = (uptime_seconds % 86400) // 3600
            uptime_str = f"{uptime_days} days, {uptime_hours} hours"
        except (IndexError, ValueError):
            uptime_str = "unknown"

        # Walk to find CPU Cores count
        cores = 0
        try:
            engine = SnmpEngine()
            target = await _make_target(host, port, timeout_sec=2, retries_cnt=0)
            context = ContextData()
            current_oid = ObjectIdentity('1.3.6.1.2.1.25.3.3.1.2')
            
            while True:
                errInd, errStat, _, vBinds = await nextCmd(
                    engine,
                    CommunityData(community),
                    target,
                    context,
                    ObjectType(current_oid),
                    lexicographicMode=False
                )
                if errInd or errStat or not vBinds:
                    break
                varBind = vBinds[0]
                oid_str = varBind[0].prettyPrint()
                if oid_str.startswith("SNMPv2-SMI::mib-2.25.3.3.1.2") or oid_str.startswith("1.3.6.1.2.1.25.3.3.1.2"):
                    cores += 1
                    current_oid = varBind[0]
                else:
                    break
        except Exception:
            cores = 1
        if cores == 0:
            cores = 1

        metrics = {
            "cpu_percent": cpu, 
            "mem_percent": mem_percent, 
            "disk_percent": disk_percent,
            "uptime": uptime_str,
            "cpu_cores": cores,
            "ram_total_gb": ram_total_gb,
            "disk_total_gb": disk_total_gb
        }
        
        status = evaluate_resource_status(metrics["cpu_percent"], metrics["mem_percent"], metrics["disk_percent"])
        return CheckerResult(
            status=status, 
            response_time_ms=latency, 
            details=metrics
        )

    except Exception as e:
        logger.error(f"SNMP check failed for host {host}: {e}")
        return CheckerResult(status="down", response_time_ms=0.0, error=str(e))
