import os
import time
import re
import logging
import asyncssh
from typing import Any
from app.checkers.base import CheckerResult, evaluate_resource_status

logger = logging.getLogger(__name__)

_memory_cpustat_cache = {}

def parse_proc_stat(output: str) -> tuple[int, int] | None:
    """
    Parses the 'cpu ' line from /proc/stat.
    Line format: cpu  user nice system idle iowait irq softirq steal guest guest_nice
    Returns (total, idle) where:
    - total = sum of user, nice, system, idle, iowait, irq, softirq, steal
    - idle = idle field alone (matches sar/nmon's Idle% column; iowait is NOT folded into idle)
    """
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("cpu "):
            parts = line.split()[1:]
            fields = []
            for p in parts:
                try:
                    fields.append(int(p))
                except ValueError:
                    pass
            if len(fields) >= 4:
                # user(0), nice(1), system(2), idle(3), iowait(4), irq(5), softirq(6), steal(7)
                total = sum(fields[:8])
                idle_val = fields[3]
                return total, idle_val
    return None

def calculate_proc_stat_cpu_percent(
    target_key: str,
    curr_total: int,
    curr_idle: int,
    ttl: int = 180,
    redis_conn=None
) -> float | None:
    """
    Calculates stateful delta cpu_percent = 100 * (1 - delta_idle / delta_total) across check polls.
    Caches (timestamp, total, idle) sample in Redis under key 'ssh_cpustat:{target_key}'.
    Falls back to memory cache if Redis is unavailable.
    """
    now = time.time()
    prev_sample = None

    # 1. Try reading previous sample from Redis
    if redis_conn:
        try:
            raw = redis_conn.get(f"ssh_cpustat:{target_key}")
            if raw:
                prev_sample = json.loads(raw if isinstance(raw, str) else raw.decode('utf-8'))
        except Exception as e:
            logger.debug(f"Redis get failed for ssh_cpustat:{target_key}: {e}")
            prev_sample = _memory_cpustat_cache.get(target_key)
    else:
        try:
            redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
            r = redis.Redis.from_url(redis_url, socket_timeout=2)
            raw = r.get(f"ssh_cpustat:{target_key}")
            if raw:
                prev_sample = json.loads(raw if isinstance(raw, str) else raw.decode('utf-8'))
        except Exception:
            prev_sample = _memory_cpustat_cache.get(target_key)

    # 2. Save current sample to cache
    curr_sample = {"ts": now, "total": curr_total, "idle": curr_idle}
    if redis_conn:
        try:
            redis_conn.setex(f"ssh_cpustat:{target_key}", ttl, json.dumps(curr_sample))
        except Exception as e:
            logger.debug(f"Redis setex failed for ssh_cpustat:{target_key}: {e}")
            _memory_cpustat_cache[target_key] = curr_sample
    else:
        try:
            redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
            r = redis.Redis.from_url(redis_url, socket_timeout=2)
            r.setex(f"ssh_cpustat:{target_key}", ttl, json.dumps(curr_sample))
        except Exception:
            _memory_cpustat_cache[target_key] = curr_sample

    # 3. Compute delta CPU utilization if previous sample exists and is valid
    if prev_sample:
        prev_ts = prev_sample.get("ts", 0)
        prev_total = prev_sample.get("total", 0)
        prev_idle = prev_sample.get("idle", 0)

        elapsed = now - prev_ts
        delta_total = curr_total - prev_total
        delta_idle = curr_idle - prev_idle

        # Valid delta window: elapsed between 1s and ttl+30s, positive delta_total, non-negative delta_idle
        if 1.0 <= elapsed <= (ttl + 60) and delta_total > 0 and delta_idle >= 0:
            cpu_pct = 100.0 * (1.0 - (delta_idle / delta_total))
            return max(0.0, min(100.0, round(cpu_pct, 2)))

    return None

