import datetime
from sqlalchemy import Column, String, DateTime, Integer
from app.database import Base

class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    target_id = Column(String, index=True, nullable=False)
    from_status = Column(String, nullable=False)
    to_status = Column(String, nullable=False)
    started_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "target_id": self.target_id,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None
        }
