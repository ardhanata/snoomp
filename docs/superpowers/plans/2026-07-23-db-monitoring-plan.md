# Database Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Snoomp with deep performance metrics and diagnostic logs for PostgreSQL, MongoDB, and Redis engines.

**Architecture:** Use a hybrid model where a background worker queries core metrics (Ops/Sec, connections, used memory) historically, and a REST API route streams live diagnostic logs (slow queries, engine tablespace sizes, active operations) on-demand when the monitor detail page is viewed.

**Tech Stack:** React (TypeScript, Recharts), Python (FastAPI, SQLModel, PyMongo, Redis-py).

## Global Constraints
- Do not introduce breaking database migrations. Use structured fields or flexible JSON.
- Maintain existing styles and responsive layouts.

---

### Task 1: Backend Drivers & Requirements
**Files:**
- Modify: [backend/requirements.txt](file:///d:/Project/snoomp/backend/requirements.txt)

- [ ] **Step 1: Add pymongo and redis client libraries to requirements.txt**
  Add `pymongo>=4.6.0` and `redis>=5.0.0`.
- [ ] **Step 2: Rebuild backend container to pull new dependencies**
  Run: `docker compose build backend`

---

### Task 2: Background Checker Scripts for MongoDB and Redis
**Files:**
- Create: `backend/app/checkers/mongodb.py`
- Create: `backend/app/checkers/redis_check.py`

- [ ] **Step 1: Implement MongoDB checker**
  Create `backend/app/checkers/mongodb.py` to parse MongoDB URIs, run the ping, retrieve client count, ops counters, and resident memory size, returning them as metrics dictionary.
- [ ] **Step 2: Implement Redis checker**
  Create `backend/app/checkers/redis_check.py` to parse Redis URIs, query `INFO`, retrieve connected clients, ops per second, and memory usage.

---

### Task 3: API Route for Live Engine Diagnostics
**Files:**
- Modify: [backend/app/routes/dashboard.py](file:///d:/Project/snoomp/backend/app/routes/dashboard.py)

- [ ] **Step 1: Implement live query endpoint `/api/targets/{target_id}/db-engine-status`**
  Add API path that executes live status checks based on the target type:
  - **PostgreSQL**: Queries `pg_stat_activity` for active/slow queries and tablespace storage info.
  - **MongoDB**: Runs `currentOp` command and storage stats.
  - **Redis**: Fetches slowlog logs (`SLOWLOG GET 15`) and keyspace stats.

---

### Task 4: Frontend UI Extensions (Modal & Form Details)
**Files:**
- Modify: [frontend/src/components/MonitorModal.tsx](file:///d:/Project/snoomp/frontend/src/components/MonitorModal.tsx)
- Modify: [frontend/src/App.tsx](file:///d:/Project/snoomp/frontend/src/App.tsx)

- [ ] **Step 1: Expose MongoDB and Redis options in Monitor Modal**
  Support dynamic connection string URI inputs for MongoDB and Redis, hiding hostname/port fields.
- [ ] **Step 2: Add multi-series chart and Live Engine Status tab system**
  Update monitor details panel in `App.tsx` to render Ops/Sec, Connections, and memory graphs side-by-side, plus dynamic Storage/Process/Slowlog tabs.
