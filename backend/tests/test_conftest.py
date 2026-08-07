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
    from sqlalchemy import text
    assert db_session.execute(text("SELECT 1")).fetchone()[0] == 1
