import datetime

from sqlalchemy import Column, String, JSON, DateTime

from app.database import Base


class Setting(Base):
    """
    Instance-wide configuration, one row per key.

    Deliberately key/value rather than a wide single-row table: settings are
    read as a whole and written as a whole, new keys ship without a migration,
    and an unknown key left behind by a downgrade is inert rather than fatal.

    Values are JSON so a key can hold a scalar or a nested object (the SLA
    block and the Discord block are both single keys).
    """

    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value_json = Column(JSON, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value_json,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
