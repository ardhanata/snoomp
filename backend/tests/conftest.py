import pytest
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
import redis
import os

os.environ["JWT_SECRET"] = "test_secret_for_e2e_tests_123"

from app.database import Base, get_db
# app.main is imported inside test_client to allow setting env vars first

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
def test_client(db_session, redis_container):
    os.environ["REDIS_URL"] = f"redis://{redis_container.get_container_host_ip()}:{redis_container.get_exposed_port(6379)}/0"
    from app.main import app
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
