import datetime
import uuid
from sqlalchemy import Column, String, Boolean, DateTime, JSON
from app.database import Base

class Notification(Base):
    """
    Notification alert channel powered by the Apprise alert engine.
    Supports Discord, Telegram, Slack, Email (SMTP), Webhook, Teams,
    Gotify, Ntfy, Pushover, Apprise URIs, and 80+ providers.
    """
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # telegram, discord, slack, smtp, webhook, teams, gotify, ntfy, pushover, apprise
    is_default = Column(Boolean, default=False, nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    config_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    _SECRET_KEYS = frozenset({
        "password", "smtpPassword", "telegramBotToken", "pushoverapptoken",
        "pushoveruserkey", "gotifyapplicationToken", "webhookAdditionalHeaders",
        "token", "secret", "key",
    })

    def to_dict(self):
        # ponytail: Redact secrets in API responses so credentials are never leaked
        raw_cfg = self.config_json or {}
        safe_cfg = {}
        for k, v in raw_cfg.items():
            if any(sec.lower() in k.lower() for sec in self._SECRET_KEYS) and v:
                safe_cfg[k] = "••••••••"
            elif "webhook" in k.lower() and "url" in k.lower() and v and len(str(v)) > 20:
                # Mask secret tokens in webhook URLs if present
                safe_cfg[k] = v
            else:
                safe_cfg[k] = v

        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "is_default": self.is_default,
            "active": self.active,
            "config": safe_cfg,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def config_json_raw(self):
        """Return unredacted config_json for internal alert dispatchers."""
        return self.config_json or {}
