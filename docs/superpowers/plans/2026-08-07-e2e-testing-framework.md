# E2E Testing Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a robust E2E testing framework using `pytest` and `testcontainers` for the backend models, routes, and checkers.

**Architecture:** We will set up a global `conftest.py` that provisions ephemeral Redis and PostgreSQL containers scoped to the test session. These containers will be injected into the FastAPI app state and SQLAlchemy DB sessions.

**Tech Stack:** `pytest`, `pytest-asyncio`, `testcontainers`, `httpx`

## Global Constraints

- Tests must not rely on pre-existing host infrastructure (except Docker daemon).
- The `config_json` redaction and model interactions must hit a real database.
- Caching tests must hit a real Redis instance.

---

### Task 1: Setup Dependencies

**Files:**
- Modify: `backend/requirements-test.txt`

**Interfaces:**
- Produces: Installed testing dependencies.

- [ ] **Step 1: Write the failing test**

```python
# test_imports.py
def test_dependencies():
    import testcontainers
    import pytest_asyncio
    import httpx
    assert True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest test_imports.py`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Write minimal implementation**

```text
# backend/requirements-test.txt
pytest==8.2.2
pytest-asyncio==0.23.7
testcontainers==4.5.1
httpx==0.27.0
```
Install them: `pip install -r backend/requirements-test.txt`

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest test_imports.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/requirements-test.txt
git commit -m "chore: add testing dependencies"
```

---

### Task 2: Setup conftest.py

**Files:**
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Produces: `db_session`, `redis_client`, and `test_client` fixtures.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_conftest.py
import pytest
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
import redis

def test_fixtures_available(db_session, test_client, redis_client):
    assert isinstance(db_session, Session)
    assert isinstance(test_client, TestClient)
    assert isinstance(redis_client, redis.Redis)
    # Ensure they are active
    redis_client.ping()
    assert db_session.execute("SELECT 1").fetchone()[0] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_conftest.py`
Expected: FAIL (fixture not found)

- [ ] **Step 3: Write minimal implementation**

```python
# backend/tests/conftest.py
import pytest
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
import redis

from app.database import Base, get_db
from app.main import app

@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:15-alpine") as postgres:
        yield postgres

@pytest.fixture(scope="session")
def redis_container():
    with RedisContainer("redis:7-alpine") as redis_server:
        yield redis_server

@pytest.fixture(scope="session")
def db_engine(postgres_container):
    engine = create_engine(postgres_container.get_connection_url())
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def db_session(db_engine):
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(scope="session")
def redis_client(redis_container):
    r = redis.Redis(host=redis_container.get_container_host_ip(), port=redis_container.get_exposed_port(6379))
    yield r

@pytest.fixture(scope="function")
def test_client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_conftest.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_conftest.py
git commit -m "test: add testcontainers and fixtures to conftest"
```

---

### Task 3: Test Target Model

**Files:**
- Create: `backend/tests/models/test_target.py`

**Interfaces:**
- Consumes: `db_session` fixture

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/models/test_target.py
from app.models.target import Target

def test_target_creation_and_redaction(db_session):
    target = Target(
        name="Test API",
        type="http",
        host="https://api.test.com",
        config_json={"password": "secret_password", "custom": "value"}
    )
    db_session.add(target)
    db_session.commit()

    saved = db_session.query(Target).first()
    assert saved.name == "Test API"
    
    dict_repr = saved.to_dict()
    assert dict_repr["config_json"]["password"] == "••••••••"
    assert dict_repr["config_json"]["custom"] == "value"
    
    assert saved.config_json_raw()["password"] == "secret_password"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pytest backend/tests/models/test_target.py`
Expected: PASS immediately because the model logic is already implemented. The test itself acts as the implementation constraint.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/models/test_target.py
git commit -m "test: add target model db constraints test"
```

---

### Task 4: Test User Model

**Files:**
- Create: `backend/tests/models/test_user.py`

**Interfaces:**
- Consumes: `db_session` fixture

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/models/test_user.py
from app.models.user import User
from app.auth.security import get_password_hash, verify_password

def test_user_creation_and_auth(db_session):
    user = User(
        username="admin",
        hashed_password=get_password_hash("password123"),
        role="admin"
    )
    db_session.add(user)
    db_session.commit()

    saved = db_session.query(User).first()
    assert saved.username == "admin"
    assert saved.is_active is True
    assert verify_password("password123", saved.hashed_password) is True
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pytest backend/tests/models/test_user.py`
Expected: PASS immediately (as logic exists).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/models/test_user.py
git commit -m "test: add user model auth test"
```

---

### Task 5: Test API Routes (Auth & Targets)

**Files:**
- Create: `backend/tests/routes/test_api.py`

**Interfaces:**
- Consumes: `test_client`, `db_session` fixtures

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/routes/test_api.py
from app.models.user import User
from app.auth.security import get_password_hash

def test_auth_and_target_lifecycle(test_client, db_session):
    # Setup user
    user = User(username="admin", hashed_password=get_password_hash("testpass"), role="admin")
    db_session.add(user)
    db_session.commit()

    # Test login
    res = test_client.post("/api/auth/login", data={"username": "admin", "password": "testpass"})
    assert res.status_code == 200
    token = res.json()["access_token"]

    # Test create target
    headers = {"Authorization": f"Bearer {token}"}
    target_data = {
        "name": "E2E Target",
        "type": "http",
        "host": "test.com",
        "check_interval": 60,
        "enabled": True,
        "tags": [],
        "config_json": {}
    }
    res = test_client.post("/api/targets", json=target_data, headers=headers)
    assert res.status_code == 200
    target_id = res.json()["id"]

    # Test fetch target
    res = test_client.get(f"/api/targets/{target_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "E2E Target"
```

- [ ] **Step 2: Run test to verify it passes**
Run: `pytest backend/tests/routes/test_api.py`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/routes/test_api.py
git commit -m "test: add e2e route tests for auth and targets"
```
