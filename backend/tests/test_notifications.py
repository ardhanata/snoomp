import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models.user import User
from app.models.target import Target
from app.models.notification import Notification
from app.auth.security import create_access_token, get_password_hash
from worker.tasks import trigger_alerts

from sqlalchemy.pool import StaticPool

# In-memory SQLite for unit tests with StaticPool
TEST_DB_URL = "sqlite:///:memory:"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    # Seed admin user
    admin = User(
        username="admin_user",
        hashed_password=get_password_hash("testpass123"),
        role="admin"
    )
    db.add(admin)
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def admin_headers():
    token = create_access_token(data={"sub": "admin_user", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def client():
    return TestClient(app)

def test_notification_crud_and_apply_existing(client, admin_headers):
    # 1. Create a target first to test apply_existing
    target_resp = client.post("/api/targets", json={
        "name": "Production API",
        "type": "http",
        "host": "api.example.com",
        "check_interval": 60,
        "config_json": {}
    }, headers=admin_headers)
    assert target_resp.status_code == 200
    target_id = target_resp.json()["id"]

    # 2. List notifications (should be empty initially)
    resp = client.get("/api/notifications", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []

    # 3. Create a Discord notification with apply_existing=True
    create_resp = client.post("/api/notifications", json={
        "name": "Ops Discord",
        "type": "discord",
        "config": {
            "discordWebhookUrl": "https://discord.com/api/webhooks/123/abc",
            "discordUsername": "SnoompBot"
        },
        "is_default": True,
        "active": True,
        "apply_existing": True
    }, headers=admin_headers)
    assert create_resp.status_code == 201
    notif_data = create_resp.json()
    notif_id = notif_data["id"]
    assert notif_data["name"] == "Ops Discord"
    assert notif_data["is_default"] is True

    # Check that target received this notification via apply_existing
    target_check = client.get(f"/api/targets/{target_id}", headers=admin_headers)
    assert target_check.status_code == 200
    assert notif_id in target_check.json()["config_json"].get("notification_ids", [])

    # 4. Create a new target - should automatically get the default notification!
    new_target_resp = client.post("/api/targets", json={
        "name": "Database Cluster",
        "type": "ping",
        "host": "db.example.com",
        "check_interval": 30,
        "config_json": {}
    }, headers=admin_headers)
    assert new_target_resp.status_code == 200
    assert notif_id in new_target_resp.json()["config_json"].get("notification_ids", [])

    # 5. Update notification
    update_resp = client.put(f"/api/notifications/{notif_id}", json={
        "name": "DevOps Discord Channel",
        "is_default": False
    }, headers=admin_headers)
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "DevOps Discord Channel"
    assert update_resp.json()["is_default"] is False

    # 6. Delete notification
    del_resp = client.delete(f"/api/notifications/{notif_id}", headers=admin_headers)
    assert del_resp.status_code == 204

    # Verify target no longer has deleted notification ID
    target_after = client.get(f"/api/targets/{target_id}", headers=admin_headers)
    assert notif_id not in target_after.json()["config_json"].get("notification_ids", [])

@patch("app.services.notification_service.dispatch_notification")
def test_notification_test_endpoint(mock_dispatch, client, admin_headers):
    mock_dispatch.return_value = True

    resp = client.post("/api/notifications/test", json={
        "name": "My Telegram",
        "type": "telegram",
        "config": {
            "telegramBotToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
            "telegramChatID": "987654321"
        }
    }, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert mock_dispatch.called

@patch("app.services.notification_service.dispatch_notification")
def test_trigger_alerts_dispatch(mock_dispatch):
    mock_dispatch.return_value = True
    db = TestingSessionLocal()
    try:
        # Create a notification
        notif = Notification(
            name="Slack Alerts",
            type="slack",
            is_default=True,
            active=True,
            config_json={"slackwebhookURL": "https://hooks.slack.com/services/..."}
        )
        db.add(notif)
        db.flush()

        target = Target(
            name="Web Frontend",
            type="http",
            host="frontend.local",
            config_json={"notification_ids": [notif.id]}
        )
        db.add(target)
        db.commit()

        trigger_alerts(
            target=target,
            prev_status="up",
            new_status="down",
            response_time_ms=1200.5,
            error="Connection refused",
            duration_s=None,
            db=db
        )

        assert mock_dispatch.called
        call_args = mock_dispatch.call_args
        assert call_args[0][0] == "slack"
        assert "🔴 [DOWN]" in call_args[0][2]
    finally:
        db.close()
