import datetime
import uuid
from sqlalchemy import Column, String, Boolean, DateTime, JSON
from app.database import Base

class StatusPage(Base):
    __tablename__ = "status_pages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)  # e.g. "prod-status"
    description = Column(String, nullable=True)
    monitor_ids = Column(JSON, nullable=False, default=list)  # list of target IDs to display
    is_public = Column(Boolean, default=True)
    logo_url = Column(String, nullable=True)
    custom_css = Column(String, nullable=True)
    created_by = Column(String, nullable=True)  # username
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            "description": self.description,
            "monitor_ids": self.monitor_ids or [],
            "is_public": self.is_public,
            "logo_url": self.logo_url,
            "custom_css": self.custom_css,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
