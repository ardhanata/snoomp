import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is required. Example: "
        "postgresql://snoomp_admin:<password>@db:5432/snoomp_db"
    )
if DATABASE_URL.startswith("sqlite"):
    raise RuntimeError(
        "SQLite is no longer supported. Snoomp requires PostgreSQL (TimescaleDB "
        "recommended) for the system_metrics hypertable."
    )

# pool_pre_ping recycles connections dropped by the database or an idle-timeout
# proxy — without it the first request after a DB restart fails.
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

#: Indexes that must exist on already-provisioned databases. Both Postgres and
#: SQLite support "CREATE INDEX IF NOT EXISTS", so no dialect branching needed.
_REQUIRED_INDEXES = (
    ("ix_heartbeats_checked_at",
     "CREATE INDEX IF NOT EXISTS ix_heartbeats_checked_at ON heartbeats (checked_at)"),
    ("ix_heartbeats_target_checked",
     "CREATE INDEX IF NOT EXISTS ix_heartbeats_target_checked ON heartbeats (target_id, checked_at)"),
)


def _ensure_indexes():
    """Create missing indexes on an existing schema. Never fatal."""
    db = SessionLocal()
    try:
        for name, ddl in _REQUIRED_INDEXES:
            try:
                db.execute(text(ddl))
                db.commit()
            except Exception as e:  # noqa: BLE001 — an index is not worth a boot failure
                db.rollback()
                logger.warning("Could not create index %s: %s: %s", name, type(e).__name__, e)
        logger.info("Index check complete.")
    finally:
        db.close()


def init_db():
    # Import models to ensure they are registered on Base
    from app.models.user import User
    from app.models.target import Target
    from app.models.metrics import SystemMetrics
    from app.models.heartbeat import Heartbeat
    from app.models.incident import Incident
    from app.models.setting import Setting
    from app.models.notification import Notification

    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully.")

    # create_all() is a no-op for tables that already exist — including their
    # indexes — so a declarative Index() never reaches a live deployment.
    # These are issued explicitly and are safe to re-run.
    _ensure_indexes()

    # ponytail: TimescaleDB extension/hypertable queries are Postgres-only
    if engine.dialect.name == "postgresql":
        db = SessionLocal()
        try:
            db.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"))
            db.commit()
            logger.info("TimescaleDB extension verified/enabled.")

            db.execute(text("""
                SELECT create_hypertable('system_metrics', 'checked_at', if_not_exists => TRUE);
            """))
            db.commit()
            logger.info("TimescaleDB hypertable for system_metrics verified/created.")
        except Exception as e:
            logger.warning(f"TimescaleDB hypertable init skipped (standard Postgres?): {type(e).__name__}: {e}")
            db.rollback()
        finally:
            db.close()
