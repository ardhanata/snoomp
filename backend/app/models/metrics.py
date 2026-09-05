import datetime
from sqlalchemy import Column, String, Float, DateTime, BigInteger, Integer, JSON
from app.database import Base

class SystemMetrics(Base):
    __tablename__ = "system_metrics"

    # TimescaleDB requires partitioning column (checked_at) to be part of the primary key
    # See AutoBigInt in app/models/heartbeat.py — BIGINT is not a rowid alias
    # on SQLite, so autoincrement silently does nothing without the variant.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    target_id = Column(String, index=True, nullable=False)
    checked_at = Column(DateTime(timezone=True), index=True, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    cpu_percent = Column(Float, nullable=True)
    mem_percent = Column(Float, nullable=True)
    disk_percent = Column(Float, nullable=True)
    uptime = Column(String, nullable=True)
    details_json = Column(JSON, nullable=True)  # any extra details like load averages, disk bytes

    def to_dict(self):
        return {
            "id": self.id,
            "target_id": self.target_id,
            "checked_at": self.checked_at.isoformat() if self.checked_at else None,
            "cpu_percent": self.cpu_percent,
            "mem_percent": self.mem_percent,
            "disk_percent": self.disk_percent,
            "uptime": self.uptime,
            "details_json": self.details_json or {}
        }