def parse_metrics_output(output: str, target_id: str | None = None, redis_conn=None) -> dict:
    """Parses output of: uptime && free -m && df -h -P -x tmpfs -x devtmpfs -x squashfs -x overlay && cat /proc/stat && cat /proc/loadavg && nproc"""
    metrics = {
        "uptime": "unknown",
        "cpu_percent": 0.0,
        "load_1min": 0.0,
        "load_percent": 0.0,
        "mem_percent": 0.0,
        "disk_percent": 0.0,
        "cpu_cores": 1,
        "ram_total_gb": 0.0,
        "disk_total_gb": 0.0,
        "disks": []
    }

    lines = [l.strip() for l in output.splitlines() if l.strip()]
    if not lines:
        return metrics

    # 1. Parse Uptime
    uptime_match = re.search(r'up\s+(.*?),\s*\d+\s+user', output)
    if uptime_match:
        metrics["uptime"] = uptime_match.group(1).strip()
    else:
        uptime_match_fallback = re.search(r'up\s+(.*?),\s*load', output)
        if uptime_match_fallback:
            metrics["uptime"] = uptime_match_fallback.group(1).strip()

    # 2. Parse Memory from free -m
    mem_match = re.search(r'Mem:\s+(\d+)\s+(\d+)\s+(\d+)', output)
    if mem_match:
        total = float(mem_match.group(1))
        used = float(mem_match.group(2))
        if total > 0:
            metrics["mem_percent"] = round((used / total) * 100, 2)
            metrics["ram_total_gb"] = round(total / 1024, 1)

    # 3. Parse Multi-Disk metrics from df -h -P (POSIX 1-line format)
    parsed_disks = []
    total_disk_gb = 0.0
    total_used_gb = 0.0

    for line in lines:
        parts = line.split()
        if len(parts) >= 6 and parts[4].endswith('%'):
            pct_str = parts[4].rstrip('%')
            mount_point = parts[5]
            filesystem = parts[0]

            if not pct_str.isdigit():
                continue

            used_pct = float(pct_str)
            size_str = parts[1]
            size_gb = 0.0

            try:
                num_match = re.findall(r'[\d\.]+', size_str)
                if num_match:
                    num_val = float(num_match[0])
                    unit = size_str.replace(num_match[0], '').strip().upper()
                    if 'T' in unit:
                        size_gb = round(num_val * 1024, 1)
                    elif 'M' in unit:
                        size_gb = round(num_val / 1024, 1)
                    elif 'K' in unit:
                        size_gb = round(num_val / (1024 * 1024), 1)
                    else:
                        size_gb = round(num_val, 1)
            except Exception:
                pass

            parsed_disks.append({
                "filesystem": filesystem,
                "mount": mount_point,
                "size_gb": size_gb,
                "used_percent": used_pct
            })

            total_disk_gb += size_gb
            total_used_gb += size_gb * (used_pct / 100.0)

    if parsed_disks:
        metrics["disks"] = parsed_disks
        metrics["disk_percent"] = round((total_used_gb / total_disk_gb) * 100, 2) if total_disk_gb > 0 else 0.0
        metrics["disk_total_gb"] = round(total_disk_gb, 1)

    # 4. Parse CPU cores count
    try:
        metrics["cpu_cores"] = int(lines[-1])
    except (IndexError, ValueError):
        metrics["cpu_cores"] = 1
    if metrics["cpu_cores"] <= 0:
        metrics["cpu_cores"] = 1

    # 5. Parse 1-minute Load Average & Load Percent
    load_1min = 0.0
    loadavg_line = ""
    if len(lines) >= 2:
        if re.match(r'^\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+', lines[-2]):
            loadavg_line = lines[-2]
        elif re.match(r'^\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+', lines[-1]):
            loadavg_line = lines[-1]
    if not loadavg_line:
        for line in lines:
            if re.match(r'^\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+', line):
                loadavg_line = line
                break

    loadavg_match = re.search(r'^(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)', loadavg_line if loadavg_line else output)
    if loadavg_match:
        load_1min = float(loadavg_match.group(1))
    else:
        load_match = re.search(r'load average:\s*(\d+\.\d+)', output)
        if load_match:
            load_1min = float(load_match.group(1))

    load_percent = min(100.0, round((load_1min / metrics["cpu_cores"]) * 100, 2))
    metrics["load_1min"] = round(load_1min, 2)
    metrics["load_percent"] = load_percent

    # 6. Parse /proc/stat and compute stateful delta cpu_percent matching sar/nmon
    stat_sample = parse_proc_stat(output)
    delta_cpu = None
    if stat_sample and target_id:
        curr_total, curr_idle = stat_sample
        delta_cpu = calculate_proc_stat_cpu_percent(target_id, curr_total, curr_idle, redis_conn=redis_conn)

    if delta_cpu is not None:
        metrics["cpu_percent"] = delta_cpu
    else:
        # Fallback to load_percent for first check ever, host reboot, or missing /proc/stat
        metrics["cpu_percent"] = load_percent

    return metrics

def parse_windows_metrics_output(output: str) -> dict:
    """Parses output of PowerShell CIM metric query on Windows hosts."""
    metrics = {
        "uptime": "Windows Server Host",
        "cpu_percent": 0.0,
        "mem_percent": 0.0,
        "disk_percent": 0.0,
        "cpu_cores": 1,
        "ram_total_gb": 0.0,
        "disk_total_gb": 0.0,
        "disks": []
    }
    
    parsed_disks = []
    total_disk_gb = 0.0
    total_used_gb = 0.0

    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("CPU_PCT="):
            try:
                metrics["cpu_percent"] = min(100.0, round(float(line.split("=")[1]), 2))
            except Exception:
                pass
        elif line.startswith("MEM_TOTAL="):
            try:
                metrics["ram_total_gb"] = round(float(line.split("=")[1]), 1)
            except Exception:
                pass
        elif line.startswith("MEM_FREE="):
            try:
                free_mb = float(line.split("=")[1])
                total_mb = metrics["ram_total_gb"] * 1024
                if total_mb > 0:
                    metrics["mem_percent"] = round(((total_mb - free_mb) / total_mb) * 100, 2)
            except Exception:
                pass
        elif line.startswith("DISK="):
            try:
                parts = line.split("=")[1].split("~")
                if len(parts) >= 4:
                    drive = parts[0]
                    label = parts[1] or "Local Disk"
                    size_gb = float(parts[2]) if parts[2] else 0.0
                    used_pct = float(parts[3]) if parts[3] else 0.0

                    parsed_disks.append({
                        "filesystem": label,
                        "mount": drive,
                        "size_gb": size_gb,
                        "used_percent": used_pct
                    })
                    total_disk_gb += size_gb
                    total_used_gb += size_gb * (used_pct / 100.0)
            except Exception:
                pass

    if parsed_disks:
        metrics["disks"] = parsed_disks
        metrics["disk_percent"] = round((total_used_gb / total_disk_gb) * 100, 2) if total_disk_gb > 0 else 0.0
        metrics["disk_total_gb"] = round(total_disk_gb, 1)

    return metrics

