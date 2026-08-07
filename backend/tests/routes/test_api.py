from app.models.user import User
from app.auth.security import get_password_hash

def test_auth_and_target_lifecycle(test_client, db_session):
    # Setup user - use a unique username to avoid conflicts with default admin
    user = User(username="testadmin", hashed_password=get_password_hash("testpass"), role="admin")
    db_session.add(user)
    db_session.commit()

    # Test login
    res = test_client.post("/api/auth/login", data={"username": "testadmin", "password": "testpass"})
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
