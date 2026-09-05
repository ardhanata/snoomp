"""
Discord webhook notifier for Snoomp status transitions.

Routes alerts to two channels by severity (see docs/DISCORD-SERVER-BLUEPRINT.md):

    #alerts-critical  DOWN transitions. Mentions the OnCall role.
    #alerts-warning   degraded / warning / SSL expiry. Never mentions.

Discord allows roughly 5 requests per 2 seconds per webhook. A network partition
that takes 40 monitors down at once will blow through that from several Celery
workers in parallel and silently drop alerts, so transitions are pushed to a
Redis list and drained by a single batched flusher (up to 10 embeds per request,
which is Discord's per-message ceiling). If Redis is unavailable — the native
Windows deployment mode — alerts fall back to a direct paced send.

Configuration is global, via environment variables:

    DISCORD_ALERTS_ENABLED      1 / true to enable (default: off)
    DISCORD_WEBHOOK_CRITICAL    webhook URL for #alerts-critical
    DISCORD_WEBHOOK_WARNING     webhook URL for #alerts-warning
    DISCORD_ONCALL_ROLE_ID      numeric role ID pinged on critical alerts
    DISCORD_QUEUE_MAX           max queued alerts per channel (default: 500)
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_RECOVERED = "recovered"

# Statuses that open an incident, mapped to the severity used for routing.
_STATUS_SEVERITY = {
    "down": SEVERITY_CRITICAL,
    "critical": SEVERITY_CRITICAL,
    "off": SEVERITY_CRITICAL,
    "degraded": SEVERITY_WARNING,
    "warning": SEVERITY_WARNING,
    "up": SEVERITY_RECOVERED,
}

# Recovered alerts go to the same channel that carried the original alarm, so a
# reader of #alerts-critical always sees the resolution without switching views.
_SEVERITY_CHANNEL = {
    SEVERITY_CRITICAL: "critical",
    SEVERITY_RECOVERED: "critical",
    SEVERITY_WARNING: "warning",
}

_EMBED_COLOR = {
    SEVERITY_CRITICAL: 15548997,   # red
    SEVERITY_WARNING: 16098851,    # amber
    SEVERITY_RECOVERED: 3066993,   # green
}

_TITLE_TAG = {
    SEVERITY_CRITICAL: "DOWN",
    SEVERITY_WARNING: "DEGRADED",
    SEVERITY_RECOVERED: "RECOVERED",
}

# Discord hard limits
MAX_EMBEDS_PER_MESSAGE = 10
MAX_FIELD_VALUE = 1024
MAX_DESCRIPTION = 4096

# Pacing: stay under ~5 requests / 2s per webhook with headroom.
MAX_REQUESTS_PER_FLUSH = 4
INTER_REQUEST_DELAY = 0.45

QUEUE_KEY = "snoomp:discord:queue:{channel}"

_WEBHOOK_RE = re.compile(
    r"^/api(?:/v\d+)?/webhooks/\d+/[\w-]+$"
)


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_valid_webhook(url: str | None) -> bool:
    """
    Accept only real Discord webhook URLs.

    A mistyped or attacker-supplied URL here would receive every hostname,
    error string, and SLA figure Snoomp produces, so this is a whitelist of
    host plus path shape rather than a generic URL check.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    if parsed.hostname not in {"discord.com", "discordapp.com", "ptb.discord.com",
                               "canary.discord.com"}:
        return False
    return bool(_WEBHOOK_RE.match(parsed.path))


