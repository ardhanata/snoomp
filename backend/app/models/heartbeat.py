import datetime
from sqlalchemy import Column, String, Float, DateTime, BigInteger, Index, Integer
from app.database import Base

#: SQLite only auto-assigns a primary key when the column is declared exactly
#: `INTEGER PRIMARY KEY` — that is the sole spelling it treats as a rowid alias.
#: A plain BigInteger renders as BIGINT, which is not, so every insert failed
#: with "NOT NULL constraint failed" and nothing was ever recorded on the
#: SQLite path. Postgres still gets BIGSERIAL via the base type.
AutoBigInt = BigInteger().with_variant(Integer, "sqlite")


class Heartbeat(Base):
    __tablename__ = "heartbeats"

    id = Column(AutoBigInt, primary_key=True, autoincrement=True)
    target_id = Column(String, index=True, nullable=False)
    status = Column(String, nullable=False)  # up, down, degraded, maintenance, off
    response_time_ms = Column(Float, default=0.0)
    checked_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False, index=True)
    error = Column(String, nullable=True)
    msg = Column(String, nullable=True)

    # Every read of this table is "latest N for one target" or "everything in a
    # time window", and both order by checked_at. With only target_id indexed,
    # Postgres had to sort a target's entire history on each call — and since
    # nothing prunes this table, that history only grows. The composite index
    # serves the per-target queries; the standalone checked_at index above
    # serves the fleet-wide SLA trend aggregation.
    __table_args__ = (
        Index("ix_heartbeats_target_checked", "target_id", "checked_at"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "target_id": self.target_id,
            "status": self.status,
            "response_time_ms": self.response_time_ms,
            "checked_at": self.checked_at.isoformat() + "Z" if self.checked_at else None,
            "error": self.error,
            "msg": self.msg
        }
