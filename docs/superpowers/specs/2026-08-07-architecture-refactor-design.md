# Architecture Refactor: Decoupling main.py

## Overview
The `main.py` file currently acts as a "God object" for the backend, intertwining API routing, application lifecycle management, WebSocket connection handling, background Redis listeners, and database query logic (`compile_initial_data`). This spec outlines the plan to decouple these responsibilities into distinct, testable modules.

## Goals
- Isolate stateful realtime infrastructure (WebSockets, Redis pub/sub) from stateless HTTP routes.
- Isolate business logic and heavy database queries into dedicated service modules.
- Slim down `main.py` so it serves purely as the FastAPI entrypoint and orchestrator.

## Proposed Architecture

### 1. `app/services/dashboard.py` (Data Aggregation)
- Extract the `compile_initial_data(db)` function from `main.py`.
- This function queries `Target`, `Heartbeat`, and `SystemMetrics` tables to compute uptime and latest statuses.
- Placing this in `services/dashboard.py` allows it to be tested in isolation and reused by both HTTP routes and WebSocket handlers if necessary.

### 2. `app/websockets.py` (Realtime Infrastructure)
- Create a new FastAPI router specifically for WebSockets.
- Move the `ConnectionManager` class here.
- Move the `redis_listener()` background task here.
- Move the `/api/ws` endpoint here.
- The `redis_listener` will import `compile_initial_data` from `app.services.dashboard` when it needs to push initial states upon receiving a `reload` event.

### 3. `app/main.py` (Slimmed Entrypoint)
- Retain the `FastAPI` instance declaration and `CORSMiddleware`.
- Retain the `lifespan` context manager, which handles:
  - Database initialization (`_init_db_with_retry`)
  - Admin user seeding
  - APScheduler lifecycle
- The `lifespan` manager will still spin up the `redis_listener` as a background task, but the function itself will live in `app/websockets.py`.
- Include the new WebSocket router: `app.include_router(websockets.router)`.

## Tradeoffs and Decisions
- **Lifespan Placement:** We decided to keep the `lifespan` logic within `main.py` rather than extracting it to an `app/core/setup.py` module. This is because FastAPI naturally binds the `lifespan` to the `app` instance, and moving it out would only save ~40 lines while obscuring the app's startup sequence.
- **WebSocket State:** The `ConnectionManager` state remains in-memory on the backend process. Since Snoomp is currently designed for single-process deployments (or single backend containers), this is acceptable. The Redis pub/sub mechanism already exists to handle events coming from the Celery workers.

## Testing Strategy
- The refactor must not break any existing tests.
- E2E tests for the frontend or APIs should still pass, as the HTTP routes and WebSocket endpoints will remain at the exact same URLs (`/api/...` and `/api/ws`).
