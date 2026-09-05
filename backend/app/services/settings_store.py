"""
Instance settings: defaults, persistence, and secret handling.

Two rules shape this module.

1. Reads must never be fatal. A checker or notifier that cannot reach the
   settings table falls back to defaults (and, for Discord, to the historical
   environment variables) rather than failing the check it was in the middle of.

2. Secrets never leave the process. Webhook URLs are redacted on read and the
   redaction sentinel is treated as "unchanged" on write, so a client can PUT
   back the object it just GET'd without blanking the stored secret.
"""

import logging
import os
from typing import Any

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.setting import Setting

logger = logging.getLogger(__name__)

#: Written back to clients in place of a stored secret.
REDACTED = "••••••••"

#: Keys whose values are secrets.
_SECRET_PATHS = {
    ("discord", "webhook_critical"),
    ("discord", "webhook_warning"),
}

#: Shipped defaults. Also the schema — anything not listed here is rejected on
#: write, so a typo in a client cannot silently create a dead setting.
DEFAULTS: dict[str, Any] = {
    "sla": {
        # Percentages, descending. normal > warning > critical.
        "normal": 99.9,
        "warning": 99.0,
        "critical": 95.0,
    },
    "thresholds": {
        # Fleet-wide resource ceilings. A monitor may override any of these in
        # its own config_json["thresholds"].
        "cpu_warn": 80.0,
        "cpu_crit": 95.0,
        "mem_warn": 85.0,
        "mem_crit": 95.0,
        "disk_warn": 85.0,
        "disk_crit": 95.0,
        # Latency ceilings in milliseconds. null disables the check.
        "latency_warn": None,
        "latency_crit": None,
    },
    "discord": {
        "enabled": False,
        "webhook_critical": "",
        "webhook_warning": "",
        "oncall_role_id": "",
    },
    "defaults": {
        "check_interval": 60,
        "retries": 0,
        "request_timeout": 10,
        "monitor_type": "http",
        "environment_tag": "",
        "retention_days": 90,
    },
    "appearance": {
        # Chart series colours, overridable per instance.
        "chart_1": "#8b5cf6",
        "chart_2": "#06b6d4",
        "chart_3": "#ec4899",
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Merge `override` onto a copy of `base`, one level of nesting deep."""
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            merged = dict(out[k])
            merged.update(v)
            out[k] = merged
        else:
            out[k] = v
    return out


def get_all_raw(db: Session | None = None) -> dict[str, Any]:
    """Full settings with secrets intact. Never returns this to a client."""
    own_session = db is None
    session = db or SessionLocal()
    try:
        stored = {row.key: row.value_json for row in session.query(Setting).all()}
        return _deep_merge(DEFAULTS, stored)
    except Exception as exc:  # noqa: BLE001 — settings must not break callers
        logger.warning("Could not read settings, falling back to defaults: %s", exc)
        return {k: dict(v) if isinstance(v, dict) else v for k, v in DEFAULTS.items()}
    finally:
        if own_session:
            session.close()


def redact(settings: dict[str, Any]) -> dict[str, Any]:
    """Replace stored secrets with the sentinel, preserving 'is it set?'."""
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in settings.items()}
    for section, key in _SECRET_PATHS:
        if section in out and isinstance(out[section], dict):
            if out[section].get(key):
                out[section][key] = REDACTED
    return out


def get_all(db: Session | None = None) -> dict[str, Any]:
    """Client-safe settings."""
    return redact(get_all_raw(db))


def get_section(section: str, db: Session | None = None) -> dict[str, Any]:
    """One section, secrets intact. For internal callers only."""
    value = get_all_raw(db).get(section)
    return value if isinstance(value, dict) else {}


def save(section: str, values: dict[str, Any], db: Session) -> dict[str, Any]:
    """
    Persist one section.

    Unknown keys are dropped rather than stored — DEFAULTS is the schema.
    A secret arriving as the redaction sentinel means "leave it alone", which
    is what lets a client round-trip the object it was given.
    """
    if section not in DEFAULTS:
        raise KeyError(f"Unknown settings section: {section}")

    allowed = set(DEFAULTS[section].keys())
    existing = get_section(section, db)

    clean: dict[str, Any] = {}
    for k, v in (values or {}).items():
        if k not in allowed:
            logger.info("Ignoring unknown setting %s.%s", section, k)
            continue
        if (section, k) in _SECRET_PATHS and v == REDACTED:
            clean[k] = existing.get(k, "")
            continue
        clean[k] = v

    merged = {**DEFAULTS[section], **existing, **clean}

    row = db.query(Setting).filter_by(key=section).first()
    if row is None:
        row = Setting(key=section, value_json=merged)
        db.add(row)
    else:
        row.value_json = merged
    db.commit()
    return merged


def discord_config() -> dict[str, Any]:
    """
    Discord settings with environment fallback.

    The DB is authoritative once a value is set there; the DISCORD_* variables
    remain honoured so existing deployments keep working untouched after
    upgrading, and so a container can still be configured without a UI.
    """
    cfg = get_section("discord")

    def _env_flag(name: str) -> bool:
        raw = (os.getenv(name) or "").strip().lower()
        return raw in {"1", "true", "yes", "on"}

    return {
        "enabled": bool(cfg.get("enabled")) or _env_flag("DISCORD_ALERTS_ENABLED"),
        "webhook_critical": (cfg.get("webhook_critical")
                             or os.getenv("DISCORD_WEBHOOK_CRITICAL") or "").strip(),
        "webhook_warning": (cfg.get("webhook_warning")
                            or os.getenv("DISCORD_WEBHOOK_WARNING") or "").strip(),
        "oncall_role_id": (cfg.get("oncall_role_id")
                           or os.getenv("DISCORD_ONCALL_ROLE_ID") or "").strip(),
    }
