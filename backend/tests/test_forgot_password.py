import os
import datetime
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.services.email_service import send_password_reset_email
from app.models.user import User
from app.auth.security import get_password_hash, verify_password, create_access_token
from app.database import get_db
from app.main import app


def test_email_service_no_smtp():
    with patch.dict(os.environ, {"SMTP_HOST": ""}):
        result = send_password_reset_email("user@example.com", "http://localhost:8008/reset-password?token=abc")
        assert result is False


def test_email_service_with_smtp():
    mock_smtp_instance = MagicMock()
    with patch.dict(os.environ, {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "testuser",
        "SMTP_PASSWORD": "secretpassword",
        "SMTP_FROM": "alerts@snoomp.local",
        "SMTP_TLS": "true"
    }):
        with patch("smtplib.SMTP") as mock_smtp_class:
            mock_smtp_class.return_value.__enter__.return_value = mock_smtp_instance
            result = send_password_reset_email("target@example.com", "http://localhost:8008/reset-password?token=xyz123")
            assert result is True
            mock_smtp_class.assert_called_once_with("smtp.example.com", 587, timeout=10)
            mock_smtp_instance.starttls.assert_called_once()
            mock_smtp_instance.login.assert_called_once_with("testuser", "secretpassword")
            mock_smtp_instance.send_message.assert_called_once()
            sent_msg = mock_smtp_instance.send_message.call_args[0][0]
            assert sent_msg["To"] == "target@example.com"
            assert sent_msg["From"] == "alerts@snoomp.local"
            assert "Reset Password" in sent_msg["Subject"]


def test_user_model_reset_fields():
    user = User(
        username="operator1",
        email="operator1@example.com",
        hashed_password=get_password_hash("pass1234"),
        role="editor",
        reset_token="sample_token_32_chars_long_xyz",
        reset_token_expires=datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    )
    user_dict = user.to_dict()
    assert user_dict["username"] == "operator1"
    assert user_dict["email"] == "operator1@example.com"
    assert user.reset_token == "sample_token_32_chars_long_xyz"
    assert verify_password("pass1234", user.hashed_password) is True


def test_forgot_password_endpoint_flow():
    test_user = User(
        id=1,
        username="admin_user",
        email="admin@example.com",
        hashed_password=get_password_hash("oldpassword123"),
        role="admin",
        is_active=True
    )

    mock_db = MagicMock()
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value.first.return_value = test_user

    app.dependency_overrides[get_db] = lambda: mock_db
    client = TestClient(app)

    try:
        # 1. Request forgot password for existing user with email
        with patch("app.routes.auth.send_password_reset_email", return_value=True) as mock_send:
            res = client.post("/api/auth/forgot-password", json={"identifier": "admin@example.com"})
            assert res.status_code == 200
            assert "tautan reset password" in res.json()["message"]
            assert mock_send.called
            assert test_user.reset_token is not None
            assert test_user.reset_token_expires > datetime.datetime.utcnow()

        # 2. Verify reset token
        res_verify = client.get(f"/api/auth/verify-reset-token?token={test_user.reset_token}")
        assert res_verify.status_code == 200
        assert res_verify.json()["valid"] is True
        assert res_verify.json()["username"] == "admin_user"

        # 3. Reset password with new valid password
        res_reset = client.post("/api/auth/reset-password", json={
            "token": test_user.reset_token,
            "new_password": "brandnewpassword456"
        })
        assert res_reset.status_code == 200
        assert "Password berhasil diperbarui" in res_reset.json()["message"]
        assert test_user.reset_token is None
        assert verify_password("brandnewpassword456", test_user.hashed_password) is True

        # 4. Unknown user returns same generic message (prevent enumeration)
        mock_query.filter.return_value.first.return_value = None
        res_unknown = client.post("/api/auth/forgot-password", json={"identifier": "nonexistent@example.com"})
        assert res_unknown.status_code == 200
        assert "tautan reset password" in res_unknown.json()["message"]
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_update_user_email_endpoint():
    user = User(
        id=2,
        username="editor_user",
        email=None,
        hashed_password=get_password_hash("password123"),
        role="editor",
        is_active=True
    )

    mock_db = MagicMock()
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    # Return user for current user query and None for duplicate email check
    mock_query.filter.return_value.first.side_effect = [user, None]

    app.dependency_overrides[get_db] = lambda: mock_db
    client = TestClient(app)

    token = create_access_token(data={"sub": "editor_user"})
    headers = {"Authorization": f"Bearer {token}"}

    try:
        res = client.put("/api/auth/me", json={"email": "new_email@company.com"}, headers=headers)
        assert res.status_code == 200
        assert user.email == "new_email@company.com"
    finally:
        app.dependency_overrides.pop(get_db, None)
