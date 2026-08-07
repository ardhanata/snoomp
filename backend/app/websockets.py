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
