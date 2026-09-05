"""
Time-series retention.

Heartbeats accumulate at one row per monitor per check interval. A 52-monitor
fleet on a 60s interval writes ~75k rows a day, so without pruning the table
grows without bound and the dashboard's heartbeat queries slow down with it.

Deletes are batched rather than issued as one big statement. A single
`DELETE ... WHERE checked_at < cutoff` against months of backlog takes a long
write lock, which on SQLite blocks every checker in the process and on Postgres
bloats the table before autovacuum catches up. Batching keeps each transaction
short enough that a check running concurrently never waits noticeably.
"""

import datetime
import logging

from sqlalchemy import delete, func, select

from app.database import SessionLocal
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics

logger = logging.getLogger(__name__)

#: Rows removed per transaction.
BATCH_SIZE = 5_000

#: Safety valve — stop after this many batches in one run and finish next time,
#: so a first run against a huge backlog cannot monopolise the scheduler.
MAX_BATCHES_PER_RUN = 40


def _cutoff_for(model, days: int) -> datetime.datetime:
    """
    Cutoff matching the column's awareness.

    Heartbeat.checked_at is a naive DateTime defaulted from utcnow(), while
    SystemMetrics.checked_at is DateTime(timezone=True) defaulted from an
    aware now(). Comparing a naive value against an aware column makes
    Postgres reinterpret it in the session timezone, which silently shifts the
    window by the server's UTC offset. Build each cutoff to match its column.
    """
    column_type = model.__table__.c.checked_at.type
    if getattr(column_type, "timezone", False):
        return datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    return datetime.datetime.utcnow() - datetime.timedelta(days=days)


def _prune_model(db, model, cutoff: datetime.datetime) -> int:
    """Delete rows older than `cutoff` in batches. Returns the row count."""
    removed = 0
    for _ in range(MAX_BATCHES_PER_RUN):
        # Select the ids first: SQLite does not support DELETE ... LIMIT, and
        # doing it this way behaves identically on both supported backends.
        ids = db.execute(
            select(model.id)
            .where(model.checked_at < cutoff)
            .limit(BATCH_SIZE)
        ).scalars().all()

        if not ids:
            break

        db.execute(delete(model).where(model.id.in_(ids)))
        db.commit()
        removed += len(ids)

        if len(ids) < BATCH_SIZE:
            break

    return removed


def purge_old_data(retention_days: int | None = None) -> dict[str, int]:
    """
    Delete heartbeats and metrics past the retention window.

    Reads `defaults.retention_days` from settings unless given an explicit
    value. Never raises: retention is housekeeping, and a failure here must not
    take down the scheduler that also runs the health checks.
    """
    db = SessionLocal()
    try:
        if retention_days is None:
            from app.services.settings_store import get_section
            retention_days = int(get_section("defaults", db).get("retention_days") or 0)

        if retention_days <= 0:
            logger.debug("Retention disabled (retention_days=%s)", retention_days)
            return {"heartbeats": 0, "metrics": 0}

        hb_cutoff = _cutoff_for(Heartbeat, retention_days)

        # Never let a misconfiguration wipe live data: if everything currently
        # stored is older than the cutoff, the clock or the setting is wrong,
        # not the data. Bail rather than empty the table.
        newest = db.execute(select(func.max(Heartbeat.checked_at))).scalar()
        if newest is not None and newest < hb_cutoff:
            logger.error(
                "Refusing to purge: newest heartbeat (%s) predates the cutoff (%s). "
                "Check retention_days and the system clock.", newest, hb_cutoff,
            )
            return {"heartbeats": 0, "metrics": 0}

        heartbeats = _prune_model(db, Heartbeat, hb_cutoff)
        # NOTE: on TimescaleDB, system_metrics is a hypertable and
        # drop_chunks() would be far cheaper than row deletes. Kept as plain
        # DELETEs so one code path serves SQLite and Postgres alike; worth
        # revisiting if this table gets large.
        metrics = _prune_model(db, SystemMetrics, _cutoff_for(SystemMetrics, retention_days))

        if heartbeats or metrics:
            logger.info(
                "Retention purge removed %d heartbeats and %d metric rows older than %s",
                heartbeats, metrics, hb_cutoff.isoformat(),
            )
        return {"heartbeats": heartbeats, "metrics": metrics}

    except Exception as exc:  # noqa: BLE001 — housekeeping must never be fatal
        logger.error("Retention purge failed: %s: %s", type(exc).__name__, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return {"heartbeats": 0, "metrics": 0}
    finally:
        db.close()
