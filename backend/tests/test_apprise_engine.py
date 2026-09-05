import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import apprise

from app.main import app
from app.database import Base, get_db
from app.models.user import User
from app.models.target import Target
from app.models.notification import Notification
from app.auth.security import create_access_token, get_password_hash
from app.services.notification_service import (
    map_status_to_notify_type,
    build_apprise_uri,
    validate_apprise_uris,
    get_apprise_service_catalog,
    send_apprise_notification,
    dispatch_notification,
)
from worker.tasks import trigger_alerts


# In-memory SQLite for tests
TEST_DB_URL = "sqlite:///:memory:"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    admin = User(
        username="admin_apprise_user",
        hashed_password=get_password_hash("testpass123"),
        role="admin"
    )
    db.add(admin)
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def admin_headers():
    token = create_access_token(data={"sub": "admin_apprise_user", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client():
    return TestClient(app)


def test_map_status_to_notify_type():
    assert map_status_to_notify_type("up") == apprise.NotifyType.SUCCESS
    assert map_status_to_notify_type("RECOVERED") == apprise.NotifyType.SUCCESS
    assert map_status_to_notify_type("down") == apprise.NotifyType.FAILURE
    assert map_status_to_notify_type("critical") == apprise.NotifyType.FAILURE
    assert map_status_to_notify_type("warning") == apprise.NotifyType.WARNING
    assert map_status_to_notify_type("degraded") == apprise.NotifyType.WARNING
    assert map_status_to_notify_type("info") == apprise.NotifyType.INFO
    assert map_status_to_notify_type("unknown") == apprise.NotifyType.INFO


def test_build_apprise_uri_all_providers():
    # Apprise raw
    assert build_apprise_uri("apprise", {"appriseURL": "tgram://123:abc/456"}) == "tgram://123:abc/456"

    # Telegram
    assert build_apprise_uri("telegram", {"telegramBotToken": "123:abc", "telegramChatID": "456"}) == "tgram://123:abc/456"

    # Discord
    assert build_apprise_uri("discord", {"discordWebhookUrl": "https://discord.com/api/webhooks/123/abc"}) == "https://discord.com/api/webhooks/123/abc"

    # Slack
    assert build_apprise_uri("slack", {"slackwebhookURL": "https://hooks.slack.com/services/1/2/3"}) == "https://hooks.slack.com/services/1/2/3"

    # Teams
    assert build_apprise_uri("teams", {"teamsWebhookURL": "workflows://prod.westus.logic.azure.com/123/sig"}) == "workflows://prod.westus.logic.azure.com/123/sig"

    # SMTP / Email
    email_uri = build_apprise_uri("smtp", {
        "smtpHost": "smtp.example.com",
        "smtpPort": 587,
        "smtpUsername": "user",
        "smtpPassword": "password",
        "smtpTo": "alert@example.com",
        "smtpFrom": "noreply@example.com",
        "smtpSecure": False
    })
    assert "mailto://user:password@smtp.example.com:587?to=alert@example.com&from=noreply@example.com" in email_uri

    # Pushover
    assert build_apprise_uri("pushover", {"pushoveruserkey": "ukey", "pushoverapptoken": "atoken"}) == "pover://ukey@atoken"

    # Gotify
    assert build_apprise_uri("gotify", {"gotifyserverurl": "https://push.example.com", "gotifyapplicationToken": "tok"}) == "gotifys://push.example.com/tok"

    # Ntfy
    assert build_apprise_uri("ntfy", {"ntfyserverurl": "https://ntfy.sh", "ntfytopic": "snoomp_alerts"}) == "ntfys://ntfy.sh/snoomp_alerts"

    # PagerDuty
    assert build_apprise_uri("pagerduty", {"pagerdutyApiKey": "apikey", "pagerdutyRoutingKey": "route123"}) == "pagerduty://apikey@route123"

    # Opsgenie
    assert build_apprise_uri("opsgenie", {"opsgenieApiKey": "geniekey", "opsgenieRegion": "eu"}) == "opsgenie://geniekey?region=eu"

    # Twilio
    assert build_apprise_uri("twilio", {
        "twilioAccountSid": "AC123",
        "twilioAuthToken": "auth456",
        "twilioFromPhone": "+15551234567",
        "twilioToPhone": "+15559876543"
    }) == "twilio://AC123:auth456@+15551234567/+15559876543"


def test_validate_apprise_uris():
    # Valid URIs
    res_valid = validate_apprise_uris("tgram://123456:abcdefghijklmnopqrstuvwxyz/987654321")
    assert res_valid["valid"] is True
    assert res_valid["count"] == 1
    assert "tgram" in res_valid["schemas"]

    # Multiple valid URIs separated by newline
    res_multi = validate_apprise_uris("tgram://123456:abcdefghijklmnopqrstuvwxyz/987654321\ndiscord://123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789")
    assert res_multi["valid"] is True
    assert res_multi["count"] == 2

    # Invalid URIs
    res_invalid = validate_apprise_uris("notrealprotocol://nothing_here")
    assert res_invalid["valid"] is False

    # Empty URIs
    res_empty = validate_apprise_uris("")
    assert res_empty["valid"] is False


def test_get_apprise_service_catalog():
    catalog = get_apprise_service_catalog()
    assert isinstance(catalog, list)
    assert len(catalog) >= 100  # Apprise supports 140+ services

    service_names = [s["service_name"].lower() for s in catalog]
    # Check top services exist in catalog
    assert any("discord" in name for name in service_names)
    assert any("telegram" in name for name in service_names)
    assert any("slack" in name for name in service_names)


@patch("apprise.Apprise.notify")
def test_send_apprise_notification(mock_notify):
    mock_notify.return_value = True

    success = send_apprise_notification(
        uris="tgram://123456:abcdefghijklmnopqrstuvwxyz/987654321",
        title="⚠️ Alert: Production Server",
        body="CPU is above 90%",
        status="down"
    )

    assert success is True
    assert mock_notify.called
    kwargs = mock_notify.call_args[1]
    assert kwargs["notify_type"] == apprise.NotifyType.FAILURE
    assert kwargs["body_format"] == apprise.NotifyFormat.MARKDOWN
    assert kwargs["title"] == "⚠️ Alert: Production Server"


def test_api_apprise_services_and_validate(client, admin_headers):
    # 1. Test services endpoint
    resp_services = client.get("/api/notifications/apprise/services", headers=admin_headers)
    assert resp_services.status_code == 200
    services = resp_services.json()
    assert len(services) >= 100

    # 2. Test validate endpoint with valid URI
    resp_valid = client.post("/api/notifications/apprise/validate", json={
        "uris": "tgram://123456:abcdefghijklmnopqrstuvwxyz/987654321"
    }, headers=admin_headers)
    assert resp_valid.status_code == 200
    assert resp_valid.json()["valid"] is True
    assert "tgram" in resp_valid.json()["schemas"]

    # 3. Test validate endpoint with invalid URI
    resp_invalid = client.post("/api/notifications/apprise/validate", json={
        "uris": "nonsense_schema://foobar"
    }, headers=admin_headers)
    assert resp_invalid.status_code == 200
    assert resp_invalid.json()["valid"] is False


@patch("app.services.notification_service.send_apprise_notification")
def test_trigger_alerts_per_target_apprise_uri(mock_send_apprise):
    mock_send_apprise.return_value = True
    db = TestingSessionLocal()
    try:
        target = Target(
            name="API Gateway",
            type="http",
            host="gateway.internal",
            config_json={
                "notifications": [
                    {"apprise_uri": "tgram://123456:abcdef/987654321"}
                ]
            }
        )
        db.add(target)
        db.commit()

        # Should execute cleanly without NameError: name 'send_notification' is not defined
        trigger_alerts(
            target=target,
            prev_status="up",
            new_status="down",
            response_time_ms=500.0,
            error="502 Bad Gateway",
            duration_s=12.0,
            db=db
        )

        assert mock_send_apprise.called
        call_args = mock_send_apprise.call_args
        assert "tgram://123456:abcdef/987654321" in call_args[0][0]
        assert "🔴 [DOWN] API Gateway" in call_args[0][1]
        assert call_args[1]["status"] == "down"
    finally:
        db.close()
