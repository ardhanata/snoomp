# Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple `main.py` into dedicated services and websockets modules to improve testability and separate concerns.

**Architecture:** Extract pure data aggregation to `app/services/dashboard.py` and realtime infrastructure to `app/websockets.py`. Leave `main.py` strictly as the FastAPI orchestrator and lifecycle manager.

**Tech Stack:** FastAPI, WebSockets, Redis, SQLAlchemy

## Global Constraints

- Refactor must not break any existing E2E tests (`backend/tests/`).
- WebSocket endpoint must remain at `/api/ws`.

---

### Task 1: Extract Dashboard Service

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/dashboard.py`
- Create: `backend/tests/services/test_dashboard.py`
- Modify: `backend/app/main.py` (Delete `compile_initial_data`)

**Interfaces:**
- Consumes: SQLAlchemy DB session.
- Produces: `compile_initial_data(db: Session) -> list`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/services/test_dashboard.py
from app.services.dashboard import compile_initial_data
from app.models.target import Target

def test_compile_initial_data_empty(db_session):
    data = compile_initial_data(db_session)
    assert isinstance(data, list)
    assert len(data) == 0

def test_compile_initial_data_with_target(db_session):
    target = Target(name="Test", type="ping", host="127.0.0.1", enabled=True, check_interval=60)
    db_session.add(target)
    db_session.commit()
    
    data = compile_initial_data(db_session)
    assert len(data) == 1
    assert data[0]["name"] == "Test"
    assert data[0]["status"] == "down" # no heartbeats yet
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\backend\venv\Scripts\pytest backend\tests\services\test_dashboard.py -v`
Expected: FAIL with ModuleNotFoundError or ImportError because `app.services.dashboard` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/services/__init__.py` (empty).
Create `backend/app/services/dashboard.py` by copying `compile_initial_data` from `main.py` and adding necessary imports:

```python
# backend/app/services/dashboard.py
import datetime as dt
from sqlalchemy.orm import Session
from app.models.target import Target
from app.models.heartbeat import Heartbeat
from app.models.metrics import SystemMetrics

def compile_initial_data(db: Session) -> list:
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
```
Remove `compile_initial_data` from `backend/app/main.py` lines 55-113.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\backend\venv\Scripts\pytest backend\tests\services\test_dashboard.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services backend/tests/services backend/app/main.py
git commit -m "refactor: extract compile_initial_data to dashboard service"
```

---

### Task 2: Extract WebSocket Infrastructure

**Files:**
- Create: `backend/app/websockets.py`
- Modify: `backend/app/main.py` (Delete `ConnectionManager`, `redis_listener`, `websocket_endpoint`)
- Test: Existing E2E tests.

**Interfaces:**
- Consumes: `compile_initial_data` from `app.services.dashboard`, `SessionLocal` from `app.database`.
- Produces: `websockets_router`, `redis_listener` background task.

- [ ] **Step 1: Write the failing test**

We will write a basic import test to ensure router exposes the `/api/ws` endpoint.
```python
# backend/tests/routes/test_websockets.py
from app.websockets import router

def test_websocket_router_exists():
    assert any(route.path == "/api/ws" for route in router.routes)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\backend\venv\Scripts\pytest backend\tests\routes\test_websockets.py -v`
Expected: FAIL because `app.websockets` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/websockets.py`:

```python
# backend/app/websockets.py
import os
import json
import logging
import asyncio
import redis.asyncio as async_redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.database import SessionLocal
from app.services.dashboard import compile_initial_data

logger = logging.getLogger(__name__)

router = APIRouter()
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

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
                pass

manager = ConnectionManager()

async def redis_listener():
    logger.info("Starting Redis pub/sub listener...")
    r = async_redis.from_url(REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.subscribe("snoomp_updates")
    
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = json.loads(message["data"])
                if isinstance(data, dict) and data.get("type") == "reload":
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

@router.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
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
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
        manager.disconnect(websocket)
```

Remove `ConnectionManager`, `redis_listener`, `REDIS_URL`, `manager`, and `@app.websocket("/api/ws")` code blocks from `backend/app/main.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\backend\venv\Scripts\pytest backend\tests\routes\test_websockets.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/websockets.py backend/tests/routes/test_websockets.py backend/app/main.py
git commit -m "refactor: extract websocket routes and realtime logic"
```

---

### Task 3: Rewire main.py

**Files:**
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `websockets.router` and `websockets.redis_listener` from `app.websockets`.
- Produces: The fully assembled `FastAPI` application.

- [ ] **Step 1: Write the failing test**

We use the existing `test_api.py` and `test_conftest.py` which load `main.py` to ensure the app doesn't crash on boot and still works.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\backend\venv\Scripts\pytest backend\tests\test_conftest.py -v`
Expected: FAIL. Currently, `main.py` is broken because in Task 2 we removed `redis_listener` and `REDIS_URL` without updating the `lifespan` imports, so `main.py` will throw a `NameError` on import.

- [ ] **Step 3: Write minimal implementation**

Update imports and `lifespan` in `backend/app/main.py`:

```python
# In backend/app/main.py, add the import at the top:
from app import websockets

# In lifespan function, update the listener_task:
    # 4. Start Redis pub/sub background listener
    listener_task = asyncio.create_task(websockets.redis_listener())

# Under the router inclusions, include websockets router:
app.include_router(websockets.router)
```
Ensure all references to `redis_listener`, `async_redis`, `WebSocket`, `WebSocketDisconnect` are removed from the imports of `main.py` as they are no longer needed there.
Make sure `main.py` is clean and starts successfully.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\backend\venv\Scripts\pytest backend\tests\ -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "refactor: rewire main.py to use new websockets module"
```