def _resolved_config() -> dict:
    """
    Settings-table config, falling back to the DISCORD_* environment variables.

    Imported lazily and defensively: this module is loaded by the Celery worker,
    which must keep delivering alerts even if the settings table is unreachable
    or has not been created yet on a freshly upgraded install.
    """
    try:
        from app.services.settings_store import discord_config
        return discord_config()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Settings unavailable, using environment only: %s", exc)
        return {
            "enabled": _env_flag("DISCORD_ALERTS_ENABLED", False),
            "webhook_critical": (os.getenv("DISCORD_WEBHOOK_CRITICAL") or "").strip(),
            "webhook_warning": (os.getenv("DISCORD_WEBHOOK_WARNING") or "").strip(),
            "oncall_role_id": (os.getenv("DISCORD_ONCALL_ROLE_ID") or "").strip(),
        }


def webhook_for(channel: str) -> str | None:
    """Resolve a channel name ('critical' / 'warning') to its webhook URL."""
    if channel not in ("critical", "warning"):
        return None

    cfg = _resolved_config()
    url = cfg.get(f"webhook_{channel}", "")
    if not url:
        # Fall back to the critical webhook so a half-configured install still
        # delivers warnings rather than dropping them on the floor.
        if channel == "warning":
            url = cfg.get("webhook_critical", "")
        if not url:
            return None

    if not is_valid_webhook(url):
        logger.error(
            "Configured %s webhook is not a valid Discord URL; refusing to send. "
            "Expected https://discord.com/api/webhooks/<id>/<token>", channel
        )
        return None
    return url


def alerts_enabled() -> bool:
    """True if either the settings table or DISCORD_ALERTS_ENABLED turns it on."""
    return bool(_resolved_config().get("enabled"))


def severity_for(status: str) -> str:
    return _STATUS_SEVERITY.get((status or "").lower(), SEVERITY_WARNING)


def channel_for(severity: str) -> str:
    return _SEVERITY_CHANNEL.get(severity, "warning")


# --------------------------------------------------------------------------
# Alert payload
# --------------------------------------------------------------------------
@dataclass
class DiscordAlert:
    target_name: str
    host: str
    target_type: str
    prev_status: str
    new_status: str
    response_time_ms: float | None = None
    error: str | None = None
    duration_s: float | None = None
    uptime_30d: float | None = None
    occurred_at: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

    @property
    def severity(self) -> str:
        return severity_for(self.new_status)

    def to_json(self) -> str:
        return json.dumps(self.__dict__)

    @classmethod
    def from_json(cls, raw: str | bytes) -> "DiscordAlert":
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return cls(**json.loads(raw))

    # ---------------------------------------------------------------- embed
    def to_embed(self) -> dict[str, Any]:
        sev = self.severity
        tag = _TITLE_TAG[sev]

        fields = [
            {"name": "Host", "value": _clip(self.host or "-", 100), "inline": True},
            {"name": "Protocol", "value": (self.target_type or "-").upper(), "inline": True},
            {
                "name": "Transition",
                "value": f"{(self.prev_status or '?').upper()} -> {(self.new_status or '?').upper()}",
                "inline": True,
            },
        ]

        if self.response_time_ms is not None:
            fields.append({
                "name": "Response",
                "value": f"{self.response_time_ms:.0f} ms",
                "inline": True,
            })
        if self.duration_s is not None:
            fields.append({
                "name": "Downtime",
                "value": _human_duration(self.duration_s),
                "inline": True,
            })
        if self.uptime_30d is not None:
            fields.append({
                "name": "Uptime 30d",
                "value": f"{self.uptime_30d:.2f}%",
                "inline": True,
            })

        embed: dict[str, Any] = {
            "title": f"{tag} - {_clip(self.target_name or 'unknown', 200)}",
            "color": _EMBED_COLOR[sev],
            "fields": fields,
            "timestamp": self.occurred_at,
            "footer": {"text": "Snoomp"},
        }
        if self.error:
            embed["description"] = _clip(f"```{self.error}```", MAX_DESCRIPTION)
        return embed


def _clip(text: str, limit: int) -> str:
    text = str(text)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _human_duration(seconds: float) -> str:
    seconds = int(max(0, seconds))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds // 3600}h {(seconds % 3600) // 60}m"


