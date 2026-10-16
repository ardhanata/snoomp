import asyncio
import base64
import hashlib
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

logger = logging.getLogger(__name__)


def generate_hcp_auth_header(username: str, password: str) -> str:
    """
    Computes HCP Management API authorization header value.
    Supports:
    1. Full token in password or username: 'HCP <b64>:<md5>' or '<b64>:<md5>'
    2. Access Key ID & Secret Key (32-char hex MD5 token) without double-hashing
    3. Standard username & password: computes HCP base64(username):md5(password)
    """
    clean_p = (password or "").strip()
    clean_u = (username or "").strip()

    if clean_p.startswith("HCP "):
        return clean_p
    if clean_u.startswith("HCP "):
        return clean_u

    if ":" in clean_p and not clean_u:
        return f"HCP {clean_p}"
    if ":" in clean_u and not clean_p:
        return f"HCP {clean_u}"

    is_md5_hex = bool(re.match(r"^[0-9a-fA-F]{32}$", clean_p))
    p_hash = clean_p.lower() if is_md5_hex else hashlib.md5(clean_p.encode("utf-8")).hexdigest()

    is_already_b64 = False
    try:
        if len(clean_u) >= 4 and len(clean_u) % 4 == 0 and re.match(r"^[A-Za-z0-9+/]+={0,2}$", clean_u):
            decoded_bytes = base64.b64decode(clean_u.encode("utf-8"), validate=True)
            decoded_str = decoded_bytes.decode("utf-8")
            if base64.b64encode(decoded_bytes).decode("utf-8") == clean_u:
                if decoded_str.isprintable() and len(decoded_str) > 0 and all(c.isalnum() or c in "-_.@" for c in decoded_str):
                    is_already_b64 = True
    except Exception:
        is_already_b64 = False

    u_b64 = clean_u if is_already_b64 else base64.b64encode(clean_u.encode("utf-8")).decode("utf-8")
    return f"HCP {u_b64}:{p_hash}"


