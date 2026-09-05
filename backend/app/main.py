import os
import json
import logging
import asyncio
import time
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
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
from app.routes import status_pages, settings, notifications, backup
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
app.include_router(settings.router)
app.include_router(notifications.router)
app.include_router(backup.router)
app.include_router(websockets.router)

def get_app_version() -> str:
    import sys
    locations = [
        os.path.join(getattr(sys, "_MEIPASS", ""), "VERSION"),
        os.path.join(os.path.dirname(sys.executable), "VERSION"),
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
    return "1.0.0"

@app.get("/api/version")
def get_version():
    return {"version": get_app_version(), "release_date": "2026-09-06", "name": "Snoomp Enterprise Observability"}

@app.get("/api/system/check-updates")
async def check_system_updates():
    """Checks GitHub releases API for the latest Snoomp release."""
    import httpx
    import re
    current_ver = get_app_version().lstrip("v")
    repo = "ardhanata/snoomp"
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers={"User-Agent": "Snoomp-Update-Checker"})
            if resp.status_code == 200:
                data = resp.json()
                latest_tag = data.get("tag_name", "").lstrip("v")
                
                def parse_ver(v: str):
                    parts = []
                    for seg in v.split("."):
                        m = re.match(r"\d+", seg)
                        parts.append(int(m.group(0)) if m else 0)
                    return parts

                try:
                    has_update = parse_ver(latest_tag) > parse_ver(current_ver)
                except Exception:
                    has_update = (latest_tag != current_ver and bool(latest_tag))

                download_url = None
                for asset in data.get("assets", []):
                    name = asset.get("name", "").lower()
                    if "windows" in name and name.endswith(".zip"):
                        download_url = asset.get("browser_download_url")
                        break

                return {
                    "current_version": current_ver,
                    "latest_version": latest_tag,
                    "has_update": has_update,
                    "release_name": data.get("name") or f"Snoomp v{latest_tag}",
                    "release_notes": (data.get("body") or "")[:2000],
                    "html_url": data.get("html_url"),
                    "download_url": download_url,
                    "published_at": data.get("published_at")
                }
            elif resp.status_code == 404:
                return {
                    "current_version": current_ver,
                    "latest_version": current_ver,
                    "has_update": False,
                    "message": "No releases found on GitHub repository."
                }
            else:
                return {
                    "current_version": current_ver,
                    "latest_version": None,
                    "has_update": False,
                    "error": f"GitHub API returned HTTP {resp.status_code}"
                }
    except Exception as e:
        return {
            "current_version": current_ver,
            "latest_version": None,
            "has_update": False,
            "error": str(e)
        }

def _find_frontend_dist() -> str | None:
    # ponytail: prioritize external dist next to executable for zero-recompile hotfixes
    import sys
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        candidates.extend([
            os.path.join(exe_dir, "dist"),
            os.path.join(exe_dir, "frontend", "dist"),
        ])
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir:
        candidates.extend([
            os.path.join(bundle_dir, "frontend", "dist"),
            os.path.join(bundle_dir, "dist"),
        ])
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    candidates.extend([
        os.path.join(project_root, "frontend", "dist"),
        os.path.join(os.getcwd(), "frontend", "dist"),
        os.path.join(os.getcwd(), "dist"),
    ])
    for p in candidates:
        if p and os.path.isdir(p) and os.path.isfile(os.path.join(p, "index.html")):
            return os.path.abspath(p)
    return None

_frontend_dist = _find_frontend_dist()
if _frontend_dist:
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    logger.info("Serving frontend static assets from %s", _frontend_dist)
    # Asset filenames are content-hashed by Vite, so they can be cached
    # indefinitely. index.html must NOT be — it is what maps to the current
    # hashes, and a cached copy keeps requesting a bundle that no longer
    # exists (or worse, a stale one that still does).
    _IMMUTABLE = "public, max-age=31536000, immutable"
    _NO_STORE = "no-cache, no-store, must-revalidate"

    class _ImmutableStatics(StaticFiles):
        """StaticFiles that marks content-hashed assets as immutable."""

        def file_response(self, *args, **kwargs):
            resp = super().file_response(*args, **kwargs)
            resp.headers["Cache-Control"] = _IMMUTABLE
            return resp

    _assets_path = os.path.join(_frontend_dist, "assets")
    if os.path.exists(_assets_path):
        app.mount("/assets", _ImmutableStatics(directory=_assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("ws"):
            raise HTTPException(status_code=404, detail="Not Found")

        target_file = os.path.join(_frontend_dist, full_path)
        if full_path and os.path.isfile(target_file):
            # Hashed build assets are safe to cache forever; anything else
            # (favicon, manifest, stray static file) revalidates.
            immutable = full_path.startswith("assets/")
            return FileResponse(
                target_file,
                headers={"Cache-Control": _IMMUTABLE if immutable else _NO_STORE},
            )

        return FileResponse(
            os.path.join(_frontend_dist, "index.html"),
            headers={"Cache-Control": _NO_STORE},
        )
else:
    @app.get("/")
    def read_root():
        return {"name": "Snoomp Monitor API", "status": "running", "version": get_app_version()}


