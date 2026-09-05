import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./snoomp.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

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


def _repair_sqlite_autoincrement():
    """
    Rebuild time-series tables whose primary key was created as BIGINT.

    SQLite only auto-assigns a primary key for a column declared exactly
    `INTEGER PRIMARY KEY`. These tables were created as BIGINT, so every insert
    failed with "NOT NULL constraint failed" and nothing was ever written on
    the SQLite path. `create_all` will not alter an existing table, so the old
    definition has to go before the corrected one can be created.

    Only ever drops a table that is empty — if a deployment somehow does hold
    rows, the table is left alone and a warning is logged rather than risking
    data for a convenience fix.
    """
    if engine.dialect.name != "sqlite":
        return

    db = SessionLocal()
    try:
        for table in ("heartbeats", "system_metrics"):
            try:
                ddl = db.execute(text(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=:t"
                ), {"t": table}).scalar()
                if not ddl or "BIGINT NOT NULL" not in ddl.upper():
                    continue

                count = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
                if count:
                    logger.warning(
                        "%s has a BIGINT primary key that cannot autoincrement on SQLite, "
                        "but holds %d rows — leaving it alone. Inserts will keep failing "
                        "until it is migrated manually.", table, count,
                    )
                    continue

                db.execute(text(f"DROP TABLE {table}"))
                db.commit()
                logger.info("Rebuilt empty %s to fix SQLite autoincrement.", table)
            except Exception as e:  # noqa: BLE001 — never block boot
                db.rollback()
                logger.warning("Could not repair %s: %s: %s", table, type(e).__name__, e)
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

    # Must run before create_all so the corrected definition can be applied.
    _repair_sqlite_autoincrement()

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