def parse_quota_bytes(val: Any) -> Optional[int]:
    """
    Parses human-readable storage capacity strings (e.g. '50 GB', '2.5 TB')
    or integer bytes into an exact byte count. Returns None for unlimited (-1).
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val) if val >= 0 else None

    s = str(val).strip().replace(",", "").upper()
    if s in ("", "-1", "UNLIMITED", "NONE", "NULL"):
        return None

    units = {
        "B": 1,
        "KB": 1024,
        "KIB": 1024,
        "MB": 1024**2,
        "MIB": 1024**2,
        "GB": 1024**3,
        "GIB": 1024**3,
        "TB": 1024**4,
        "TIB": 1024**4,
        "PB": 1024**5,
        "PIB": 1024**5,
        "EB": 1024**6,
        "EIB": 1024**6,
    }

    match = re.match(r"^([\d.]+)\s*([A-Z]*)$", s)
    if not match:
        try:
            parsed = int(s)
            return parsed if parsed >= 0 else None
        except ValueError:
            return None

    number_str, unit_str = match.groups()
    multiplier = units.get(unit_str, 1)
    try:
        return int(float(number_str) * multiplier)
    except ValueError:
        return None


def format_bytes(bytes_val: Optional[int]) -> str:
    """Format bytes into readable scale (B, KB, MB, GB, TB, PB)."""
    if bytes_val is None or bytes_val < 0:
        return "Unlimited"
    if bytes_val == 0:
        return "0 B"

    suffixes = ["B", "KB", "MB", "GB", "TB", "PB"]
    val = float(bytes_val)
    idx = 0
    while val >= 1024.0 and idx < len(suffixes) - 1:
        val /= 1024.0
        idx += 1
    return f"{val:.2f} {suffixes[idx]}"


def determine_quota_status(used_bytes: int, hard_quota_bytes: Optional[int], soft_quota_pct: Optional[float]) -> Tuple[str, float]:
    """
    Evaluates capacity usage against soft and hard quota thresholds.
    Returns (status, used_percentage).
    Status values: 'critical', 'warning', 'ok'.
    """
    if not hard_quota_bytes or hard_quota_bytes <= 0:
        return "ok", 0.0

    used_pct = round((used_bytes / hard_quota_bytes) * 100.0, 2)
    soft_threshold = float(soft_quota_pct) if soft_quota_pct is not None else 85.0

    if used_pct >= 95.0:
        return "critical", used_pct
    if used_pct >= soft_threshold:
        return "warning", used_pct
    return "ok", used_pct


async def query_hcp_tenant_mapi(
    host: str,
    port: int,
    tenant_name: str,
    username: str,
    password: str,
    ignore_tls: bool = False,
    timeout_sec: float = 4.5
) -> Dict[str, Any]:
    """
    Connects to HCP Management REST API (MAPI) and extracts:
    - Tenant quota and aggregate capacity utilization
    - Complete namespace inventory with per-namespace quota, used bytes, and object counts
    """
    auth_header = generate_hcp_auth_header(username, password)
    base_url = f"https://{host}:{port}/mapi/tenants/{tenant_name}"
    headers = {
        "Authorization": auth_header,
        "Accept": "application/json",
        "User-Agent": "Snoomp-HCP-Observability/1.5",
    }

    start_time = time.perf_counter()
    timeout = httpx.Timeout(timeout_sec, connect=min(2.5, timeout_sec))

    async with httpx.AsyncClient(verify=not ignore_tls, timeout=timeout) as client:
        # 1. Fetch Tenant details (quota configuration)
        tenant_resp = await client.get(f"{base_url}?verbose=true", headers=headers)
        if tenant_resp.status_code in (401, 403):
            raise PermissionError("HCP authentication failed: invalid username or password")
        if tenant_resp.status_code == 404:
            raise LookupError(f"HCP tenant '{tenant_name}' was not found on host {host}:{port}")
        tenant_resp.raise_for_status()
        tenant_info = tenant_resp.json()

        # 2. Fetch Tenant aggregate statistics
        stats_resp = await client.get(f"{base_url}/statistics", headers=headers)
        stats_resp.raise_for_status()
        tenant_stats = stats_resp.json()

        # 3. Fetch Tenant namespace list (gracefully handle restricted administration)
        ns_names = []
        namespaces_accessible = True
        try:
            ns_list_resp = await client.get(f"{base_url}/namespaces", headers=headers)
            if ns_list_resp.status_code == 200:
                ns_raw = ns_list_resp.json()
                raw_names = ns_raw.get("name", [])
                if isinstance(raw_names, str):
                    ns_names = [raw_names]
                elif isinstance(raw_names, list):
                    ns_names = [str(n) for n in raw_names]
            elif ns_list_resp.status_code in (401, 403):
                namespaces_accessible = False
            else:
                namespaces_accessible = False
        except Exception as e:
            logger.warning(f"Could not list namespaces for tenant {tenant_name}: {e}")
            namespaces_accessible = False

        # 4. Fetch per-namespace details & statistics in parallel (bounded concurrency)
        sem = asyncio.Semaphore(10)

        async def fetch_namespace_data(ns_name: str) -> Dict[str, Any]:
            async with sem:
                try:
                    ns_url = f"{base_url}/namespaces/{ns_name}"
                    prop_task = client.get(f"{ns_url}?verbose=true", headers=headers)
                    stat_task = client.get(f"{ns_url}/statistics", headers=headers)
                    prop_r, stat_r = await asyncio.gather(prop_task, stat_task, return_exceptions=True)

                    props = prop_r.json() if isinstance(prop_r, httpx.Response) and prop_r.is_success else {}
                    stats = stat_r.json() if isinstance(stat_r, httpx.Response) and stat_r.is_success else {}

                    hard_bytes = parse_quota_bytes(props.get("hardQuota"))
                    soft_pct = float(props.get("softQuota", 85)) if props.get("softQuota") is not None else 85.0
                    used_bytes = int(stats.get("storageCapacityUsed") or 0)
                    ingested_bytes = int(stats.get("ingestedVolume") or 0)
                    object_count = int(stats.get("objectCount") or 0)
                    custom_meta_count = int(stats.get("customMetadataCount") or 0)
                    custom_meta_size = int(stats.get("customMetadataSize") or 0)
                    shred_count = int(stats.get("shredCount") or 0)
                    shred_size = int(stats.get("shredSize") or 0)

                    status, used_pct = determine_quota_status(used_bytes, hard_bytes, soft_pct)

                    return {
                        "name": ns_name,
                        "hard_quota_raw": props.get("hardQuota", "-1"),
                        "hard_quota_bytes": hard_bytes,
                        "hard_quota_formatted": format_bytes(hard_bytes),
                        "soft_quota_pct": soft_pct,
                        "storage_used_bytes": used_bytes,
                        "storage_used_formatted": format_bytes(used_bytes),
                        "ingested_volume_bytes": ingested_bytes,
                        "ingested_volume_formatted": format_bytes(ingested_bytes),
                        "used_percent": used_pct,
                        "object_count": object_count,
                        "custom_metadata_count": custom_meta_count,
                        "custom_metadata_size": custom_meta_size,
                        "shred_count": shred_count,
                        "shred_size": shred_size,
                        "status": status,
                        "service_plan": props.get("servicePlan", ""),
                        "hash_scheme": props.get("hashScheme", ""),
                        "indexing_enabled": bool(props.get("indexingEnabled", False)),
                        "description": "",
                    }
                except Exception as e:
                    logger.warning(f"Failed fetching stats for namespace '{ns_name}': {e}")
                    return {
                        "name": ns_name,
                        "hard_quota_raw": "-1",
                        "hard_quota_bytes": None,
                        "hard_quota_formatted": "Unknown",
                        "soft_quota_pct": 85.0,
                        "storage_used_bytes": 0,
                        "storage_used_formatted": "0 B",
                        "used_percent": 0.0,
                        "object_count": 0,
                        "status": "warning",
                        "error": str(e),
                    }

        ns_tasks = [fetch_namespace_data(name) for name in ns_names]
        namespaces = await asyncio.gather(*ns_tasks)

    elapsed_ms = round((time.perf_counter() - start_time) * 1000.0, 1)

    # Calculate overall tenant quota & utilization
    tenant_hard_bytes = parse_quota_bytes(tenant_info.get("hardQuota"))
    tenant_soft_pct = float(tenant_info.get("softQuota", 85)) if tenant_info.get("softQuota") is not None else 85.0
    tenant_used_bytes = int(tenant_stats.get("storageCapacityUsed") or 0)
    tenant_ingested_bytes = int(tenant_stats.get("ingestedVolume") or 0)
    tenant_object_count = int(tenant_stats.get("objectCount") or 0)
    tenant_meta_count = int(tenant_stats.get("customMetadataCount") or 0)
    tenant_meta_size = int(tenant_stats.get("customMetadataSize") or 0)
    tenant_shred_count = int(tenant_stats.get("shredCount") or 0)
    tenant_shred_size = int(tenant_stats.get("shredSize") or 0)

    tenant_status, tenant_used_pct = determine_quota_status(tenant_used_bytes, tenant_hard_bytes, tenant_soft_pct)

    # Free space calculation
    free_bytes = max(0, tenant_hard_bytes - tenant_used_bytes) if tenant_hard_bytes else None

    # Count namespace statuses
    warn_namespaces = sum(1 for ns in namespaces if ns.get("status") == "warning")
    crit_namespaces = sum(1 for ns in namespaces if ns.get("status") == "critical")

    overall_status = "ok"
    if tenant_status == "critical" or crit_namespaces > 0:
        overall_status = "critical"
    elif tenant_status == "warning" or warn_namespaces > 0:
        overall_status = "warning"

    return {
        "status": overall_status,
        "response_time_ms": elapsed_ms,
        "tenant": {
            "name": tenant_name,
            "description": "",
            "hard_quota_raw": tenant_info.get("hardQuota", "-1"),
            "hard_quota_bytes": tenant_hard_bytes,
            "hard_quota_formatted": format_bytes(tenant_hard_bytes),
            "soft_quota_pct": tenant_soft_pct,
            "storage_used_bytes": tenant_used_bytes,
            "storage_used_formatted": format_bytes(tenant_used_bytes),
            "storage_free_bytes": free_bytes,
            "storage_free_formatted": format_bytes(free_bytes),
            "used_percent": tenant_used_pct,
            "ingested_volume_bytes": tenant_ingested_bytes,
            "ingested_volume_formatted": format_bytes(tenant_ingested_bytes),
            "object_count": tenant_object_count,
            "custom_metadata_count": tenant_meta_count,
            "custom_metadata_size": tenant_meta_size,
            "shred_count": tenant_shred_count,
            "shred_size": tenant_shred_size,
            "status": tenant_status,
            "namespaces_accessible": namespaces_accessible,
        },
        "namespaces_summary": {
            "total_count": len(namespaces),
            "warning_count": warn_namespaces,
            "critical_count": crit_namespaces,
            "healthy_count": len(namespaces) - (warn_namespaces + crit_namespaces),
        },
        "namespaces": sorted(namespaces, key=lambda x: x.get("storage_used_bytes", 0), reverse=True),
    }


async def list_hcp_tenants(
    host: str,
    port: int,
    username: str,
    password: str,
    ignore_tls: bool = False,
    timeout_sec: float = 5.0,
) -> List[str]:
    """Retrieve all tenant identifiers from an HCP cluster via MAPI."""
    auth_header = generate_hcp_auth_header(username, password)
    base_url = f"https://{host}:{port}/mapi/tenants"
    headers = {
        "Authorization": auth_header,
        "Accept": "application/json",
    }
    limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
    async with httpx.AsyncClient(verify=not ignore_tls, timeout=timeout_sec, limits=limits) as client:
        resp = await client.get(base_url, headers=headers)
        if resp.status_code in (401, 403):
            raise PermissionError(f"HCP authentication failed ({resp.status_code}). Verify system-level admin credentials.")
        resp.raise_for_status()

        try:
            data = resp.json()
        except Exception:
            # Fallback regex extraction if XML is returned
            names = re.findall(r"<name>([^<]+)</name>", resp.text)
            if names:
                return sorted(list(set(names)))
            raise ValueError("Unable to parse HCP tenants response.")

        if isinstance(data, list):
            tenant_names = [item["name"] if isinstance(item, dict) and "name" in item else str(item) for item in data]
        elif isinstance(data, dict):
            if "name" in data and isinstance(data["name"], list):
                tenant_names = data["name"]
            elif "tenant" in data and isinstance(data["tenant"], list):
                tenant_names = data["tenant"]
            elif "tenants" in data and isinstance(data["tenants"], list):
                tenant_names = data["tenants"]
            else:
                tenant_names = list(data.keys())
        else:
            tenant_names = []

        return sorted([str(t).strip() for t in tenant_names if str(t).strip()])


async def query_hcp_cluster_mapi(
    host: str,
    port: int,
    username: str,
    password: str,
    ignore_tls: bool = False,
    timeout_sec: float = 5.0,
) -> Dict[str, Any]:
    """Discover all tenants in the HCP cluster and aggregate storage and quota metrics."""
    start_time = time.perf_counter()
    tenant_names = await list_hcp_tenants(
        host=host,
        port=port,
        username=username,
        password=password,
        ignore_tls=ignore_tls,
        timeout_sec=timeout_sec,
    )

    if not tenant_names:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000.0, 1)
        return {
            "status": "ok",
            "response_time_ms": elapsed_ms,
            "is_cluster": True,
            "cluster": {
                "total_tenants": 0,
                "total_namespaces": 0,
                "storage_used_bytes": 0,
                "storage_used_formatted": "0 B",
                "hard_quota_bytes": None,
                "hard_quota_formatted": "Unlimited",
                "used_percent": 0.0,
                "object_count": 0,
                "ingested_volume_bytes": 0,
                "ingested_volume_formatted": "0 B",
                "status": "ok",
            },
            "tenants_summary": {"total_count": 0, "warning_count": 0, "critical_count": 0, "healthy_count": 0},
            "tenants": [],
            "namespaces_summary": {"total_count": 0, "warning_count": 0, "critical_count": 0, "healthy_count": 0},
            "namespaces": [],
        }

    # Bound concurrency to prevent connection bursts against the management node
    sem = asyncio.Semaphore(5)

    async def fetch_tenant_safe(t_name: str) -> Dict[str, Any]:
        async with sem:
            try:
                res = await query_hcp_tenant_mapi(
                    host=host,
                    port=port,
                    tenant_name=t_name,
                    username=username,
                    password=password,
                    ignore_tls=ignore_tls,
                    timeout_sec=timeout_sec,
                )
                res["tenant"]["name"] = t_name
                return res
            except Exception as e:
                logger.warning(f"Failed querying tenant '{t_name}': {e}")
                return {
                    "status": "warning",
                    "error": str(e),
                    "tenant": {
                        "name": t_name,
                        "description": "",
                        "hard_quota_raw": "-1",
                        "hard_quota_bytes": None,
                        "hard_quota_formatted": "Unknown",
                        "soft_quota_pct": 85.0,
                        "storage_used_bytes": 0,
                        "storage_used_formatted": "0 B",
                        "storage_free_bytes": None,
                        "storage_free_formatted": "Unknown",
                        "used_percent": 0.0,
                        "ingested_volume_bytes": 0,
                        "ingested_volume_formatted": "0 B",
                        "object_count": 0,
                        "custom_metadata_count": 0,
                        "custom_metadata_size": 0,
                        "shred_count": 0,
                        "shred_size": 0,
                        "status": "warning",
                    },
                    "namespaces_summary": {"total_count": 0, "warning_count": 0, "critical_count": 0, "healthy_count": 0},
                    "namespaces": [],
                }

    tenant_results = await asyncio.gather(*(fetch_tenant_safe(t) for t in tenant_names))
    elapsed_ms = round((time.perf_counter() - start_time) * 1000.0, 1)

    total_used_bytes = 0
    total_hard_bytes = 0
    has_unlimited = False
    total_ingested_bytes = 0
    total_objects = 0
    all_namespaces = []

    tenants_warn = 0
    tenants_crit = 0
    tenants_ok = 0

    ns_total = 0
    ns_warn = 0
    ns_crit = 0
    ns_ok = 0

    tenants_list = []

    for t_res in tenant_results:
        t_info = t_res.get("tenant", {})
        t_status = t_res.get("status", "ok")
        if t_status == "critical":
            tenants_crit += 1
        elif t_status == "warning":
            tenants_warn += 1
        else:
            tenants_ok += 1

        used_b = t_info.get("storage_used_bytes", 0)
        hard_b = t_info.get("hard_quota_bytes")
        total_used_bytes += used_b
        if hard_b is not None:
            total_hard_bytes += hard_b
        else:
            has_unlimited = True

        total_ingested_bytes += t_info.get("ingested_volume_bytes", 0)
        total_objects += t_info.get("object_count", 0)

        t_ns_list = t_res.get("namespaces", [])
        t_summary = t_res.get("namespaces_summary", {})
        ns_total += t_summary.get("total_count", len(t_ns_list))
        ns_warn += t_summary.get("warning_count", 0)
        ns_crit += t_summary.get("critical_count", 0)
        ns_ok += t_summary.get("healthy_count", 0)

        for ns in t_ns_list:
            ns["tenant_name"] = t_info.get("name")
            all_namespaces.append(ns)

        tenants_list.append(t_info)

    cluster_hard_bytes = total_hard_bytes if total_hard_bytes > 0 else None
    cluster_used_pct = round((total_used_bytes / cluster_hard_bytes * 100.0), 2) if cluster_hard_bytes else 0.0
    cluster_quota_str = format_bytes(cluster_hard_bytes) if cluster_hard_bytes else "Unlimited / Multi-tenant"

    overall_status = "ok"
    if tenants_crit > 0 or ns_crit > 0:
        overall_status = "critical"
    elif tenants_warn > 0 or ns_warn > 0:
        overall_status = "warning"

    return {
        "status": overall_status,
        "response_time_ms": elapsed_ms,
        "is_cluster": True,
        "cluster": {
            "total_tenants": len(tenant_names),
            "total_namespaces": ns_total,
            "storage_used_bytes": total_used_bytes,
            "storage_used_formatted": format_bytes(total_used_bytes),
            "hard_quota_bytes": cluster_hard_bytes,
            "hard_quota_formatted": cluster_quota_str,
            "used_percent": cluster_used_pct,
            "object_count": total_objects,
            "ingested_volume_bytes": total_ingested_bytes,
            "ingested_volume_formatted": format_bytes(total_ingested_bytes),
            "status": overall_status,
        },
        "tenants_summary": {
            "total_count": len(tenant_names),
            "warning_count": tenants_warn,
            "critical_count": tenants_crit,
            "healthy_count": tenants_ok,
        },
        "tenants": sorted(tenants_list, key=lambda x: x.get("storage_used_bytes", 0), reverse=True),
        "namespaces_summary": {
            "total_count": ns_total,
            "warning_count": ns_warn,
            "critical_count": ns_crit,
            "healthy_count": ns_ok,
        },
        "namespaces": sorted(all_namespaces, key=lambda x: x.get("storage_used_bytes", 0), reverse=True),
    }

