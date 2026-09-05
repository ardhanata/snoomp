import os
import logging
import concurrent.futures
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.database import SessionLocal
from app.models.target import Target

logger = logging.getLogger(__name__)

# In-process executor for standalone Windows execution without Celery/Redis
_in_process_executor = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="snoomp-check")

def _make_job(target_id: str) -> None:
    """Job function that pushes check request to Celery queue, falling back to in-process execution if Redis is absent."""
    use_celery = os.getenv("USE_CELERY", "auto").lower()
    if use_celery != "false":
        try:
            from worker.tasks import run_check_task
            run_check_task.delay(target_id)
            return
        except Exception as e:
            logger.debug(f"Celery dispatch failed ({e}), falling back to in-process execution")

    try:
        from worker.tasks import run_check_task
        _in_process_executor.submit(run_check_task, target_id)
    except Exception as ex:
        logger.error(f"In-process check execution failed for target {target_id}: {ex}")

def _flush_discord_alerts() -> None:
    """
    Drain the Discord alert queue.

    Runs in the API process rather than the workers on purpose: the batching
    only helps if a single flusher owns the queue. Several workers each posting
    their own alerts is exactly the fan-out that trips Discord's 5-requests-per-
    2-seconds webhook limit during a mass outage.
    """
    try:
        from app.notifications import discord
        discord.flush()
    except Exception as e:
        logger.error(f"Discord alert flush failed: {e}")


def _purge_old_data() -> None:
    """Apply the retention window. Housekeeping — never fatal."""
    try:
        from app.services.retention import purge_old_data
        purge_old_data()
    except Exception as e:
        logger.error(f"Retention purge failed: {e}")


def start_scheduler() -> BackgroundScheduler:
    """Loads all enabled targets from PostgreSQL and schedules Celery jobs."""
    scheduler = BackgroundScheduler()
    db = SessionLocal()
    try:
        targets = db.query(Target).filter_by(enabled=True).all()
        
        for i, target in enumerate(targets):
            # Offset initial checks to prevent thundering herd
            import datetime
            initial_run_time = datetime.datetime.now() + datetime.timedelta(seconds=i * 1.5)
            
            scheduler.add_job(
                func=_make_job,
                trigger=IntervalTrigger(seconds=target.check_interval),
                args=[target.id],
                id=f"check_{target.id}",
                replace_existing=True,
                max_instances=1,
                next_run_time=initial_run_time,
                misfire_grace_time=30,
            )
            logger.info(f"Scheduled target job: {target.name} ({target.id}) every {target.check_interval}s")
    except Exception as e:
        logger.error(f"Error starting scheduler: {e}")
    finally:
        db.close()

    # Discord alert flusher. Cheap no-op when DISCORD_ALERTS_ENABLED is unset.
    import os
    flush_interval = int(os.getenv("DISCORD_FLUSH_INTERVAL", "10"))
    scheduler.add_job(
        func=_flush_discord_alerts,
        trigger=IntervalTrigger(seconds=flush_interval),
        id="discord_alert_flush",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=30,
        coalesce=True,
    )
    logger.info(f"Scheduled Discord alert flusher every {flush_interval}s")

    # Retention purge. Hourly rather than daily so a busy instance never builds
    # up a backlog large enough to make one run expensive; the job is a cheap
    # no-op once the table is inside the window. Deliberately not run at boot —
    # a restart loop would otherwise trigger a purge every time.
    import datetime as _dt
    scheduler.add_job(
        func=_purge_old_data,
        trigger=IntervalTrigger(hours=1),
        id="retention_purge",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=600,
        coalesce=True,
        next_run_time=_dt.datetime.now() + _dt.timedelta(minutes=5),
    )
    logger.info("Scheduled retention purge every hour")

    scheduler.start()
    logger.info(f"Scheduler started with {len(scheduler.get_jobs())} jobs.")
    return scheduler

def stop_scheduler(scheduler: BackgroundScheduler) -> None:
    """Shuts down the scheduler gracefully."""
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped.")

def add_target_job(scheduler: BackgroundScheduler, target: Target) -> None:
    """Dynamically schedules a job for a new/updated target."""
    scheduler.add_job(
        func=_make_job,
        trigger=IntervalTrigger(seconds=target.check_interval),
        args=[target.id],
        id=f"check_{target.id}",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=30,
    )
    logger.info(f"Dynamically scheduled/updated job for target {target.name} ({target.id})")

def remove_target_job(scheduler: BackgroundScheduler, target_id: str) -> None:
    """Removes a target job from scheduler."""
    try:
        scheduler.remove_job(f"check_{target_id}")
        logger.info(f"Dynamically removed job for target {target_id}")
    except Exception:
        pass
