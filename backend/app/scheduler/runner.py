import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.database import SessionLocal
from app.models.target import Target

logger = logging.getLogger(__name__)

def _make_job(target_id: str) -> None:
    """Job function that pushes check request to Celery queue, falling back to direct execution if Redis is absent."""
    try:
        from worker.tasks import run_check_task
        run_check_task.delay(target_id)
    except Exception as e:
        logger.warning(f"Celery broker unavailable ({e}), running check directly for target {target_id}")
        try:
            from worker.tasks import _execute_check
            _execute_check(target_id)
        except Exception as ex:
            logger.error(f"Direct check execution failed for target {target_id}: {ex}")

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