def _get_mock_metrics() -> dict:
    import random
    return {
        "cpu_percent": round(random.uniform(2.0, 35.0), 2),
        "mem_percent": round(random.uniform(25.0, 60.0), 2),
        "disk_percent": round(random.uniform(30.0, 50.0), 2),
        "uptime": "12 days, 3 hours",
        "cpu_cores": 4,
        "ram_total_gb": 8.0,
        "disk_total_gb": 580.0,
        "disks": [
            { "filesystem": "/dev/sda1", "mount": "/", "size_gb": 80.0, "used_percent": 32.5 },
            { "filesystem": "/dev/sdb1", "mount": "/u01", "size_gb": 500.0, "used_percent": 50.0 }
        ]
    }

async def check_ssh(
    host: str,
    username: str,
    password: str | None = None,
    private_key: str | None = None,
    port: int = 22,
    timeout: int = 10,
    target_id: str | None = None,
    redis_conn: Any = None,
) -> CheckerResult:
    """Async check using asyncssh supporting both Linux and Windows SSH hosts."""
    use_mock = os.getenv("USE_SSH_MOCK", "false").lower() == "true"

    if use_mock or host in ["127.0.0.1", "localhost"]:
        metrics = _get_mock_metrics()
        status = evaluate_resource_status(metrics["cpu_percent"], metrics["mem_percent"], metrics["disk_percent"])
        return CheckerResult(status=status, response_time_ms=0.0, details=metrics)

    start = time.monotonic()
    # ponytail: show all partitions natively, no unrequested filtering
    command = "uptime && free -m && df -h -P && cat /proc/stat && cat /proc/loadavg && nproc"
    # 2. Windows PowerShell CIM metric gathering fallback command
    win_command = 'powershell -NoProfile -Command "$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; $os=Get-CimInstance Win32_OperatingSystem; Write-Output CPU_PCT=$cpu; Write-Output MEM_TOTAL=$([math]::Round($os.TotalVisibleMemorySize/1024,1)); Write-Output MEM_FREE=$([math]::Round($os.FreePhysicalMemory/1024,1)); Get-CimInstance Win32_LogicalDisk | ForEach-Object { if ($_.Size -gt 0) { $u=[math]::Round(($_.Size - $_.FreeSpace)/$_.Size * 100,1); $s=[math]::Round($_.Size/1GB,1); Write-Output DISK=$($_.DeviceID)~$($_.VolumeName)~$s~$u } }"'

    try:
        client_keys = []
        if private_key:
            try:
                key = asyncssh.import_private_key(private_key)
                client_keys.append(key)
            except Exception as ke:
                return CheckerResult(
                    status="down",
                    response_time_ms=0.0,
                    error=f"Invalid SSH private key: {ke}"
                )

        async with asyncssh.connect(
            host,
            port=port,
            username=username,
            password=password,
            client_keys=client_keys,
            known_hosts=None,
            login_timeout=timeout
        ) as conn:
            # First try Linux command
            result = await conn.run(command, timeout=timeout)
            elapsed = (time.monotonic() - start) * 1000
            
            if result.exit_status == 0:
                metrics = parse_metrics_output(result.stdout, target_id=target_id or host, redis_conn=redis_conn)
                status = evaluate_resource_status(metrics["cpu_percent"], metrics["mem_percent"], metrics["disk_percent"])
                return CheckerResult(
                    status=status,
                    response_time_ms=round(elapsed, 2),
                    details=metrics
                )
            else:
                # Fallback to Windows PowerShell query
                win_result = await conn.run(win_command, timeout=timeout)
                if win_result.exit_status == 0:
                    metrics = parse_windows_metrics_output(win_result.stdout)
                    status = evaluate_resource_status(metrics["cpu_percent"], metrics["mem_percent"], metrics["disk_percent"])
                    return CheckerResult(
                        status=status,
                        response_time_ms=round(elapsed, 2),
                        details=metrics
                    )
                
                return CheckerResult(
                    status="down",
                    response_time_ms=round(elapsed, 2),
                    error=f"SSH check failed (Linux exit code {result.exit_status}, Windows exit code {win_result.exit_status})",
                    details={"exit_status": result.exit_status, "stderr": result.stderr[:200]}
                )
                
    except asyncssh.PermissionDenied as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=f"SSH Auth Failed: {e}")
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return CheckerResult(status="down", response_time_ms=round(elapsed, 2), error=str(e))
