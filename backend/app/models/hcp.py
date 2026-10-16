import datetime
import uuid
from typing import Any, Dict, Optional
from sqlalchemy import Column, String, Integer, Boolean, DateTime, JSON, Float
from app.database import Base


class HcpTenant(Base):
    __tablename__ = "hcp_tenants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(Integer, default=9090, nullable=False)
    tenant_name = Column(String, default="*", nullable=False)
    is_cluster = Column(Boolean, default=False, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    ignore_tls = Column(Boolean, default=False, nullable=False)
    site = Column(String, nullable=True)
    enabled = Column(Boolean, default=True, nullable=False)
    check_interval = Column(Integer, default=300, nullable=False)

    last_status = Column(String, default="pending", nullable=False)
    last_sync_at = Column(DateTime, nullable=True)
    last_response_time_ms = Column(Float, nullable=True)
    last_error = Column(String, nullable=True)
    metrics_cache = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    def to_dict(self, include_metrics: bool = True) -> Dict[str, Any]:
        data = {
            "id": self.id,
            "name": self.name,
            "host": self.host,
            "port": self.port,
            "tenant_name": self.tenant_name,
            "is_cluster": bool(self.is_cluster),
            "username": self.username,
            "password": "••••••••" if self.password else "",
            "ignore_tls": self.ignore_tls,
            "site": self.site,
            "enabled": self.enabled,
            "check_interval": self.check_interval,
            "last_status": self.last_status,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_response_time_ms": self.last_response_time_ms,
            "last_error": self.last_error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_metrics:
            data["metrics"] = self.metrics_cache or {}
        return data
