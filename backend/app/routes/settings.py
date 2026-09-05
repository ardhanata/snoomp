import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.security import get_current_user, require_admin, require_viewer
from app.database import get_db
from app.services import settings_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Settings"])


# ── Schemas ──
# Validation lives here rather than in the client so a direct API caller cannot
# store a set of thresholds the UI would refuse to accept.

class SlaSettings(BaseModel):
    normal: float = Field(ge=0, le=100)
    warning: float = Field(ge=0, le=100)
    critical: float = Field(ge=0, le=100)

    @field_validator("critical")
    @classmethod
    def _descending(cls, critical, info):
        normal = info.data.get("normal")
        warning = info.data.get("warning")
        if normal is not None and warning is not None:
            if not (normal > warning > critical):
                raise ValueError(
                    "SLA targets must descend: normal > warning > critical "
                    f"(got {normal} > {warning} > {critical})"
                )
        return critical


class ThresholdSettings(BaseModel):
    cpu_warn: Optional[float] = Field(default=None, ge=0, le=100)
    cpu_crit: Optional[float] = Field(default=None, ge=0, le=100)
    mem_warn: Optional[float] = Field(default=None, ge=0, le=100)
    mem_crit: Optional[float] = Field(default=None, ge=0, le=100)
    disk_warn: Optional[float] = Field(default=None, ge=0, le=100)
    disk_crit: Optional[float] = Field(default=None, ge=0, le=100)
    latency_warn: Optional[float] = Field(default=None, ge=0)
    latency_crit: Optional[float] = Field(default=None, ge=0)

    @field_validator("cpu_crit", "mem_crit", "disk_crit", "latency_crit")
    @classmethod
    def _crit_above_warn(cls, crit, info):
        warn = info.data.get(info.field_name.replace("_crit", "_warn"))
        if crit is not None and warn is not None and crit < warn:
            raise ValueError(
                f"{info.field_name} ({crit}) must be at or above "
                f"{info.field_name.replace('_crit', '_warn')} ({warn})"
            )
        return crit


class DiscordSettings(BaseModel):
    enabled: bool = False
    webhook_critical: str = ""
    webhook_warning: str = ""
    oncall_role_id: str = ""

    @field_validator("webhook_critical", "webhook_warning")
    @classmethod
    def _valid_webhook(cls, url: str):
        url = (url or "").strip()
        # The sentinel means "unchanged" — settings_store resolves it.
        if not url or url == settings_store.REDACTED:
            return url
        from app.notifications.discord import is_valid_webhook
        if not is_valid_webhook(url):
            raise ValueError(
                "Must be a Discord webhook URL, e.g. "
                "https://discord.com/api/webhooks/<id>/<token>"
            )
        return url

    @field_validator("oncall_role_id")
    @classmethod
    def _numeric_role(cls, value: str):
        value = (value or "").strip()
        if value and not value.isdigit():
            raise ValueError("On-call role ID must be numeric (Discord snowflake)")
        return value


class DefaultsSettings(BaseModel):
    check_interval: int = Field(default=60, ge=10, le=86400)
    retries: int = Field(default=0, ge=0, le=10)
    request_timeout: int = Field(default=10, ge=1, le=300)
    monitor_type: str = "http"
    environment_tag: str = ""
    retention_days: int = Field(default=90, ge=1, le=3650)


class AppearanceSettings(BaseModel):
    chart_1: str
    chart_2: str
    chart_3: str

    @field_validator("chart_1", "chart_2", "chart_3")
    @classmethod
    def _hex(cls, value: str):
        value = (value or "").strip()
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError("Colour must be a 7-character hex value like #3b82f6")
        int(value[1:], 16)  # raises ValueError on non-hex
        return value.lower()


_SECTION_MODELS = {
    "sla": SlaSettings,
    "thresholds": ThresholdSettings,
    "discord": DiscordSettings,
    "defaults": DefaultsSettings,
    "appearance": AppearanceSettings,
}


class SettingsUpdate(BaseModel):
    """Partial update — send only the sections you are changing."""
    sla: Optional[dict[str, Any]] = None
    thresholds: Optional[dict[str, Any]] = None
    discord: Optional[dict[str, Any]] = None
    defaults: Optional[dict[str, Any]] = None
    appearance: Optional[dict[str, Any]] = None


# ── Routes ──

@router.get("/")
def read_settings(
    db: Session = Depends(get_db),
    _user=Depends(require_viewer),
):
    """
    Instance settings, secrets redacted.

    Readable by any authenticated user: the dashboard needs the SLA block to
    colour uptime badges, and the appearance block to draw charts.
    """
    return settings_store.get_all(db)


@router.put("/")
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin),
):
    """
    Write one or more sections. Admin only — these are instance-wide.

    Each section is validated by its own model before anything is written, so a
    request that fails halfway does not leave settings partly applied.
    """
    incoming = payload.model_dump(exclude_none=True)
    if not incoming:
        raise HTTPException(status_code=400, detail="No settings supplied")

    validated: dict[str, dict] = {}
    for section, values in incoming.items():
        model = _SECTION_MODELS.get(section)
        if model is None:
            raise HTTPException(status_code=400, detail=f"Unknown section '{section}'")
        current = settings_store.get_section(section, db)
        merged = {**settings_store.DEFAULTS[section], **current, **values}
        try:
            validated[section] = model(**merged).model_dump()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"{section}: {exc}") from exc

    for section, values in validated.items():
        settings_store.save(section, values, db)

    logger.info("Settings updated: %s", ", ".join(validated))
    return settings_store.get_all(db)


@router.post("/discord/test")
def test_discord(
    _db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    """
    Send a real alert through the configured webhook.

    Deliberately goes through the same queue and formatting as a live incident
    — a test that used a different code path would not prove much.
    """
    from app.notifications import discord

    cfg = settings_store.discord_config()
    if not cfg["enabled"]:
        raise HTTPException(status_code=400, detail="Discord alerts are disabled")
    if not cfg["webhook_critical"] and not cfg["webhook_warning"]:
        raise HTTPException(status_code=400, detail="No webhook URL configured")

    queued = discord.notify_status_change(
        target_name="Snoomp test alert",
        host="snoomp.local",
        target_type="http",
        prev_status="up",
        new_status="down",
        response_time_ms=0.0,
        error=f"Test alert requested from Preferences by {user.username}",
    )
    if not queued:
        raise HTTPException(
            status_code=502,
            detail="Alert could not be queued — check the webhook URL and server logs",
        )

    # Queued alerts are drained by the scheduled flush; push it now so the
    # operator sees the message while they are still looking at the dialog.
    try:
        discord.flush()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Immediate Discord flush failed: %s", exc)

    return {"ok": True, "detail": "Test alert sent"}