# --------------------------------------------------------------------------
# Message assembly
# --------------------------------------------------------------------------
def build_message(alerts: list[DiscordAlert]) -> dict[str, Any]:
    """
    Pack up to MAX_EMBEDS_PER_MESSAGE alerts into one webhook payload.

    Only critical (not recovered) alerts mention the OnCall role, and the
    mention is emitted once per message regardless of how many alerts it
    carries — 40 pings for one partition is how an alert channel gets muted.
    """
    embeds = [a.to_embed() for a in alerts[:MAX_EMBEDS_PER_MESSAGE]]
    payload: dict[str, Any] = {"embeds": embeds}

    role_id = _resolved_config().get("oncall_role_id", "")
    needs_ping = any(a.severity == SEVERITY_CRITICAL for a in alerts)

    if needs_ping and role_id.isdigit():
        down = sum(1 for a in alerts if a.severity == SEVERITY_CRITICAL)
        suffix = f" - {down} monitors down" if down > 1 else ""
        payload["content"] = f"<@&{role_id}>{suffix}"
        payload["allowed_mentions"] = {"parse": [], "roles": [role_id]}
    else:
        # Explicitly suppress mentions so a monitor named "@everyone" can't page
        # the server.
        payload["allowed_mentions"] = {"parse": []}

    return payload


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------
def _post(url: str, payload: dict[str, Any], client: httpx.Client | None = None) -> bool:
    owns = client is None
    client = client or httpx.Client(timeout=10.0)
    try:
        for _ in range(3):
            resp = client.post(url, json=payload)
            if resp.status_code == 429:
                try:
                    retry_after = float(resp.json().get("retry_after", 1.0))
                except Exception:
                    retry_after = 1.0
                logger.warning("Discord rate limited, sleeping %.2fs", retry_after)
                time.sleep(min(retry_after, 5.0) + 0.1)
                continue
            if resp.status_code >= 400:
                logger.error("Discord webhook rejected payload: %s %s",
                             resp.status_code, resp.text[:300])
                return False
            return True
        logger.error("Discord webhook exhausted rate-limit retries")
        return False
    except httpx.HTTPError as exc:
        logger.error("Discord webhook transport error: %s", exc)
        return False
    finally:
        if owns:
            client.close()


# --------------------------------------------------------------------------
# Queue
# --------------------------------------------------------------------------
def _redis():
    """Return a Redis client, or None if unreachable (native Windows mode)."""
    try:
        import redis
        url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        conn = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        conn.ping()
        return conn
    except Exception as exc:
        logger.debug("Redis unavailable for Discord queue: %s", exc)
        return None


def enqueue(alert: DiscordAlert) -> bool:
    """
    Queue an alert for the next flush.

    Returns True if the alert was queued or sent. Never raises — a notification
    failure must not roll back the incident write that triggered it.
    """
    if not alerts_enabled():
        return False

    channel = channel_for(alert.severity)
    if not webhook_for(channel):
        logger.warning("Discord alerts enabled but no webhook configured for %s", channel)
        return False

    conn = _redis()
    if conn is None:
        # No Redis: send immediately. Single-process deployment, so the 5/2s
        # ceiling is not realistically reachable.
        return send_now([alert])

    try:
        key = QUEUE_KEY.format(channel=channel)
        max_len = int(os.getenv("DISCORD_QUEUE_MAX", "500"))
        pipe = conn.pipeline()
        pipe.rpush(key, alert.to_json())
        pipe.ltrim(key, -max_len, -1)   # drop oldest on overflow
        pipe.execute()
        return True
    except Exception as exc:
        logger.error("Failed to queue Discord alert, sending directly: %s", exc)
        return send_now([alert])


