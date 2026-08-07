# Snoomp E2E Testing Framework Design

## Overview
This document outlines Phase 1 of the Snoomp pre-launch hardening: implementing a robust End-to-End (E2E) testing framework. The core backend models (`Target`, `User`) and complex stateful checkers (`check_ssh`, DB checkers) currently lack test coverage. This framework ensures system reliability by testing against real, ephemeral containerized infrastructure rather than heavily mocked services.

## Architecture & Infrastructure

- **Test Runner:** `pytest` and `pytest-asyncio` for executing synchronous and asynchronous tests.
- **Infrastructure Provisioning:** `testcontainers-python` will programmatically spin up ephemeral Docker containers during the test run.
  - **Redis Container:** Required to test the metric caching logic in `check_ssh` and pub/sub signaling.
  - **Database Container:** Spin up an ephemeral database (matching production schema) for isolated SQLAlchemy model testing.
- **API Client:** `httpx.AsyncClient` or FastAPI's built-in `TestClient` for executing end-to-end route tests connected to the test database.

## Test Suite Structure

The `backend/tests/` directory will be structured as follows:

### 1. `conftest.py`
The core of the E2E setup. It will contain pytest fixtures with `session` scope to:
- Spin up the Redis TestContainer.
- Spin up the Database TestContainer.
- Apply SQLAlchemy database migrations/schemas to the ephemeral DB.
- Yield a configured FastAPI `TestClient` hooked up to these test containers.
- Tear down all containers gracefully after the test session ends.

### 2. `tests/models/`
- **`test_target.py`**: Validate the `Target` model's constraints, `config_json` redaction logic, and CRUD behavior against the real DB.
- **`test_user.py`**: Validate the `User` model, role constraints, and password hashing.

### 3. `tests/routes/`
- **`test_auth.py`**: E2E tests for `/api/auth/login` (including rate-limiting logic) and JWT generation.
- **`test_targets.py`**: E2E tests for `/api/targets` endpoints, testing authorization roles (`editor` vs `viewer`) and the DB outcomes.

### 4. `tests/checkers/`
- **`test_ssh.py`**: Validate `check_ssh` metric parsing and ensure that stateful CPU delta logic correctly persists and reads from the ephemeral Redis container.
- **`test_db_checkers.py`**: Test connectivity logic and fallback handling.

## Execution Flow

1. Developer runs `pytest` in the `backend/` directory.
2. `conftest.py` intercepts the run, launching Docker containers via `testcontainers`.
3. Tests execute against these real instances (highest confidence).
4. Upon completion, `testcontainers` automatically destroys the ephemeral containers, leaving no state behind.

## Open Questions / Scope Limits
- **Container Overheads:** E2E tests with TestContainers will take longer to run than pure unit tests. We will mitigate this by scoping the containers to the `session` level rather than spinning up a new container per test.
- **Mocking Extraneous Networks:** We will still mock the actual outgoing network calls (like attempting to SSH into an external IP) via `unittest.mock`, but we will **not** mock the Redis or Database interactions.
