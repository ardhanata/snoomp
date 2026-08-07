import datetime
import uuid
from sqlalchemy import Column, String, Integer, Boolean, DateTime, JSON
from app.database import Base

class Target(Base):
    __tablename__ = "targets"

    # Using string UUID for ID compatibility
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # http, ping, tcp, dns, push, snmp, ssh, db
    host = Column(String, nullable=False)
    port = Column(Integer, nullable=True)
    path = Column(String, nullable=True)
    check_interval = Column(Integer, default=60, nullable=False)  # seconds
    enabled = Column(Boolean, default=True, nullable=False)
    tags = Column(JSON, nullable=True)  # List of string tags e.g. ["Prod", "Web"]
    config_json = Column(JSON, nullable=True)  # custom configuration options
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    # Keys in config_json that hold infrastructure credentials — never expose via API
    _SECRET_KEYS = frozenset({
        "password", "private_key", "connection_string",
        "community", "bot_token", "webhook_url", "chat_id",
    })

    def to_dict(self):
        # Redact secrets: replace values with a sentinel so the frontend
        # can detect "has a value" vs "empty" without seeing the actual secret
        raw_cfg = self.config_json or {}
        safe_cfg = {}
        for k, v in raw_cfg.items():
            if k in self._SECRET_KEYS and v:
                safe_cfg[k] = "••••••••"
            else:
                safe_cfg[k] = v

        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "host": self.host,
            "port": self.port,
            "path": self.path,
            "check_interval": self.check_interval,
            "enabled": self.enabled,
            "tags": self.tags or [],
            "config_json": safe_cfg,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

    def config_json_raw(self):
        """Return the unredacted config_json — only for checker internals, never for API."""
        return self.config_json or {}