def send_now(alerts: list[DiscordAlert]) -> bool:
    """Send alerts immediately, bypassing the queue. Used as the no-Redis path."""
    if not alerts:
        return True
    by_channel: dict[str, list[DiscordAlert]] = {}
    for a in alerts:
        by_channel.setdefault(channel_for(a.severity), []).append(a)

    ok = True
    with httpx.Client(timeout=10.0) as client:
        for channel, group in by_channel.items():
            url = webhook_for(channel)
            if not url:
                ok = False
                continue
            for i in range(0, len(group), MAX_EMBEDS_PER_MESSAGE):
                batch = group[i: i + MAX_EMBEDS_PER_MESSAGE]
                ok = _post(url, build_message(batch), client) and ok
                time.sleep(INTER_REQUEST_DELAY)
    return ok


def flush(max_requests_per_channel: int = MAX_REQUESTS_PER_FLUSH) -> int:
    """
    Drain queued alerts and deliver them in batches.

    Called on an interval by the scheduler. Sends at most
    `max_requests_per_channel` requests per channel per invocation so a large
    backlog drains over several cycles instead of tripping the rate limit;
    anything left stays queued. Returns the number of alerts delivered.
    """
    if not alerts_enabled():
        return 0

    conn = _redis()
    if conn is None:
        return 0

    delivered = 0
    with httpx.Client(timeout=10.0) as client:
        for channel in ("critical", "warning"):
            url = webhook_for(channel)
            if not url:
                continue

            key = QUEUE_KEY.format(channel=channel)
            for request_no in range(max_requests_per_channel):
                raw = _pop_batch(conn, key, MAX_EMBEDS_PER_MESSAGE)
                if not raw:
                    break

                alerts = []
                for item in raw:
                    try:
                        alerts.append(DiscordAlert.from_json(item))
                    except Exception as exc:
                        logger.error("Discarding malformed queued alert: %s", exc)
                if not alerts:
                    continue

                if _post(url, build_message(alerts), client):
                    delivered += len(alerts)
                else:
                    # Delivery failed for a reason other than rate limiting
                    # (bad webhook, network). Re-queue at the front so ordering
                    # survives, and stop hammering this channel this cycle.
                    try:
                        conn.lpush(key, *reversed(raw))
                    except Exception:
                        logger.error("Lost %d Discord alerts on requeue", len(raw))
                    break

                if request_no < max_requests_per_channel - 1:
                    time.sleep(INTER_REQUEST_DELAY)

    if delivered:
        logger.info("Flushed %d Discord alert(s)", delivered)
    return delivered


def _pop_batch(conn, key: str, count: int) -> list[bytes]:
    """Atomically pop up to `count` items from the head of the list."""
    pipe = conn.pipeline()
    pipe.lrange(key, 0, count - 1)
    pipe.ltrim(key, count, -1)
    items, _ = pipe.execute()
    return list(items or [])


def queue_depth() -> dict[str, int]:
    """Current queue depth per channel. For diagnostics and health endpoints."""
    conn = _redis()
    if conn is None:
        return {}
    out = {}
    for channel in ("critical", "warning"):
        try:
            out[channel] = int(conn.llen(QUEUE_KEY.format(channel=channel)))
        except Exception:
            out[channel] = -1
    return out


# --------------------------------------------------------------------------
# Convenience used by the worker
# --------------------------------------------------------------------------
def notify_status_change(
    *,
    target_name: str,
    host: str,
    target_type: str,
    prev_status: str,
    new_status: str,
    response_time_ms: float | None = None,
    error: str | None = None,
    duration_s: float | None = None,
) -> bool:
    """Build and queue an alert from a status transition. Never raises."""
    try:
        if not alerts_enabled():
            return False
        return enqueue(DiscordAlert(
            target_name=target_name,
            host=host,
            target_type=target_type,
            prev_status=prev_status,
            new_status=new_status,
            response_time_ms=response_time_ms,
            error=error,
            duration_s=duration_s,
        ))
    except Exception as exc:
        logger.error("Discord notification failed for %s: %s", target_name, exc)
        return False
