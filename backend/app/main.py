import os
import json
import logging
import asyncio
import time
import secrets
import redis.asyncio as async_redis
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import init_db, SessionLocal, get_db
from app.models.user import User
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics
from app.models.status_page import StatusPage
from app.auth.security import get_password_hash
from app.scheduler import start_scheduler, stop_scheduler
from app.routes import auth, targets, dashboard
from app.routes import status_pages

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Connection manager for active WebSockets
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New WebSocket connection. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Connection might be dead, it will be cleaned up in the main loop
                pass

manager = ConnectionManager()

def compile_initial_data(db) -> list:
    import datetime as dt
    targets_list = db.query(Target).all()
    initial_data = []
    for t in targets_list:
        latest_hb = (
            db.query(Heartbeat)
            .filter_by(target_id=t.id)
            .order_by(Heartbeat.checked_at.desc())
            .first()
        )
        
        # Get latest metrics for SNMP/SSH & DBs
        metrics = None
        if t.type.lower() in ["snmp", "ssh", "db", "mongodb", "redis"]:
            latest_metric = (
                db.query(SystemMetrics)
                .filter_by(target_id=t.id)
                .order_by(SystemMetrics.checked_at.desc())
                .first()
            )
            if latest_metric:
                metrics = latest_metric.details_json or {
                    "cpu_percent": latest_metric.cpu_percent,
                    "mem_percent": latest_metric.mem_percent,
                    "disk_percent": latest_metric.disk_percent,
                    "uptime": latest_metric.uptime
                }

        # Recent 30 heartbeats for sidebar mini bars
        recent_hbs = (
            db.query(Heartbeat)
            .filter_by(target_id=t.id)
            .order_by(Heartbeat.checked_at.desc())
            .limit(30)
            .all()
        )

        # Calculate 24h uptime %
        cutoff = dt.datetime.utcnow() - dt.timedelta(hours=24)
        hbs_24h = db.query(Heartbeat).filter(
            Heartbeat.target_id == t.id,
            Heartbeat.checked_at >= cutoff
        ).all()
        up_24h = sum(1 for h in hbs_24h if h.status == 'up')
        total_24h = len(hbs_24h) or 1
        uptime_pct = round((up_24h / total_24h) * 100, 2)

        item = t.to_dict()
        item["status"] = latest_hb.status if latest_hb else "down" if t.enabled else "off"
        item["response_time_ms"] = latest_hb.response_time_ms if latest_hb else 0.0
        item["error"] = latest_hb.error if latest_hb else None
        item["metrics"] = metrics
        item["uptime_24h"] = uptime_pct
        item["recent_heartbeats"] = [
            {"status": h.status} for h in reversed(recent_hbs)
        ]
        initial_data.append(item)
    return initial_data

async def redis_listener():
    """Background task to listen to Redis updates and broadcast them to WebSockets."""
    logger.info("Starting Redis pub/sub listener...")
    r = async_redis.from_url(REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.subscribe("snoomp_updates")
    
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = json.loads(message["data"])
                if isinstance(data, dict) and data.get("type") == "reload":
                    # Broadcast refreshed initial state to all connected clients
                    db = SessionLocal()
                    try:
                        refreshed_data = compile_initial_data(db)
                        await manager.broadcast({
                            "type": "initial_state",
                            "data": refreshed_data
                        })
                    except Exception as e:
                        logger.error(f"Error compiling refreshed state in listener: {e}")
                    finally:
                        db.close()
                else:
                    await manager.broadcast({
                        "type": "target_update",
                        "data": data
                    })
    except asyncio.CancelledError:
        logger.info("Redis listener cancelled.")
    except Exception as e:
        logger.error(f"Error in Redis listener: {e}")
    finally:
        await pubsub.unsubscribe("snoomp_updates")
        await r.close()

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
    listener_task = asyncio.create_task(redis_listener())
    
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

def get_app_version() -> str:
    try:
        vf = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "VERSION")
        if os.path.exists(vf):
            with open(vf, "r") as f:
                return f.read().strip()
    except Exception:
        pass
    return "0.2.1"

@app.get("/")
def read_root():
    return {"name": "Snoomp Monitor API", "status": "running", "version": get_app_version()}

@app.get("/api/version")
def get_version():
    return {"version": get_app_version(), "release_date": "2026-07-30", "name": "Snoomp Enterprise Observability"}

@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    # F2: Authenticate before accept — token in query string
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
    try:
        from app.auth.security import JWT_SECRET, ALGORITHM
        import jwt as pyjwt
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            await websocket.close(code=1008)
            return
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    
    # Send initial state of all monitors on connect
    db = SessionLocal()
    try:
        initial_data = compile_initial_data(db)
        await websocket.send_json({
            "type": "initial_state",
            "data": initial_data
        })
    except Exception as e:
        logger.error(f"Error compiling initial WebSocket state: {e}")
    finally:
        db.close()
        
    try:
        while True:
            # Keep connection open, handle incoming heartbeat pings if sent
            data = await websocket.receive_text()
            # Simple ping-pong to keep connection alive
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
        manager.disconnect(websocket)

