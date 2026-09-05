import json
import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models.user import User
from app.models.target import Target
from app.models.notification import Notification
from app.models.status_page import StatusPage
from app.models.setting import Setting
from app.auth.security import create_access_token, get_password_hash


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

    # Admin user
    admin = User(
        username="admin_backup_user",
        hashed_password=get_password_hash("testpass123"),
        role="admin"
    )
    # Viewer user (read only)
    viewer = User(
        username="viewer_backup_user",
        hashed_password=get_password_hash("testpass123"),
        role="viewer"
    )
    db.add(admin)
    db.add(viewer)
    db.commit()
    db.close()

    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def admin_headers():
    token = create_access_token(data={"sub": "admin_backup_user", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_headers():
    token = create_access_token(data={"sub": "viewer_backup_user", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client():
    return TestClient(app)


def test_export_backup_permissions(client, viewer_headers, admin_headers):
    # Viewers cannot export backup
    res_viewer = client.get("/api/backup/export", headers=viewer_headers)
    assert res_viewer.status_code == 403

    # Admins can export backup
    res_admin = client.get("/api/backup/export", headers=admin_headers)
    assert res_admin.status_code == 200
    assert "attachment" in res_admin.headers.get("content-disposition", "")
    data = res_admin.json()
    assert data["version"] == "1.0"
    assert "data" in data
    assert "targets" in data["data"]
    assert "notifications" in data["data"]
    assert "status_pages" in data["data"]
    assert "settings" in data["data"]


def test_backup_export_and_import_merge(client, admin_headers):
    db = TestingSessionLocal()
    try:
        # 1. Seed initial data
        t1 = Target(name="Initial Server", type="ping", host="1.1.1.1")
        n1 = Notification(name="Initial Discord", type="discord", config_json={"discordWebhookUrl": "https://discord.com/..."})
        db.add(t1)
        db.add(n1)
        db.commit()

        # 2. Export backup
        export_res = client.get("/api/backup/export", headers=admin_headers)
        assert export_res.status_code == 200
        backup_content = export_res.content

        # 3. Create a new target directly in DB to test merge preservation
        t2 = Target(name="Created Later", type="http", host="later.local")
        db.add(t2)
        db.commit()

        # 4. Modify backup JSON to add a third target
        backup_dict = json.loads(backup_content.decode("utf-8"))
        backup_dict["data"]["targets"].append({
            "id": "new-target-id-999",
            "name": "Imported Target",
            "type": "tcp",
            "host": "tcp.local",
            "port": 8080,
            "check_interval": 30,
            "enabled": True,
            "config_json": {}
        })
        modified_bytes = json.dumps(backup_dict).encode("utf-8")

        # 5. Import in merge mode
        files = {"file": ("backup.json", io.BytesIO(modified_bytes), "application/json")}
        import_res = client.post("/api/backup/import?mode=merge", files=files, headers=admin_headers)
        assert import_res.status_code == 200
        res_data = import_res.json()
        assert res_data["success"] is True
        assert res_data["mode"] == "merge"
        assert res_data["imported"]["targets"] >= 2

        # Verify "Created Later" is still in DB (not wiped)
        t2_check = db.query(Target).filter_by(name="Created Later").first()
        assert t2_check is not None

        # Verify "Imported Target" is now in DB
        t3_check = db.query(Target).filter_by(name="Imported Target").first()
        assert t3_check is not None
    finally:
        db.close()


def test_backup_import_replace(client, admin_headers):
    db = TestingSessionLocal()
    try:
        # 1. Create a clean backup containing exactly 1 target
        backup_data = {
            "version": "1.0",
            "generator": "Snoomp",
            "data": {
                "targets": [
                    {
                        "id": "single-target-id",
                        "name": "Sole Restored Target",
                        "type": "http",
                        "host": "only.local",
                        "check_interval": 60,
                        "enabled": True,
                        "config_json": {}
                    }
                ],
                "notifications": [],
                "status_pages": [],
                "settings": []
            }
        }
        file_bytes = json.dumps(backup_data).encode("utf-8")

        # 2. Import in replace mode
        files = {"file": ("backup.json", io.BytesIO(file_bytes), "application/json")}
        import_res = client.post("/api/backup/import?mode=replace", files=files, headers=admin_headers)
        assert import_res.status_code == 200

        # Verify ONLY "Sole Restored Target" exists
        all_targets = db.query(Target).all()
        assert len(all_targets) == 1
        assert all_targets[0].name == "Sole Restored Target"
    finally:
        db.close()


def test_backup_import_invalid_file(client, admin_headers):
    # Invalid JSON string
    files = {"file": ("corrupt.json", io.BytesIO(b"this is not json { ["), "application/json")}
    res = client.post("/api/backup/import", files=files, headers=admin_headers)
    assert res.status_code == 400
    assert "Invalid JSON" in res.json()["detail"]

    # Missing root 'data' key
    bad_schema = json.dumps({"wrong_key": 123}).encode("utf-8")
    files_bad = {"file": ("bad.json", io.BytesIO(bad_schema), "application/json")}
    res_bad = client.post("/api/backup/import", files=files_bad, headers=admin_headers)
    assert res_bad.status_code == 400
    assert "missing root 'data'" in res_bad.json()["detail"]
