import logging
import os
import re
import time
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["System"])

GITHUB_REPO = "ardhanata/snoomp"
GITHUB_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
CACHE_TTL_SECONDS = 900  # 15 minutes cache to preserve unauthenticated GitHub API rate limits

_cached_update_data: Optional[Dict[str, Any]] = None
_cache_timestamp: float = 0.0


def get_app_version() -> str:
    """Read the version baked into the image or filesystem."""
    locations = [
        "/VERSION",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "VERSION"),
        os.path.join(os.getcwd(), "VERSION")
    ]
    for vf in locations:
        if os.path.isfile(vf):
            try:
                with open(vf, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    if content:
                        return content
            except OSError:
                continue
    return "1.3.0"


def parse_semver(version_str: str) -> Tuple[int, ...]:
    """Parse version string like 'v1.2.0', '1.3.0', '1.2.0-rc1' into comparable tuple of ints."""
    cleaned = version_str.strip().lstrip("vV")
    parts = []
    # Split by dot or dash and grab leading numeric sequences
    for segment in re.split(r"[.-]", cleaned):
        match = re.match(r"^\d+", segment)
        if match:
            parts.append(int(match.group(0)))
        else:
            break
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def is_version_newer(latest: str, current: str) -> bool:
    """Check if latest version is strictly greater than current version."""
    if not latest:
        return False
    try:
        latest_parts = parse_semver(latest)
        current_parts = parse_semver(current)
        return latest_parts > current_parts
    except Exception:
        return latest.strip().lstrip("vV") != current.strip().lstrip("vV")


@router.get("/check-updates")
async def check_updates(force: bool = Query(default=False, description="Bypass cache and query GitHub directly")):
    """
    Check for software updates against the official GitHub releases.
    Results are cached in-memory for 15 minutes to respect GitHub rate limits.
    """
    global _cached_update_data, _cache_timestamp

    current_ver = get_app_version().lstrip("v")
    now = time.time()

    # Serve cached result if still valid and force flag not set
    if not force and _cached_update_data is not None and (now - _cache_timestamp) < CACHE_TTL_SECONDS:
        cached = dict(_cached_update_data)
        cached["current_version"] = current_ver
        cached["cached"] = True
        return cached

    result: Dict[str, Any] = {
        "current_version": current_ver,
        "latest_version": current_ver,
        "has_update": False,
        "release_name": None,
        "release_notes": None,
        "html_url": f"https://github.com/{GITHUB_REPO}/releases",
        "published_at": None,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "cached": False,
        "upgrade_command_docker": "cd /opt/snoomp && git pull && docker compose up -d --build",
        "upgrade_command_installer": "curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash",
        "error": None
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            headers = {
                "User-Agent": f"Snoomp-Observability/{current_ver}",
                "Accept": "application/vnd.github.v3+json"
            }
            resp = await client.get(GITHUB_RELEASES_URL, headers=headers)

            if resp.status_code == 200:
                data = resp.json()
                latest_tag = data.get("tag_name", "").strip().lstrip("v")
                has_update = is_version_newer(latest_tag, current_ver)

                result.update({
                    "latest_version": latest_tag or current_ver,
                    "has_update": has_update,
                    "release_name": data.get("name") or f"Snoomp v{latest_tag}",
                    "release_notes": (data.get("body") or "").strip()[:4000],
                    "html_url": data.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases",
                    "published_at": data.get("published_at")
                })

                _cached_update_data = dict(result)
                _cache_timestamp = now
                return result

            elif resp.status_code == 404:
                result["error"] = "No public releases found in repository."
                return result

            elif resp.status_code == 403:
                result["error"] = "GitHub API rate limit exceeded. Please try again later."
                # Return previously cached data if available
                if _cached_update_data is not None:
                    fallback = dict(_cached_update_data)
                    fallback["current_version"] = current_ver
                    fallback["warning"] = "Showing cached release info due to GitHub rate limiting."
                    return fallback
                return result

            else:
                result["error"] = f"GitHub API returned HTTP {resp.status_code}"
                return result

    except httpx.TimeoutException:
        logger.warning("Update check timed out contacting %s", GITHUB_RELEASES_URL)
        result["error"] = "Connection timed out checking for updates."
        return result
    except Exception as e:
        logger.warning("Failed to check for updates: %s", e)
        result["error"] = f"Unable to verify updates: {str(e)}"
        return result
