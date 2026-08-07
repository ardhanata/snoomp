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

def init_db():
    # Import models to ensure they are registered on Base
    from app.models.user import User
    from app.models.target import Target
    from app.models.metrics import SystemMetrics
    from app.models.heartbeat import Heartbeat
    from app.models.incident import Incident

    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully.")

    # ponytail: TimescaleDB extension/hypertable queries are Postgres-only
    if engine.dialect.name == "postgresql":
        from sqlalchemy.exc import OperationalError, ProgrammingError
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
        except (OperationalError, ProgrammingError) as e:
            logger.warning(f"TimescaleDB hypertable init skipped (standard Postgres?): {type(e).__name__}: {e}")
            db.rollback()
        finally:
            db.close()
