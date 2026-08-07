import datetime
from sqlalchemy import Column, String, Float, DateTime, BigInteger, Integer
from app.database import Base

class Heartbeat(Base):
    __tablename__ = "heartbeats"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    target_id = Column(String, index=True, nullable=False)
    status = Column(String, nullable=False)  # up, down, degraded, maintenance, off
    response_time_ms = Column(Float, default=0.0)
    checked_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    error = Column(String, nullable=True)
    msg = Column(String, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "target_id": self.target_id,
            "status": self.status,
            "response_time_ms": self.response_time_ms,
            "checked_at": self.checked_at.isoformat() if self.checked_at else None,
            "error": self.error,
            "msg": self.msg
        }
