import os
import json
import logging
import asyncio
import time
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import init_db, SessionLocal, get_db
from app.services.dashboard import compile_initial_data
from app.models.user import User
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics
from app.models.status_page import StatusPage
from app.auth.security import get_password_hash
from app.scheduler import start_scheduler, stop_scheduler
from app.routes import auth, targets, dashboard
from app.routes import status_pages
from app import websockets

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ponytail: retry init_db so a slow DB container start doesn't crash the app
def _init_db_with_retry(max_retries: int = 10, base_delay: float = 2.0):
    for attempt in range(1, max_retries + 1):
        try:
            init_db()
            return
        except Exception as e:
            if attempt == max_retries:
                raise
            delay = min(base_delay * attempt, 15)
            logger.warning(f"DB not ready (attempt {attempt}/{max_retries}): {e} — retrying in {delay:.0f}s")
            time.sleep(delay)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Initialize Database & TimescaleDB (with retry for container orchestration)
    _init_db_with_retry()
    
    # 2. Seed Default User if empty
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            # F8: Generate a random admin password — print once to stdout, never to logger
            initial_password = os.environ.get("SNOOMP_ADMIN_PASSWORD") or secrets.token_urlsafe(16)
            admin_pwd = get_password_hash(initial_password)
            admin_user = User(
                username="admin",
                hashed_password=admin_pwd,
                role="admin",
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print(f"\n{'='*60}")
            print(f"  SNOOMP FIRST-RUN: Admin account created")
            print(f"  Username: admin")
            print(f"  Password: {initial_password}")
            print(f"  ⚠  Change this password immediately after first login.")
            print(f"{'='*60}\n")
            logger.info("Default admin user created (password printed to stdout)")
    finally:
        db.close()
        
    # 3. Start APScheduler (queues jobs via Celery)
    app.state.scheduler = start_scheduler()
    
    # 4. Start Redis pub/sub background listener
    listener_task = asyncio.create_task(websockets.redis_listener())
    
    yield
    
    # 5. Shutdown processes
    stop_scheduler(app.state.scheduler)
    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="Snoomp API",
    description="Enterprise Health & Resource Monitoring Tool API",
    version="1.0.0",
    lifespan=lifespan
)

# F6: CORS — explicit origin allowlist from environment, not wildcard
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8008").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Include API Routes
app.include_router(auth.router)
app.include_router(targets.router)
app.include_router(dashboard.router)
app.include_router(status_pages.router)
app.include_router(websockets.router)

def get_app_version() -> str:
    locations = [
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "VERSION"),
        "/VERSION"
    ]
    for vf in locations:
        if os.path.exists(vf):
            try:
                with open(vf, "r") as f:
                    return f.read().strip()
            except Exception:
                pass
    return "0.3.0"

@app.get("/")
def read_root():
    return {"name": "Snoomp Monitor API", "status": "running", "version": get_app_version()}

@app.get("/api/version")
def get_version():
    return {"version": get_app_version(), "release_date": "2026-07-30", "name": "Snoomp Enterprise Observability"}


