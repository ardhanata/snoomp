import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models.user import User
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
    user = User(
        username="admin_hcp",
        email="hcp@example.com",
        hashed_password=get_password_hash("hcppass123"),
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def auth_headers():
    token = create_access_token({"sub": "admin_hcp", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


MOCK_HCP_RESULT = {
    "status": "ok",
    "response_time_ms": 32.5,
    "tenant": {
        "name": "finance",
        "description": "Finance Tenant",
        "hard_quota_raw": "10 TB",
        "hard_quota_bytes": 10 * (1024**4),
        "hard_quota_formatted": "10.00 TB",
        "soft_quota_pct": 80.0,
        "storage_used_bytes": 2 * (1024**4),
        "storage_used_formatted": "2.00 TB",
        "storage_free_bytes": 8 * (1024**4),
        "storage_free_formatted": "8.00 TB",
        "used_percent": 20.0,
        "ingested_volume_bytes": 2 * (1024**4),
        "ingested_volume_formatted": "2.00 TB",
        "object_count": 15000,
        "custom_metadata_count": 50,
        "custom_metadata_size": 2048,
        "shred_count": 0,
        "shred_size": 0,
        "status": "ok",
    },
    "namespaces_summary": {
        "total_count": 2,
        "warning_count": 0,
        "critical_count": 0,
        "healthy_count": 2,
    },
    "namespaces": [
        {
            "name": "invoices",
            "hard_quota_raw": "5 TB",
            "hard_quota_bytes": 5 * (1024**4),
            "hard_quota_formatted": "5.00 TB",
            "soft_quota_pct": 80.0,
            "storage_used_bytes": 1 * (1024**4),
            "storage_used_formatted": "1.00 TB",
            "used_percent": 20.0,
            "object_count": 10000,
            "status": "ok",
        },
        {
            "name": "receipts",
            "hard_quota_raw": "5 TB",
            "hard_quota_bytes": 5 * (1024**4),
            "hard_quota_formatted": "5.00 TB",
            "soft_quota_pct": 80.0,
            "storage_used_bytes": 1 * (1024**4),
            "storage_used_formatted": "1.00 TB",
            "used_percent": 20.0,
            "object_count": 5000,
            "status": "ok",
        },
    ],
}


def test_hcp_tenant_lifecycle(client, auth_headers):
    # 1. Test connection endpoint with mock
    with patch("app.routes.hcp.query_hcp_tenant_mapi", new_callable=AsyncMock) as mock_query:
        mock_query.return_value = MOCK_HCP_RESULT

        test_res = client.post(
            "/api/hcp/test",
            json={
                "host": "admin.hcp.corp.local",
                "port": 9090,
                "tenant_name": "finance",
                "username": "snoomp-monitor",
                "password": "secretpassword",
                "ignore_tls": True,
            },
            headers=auth_headers,
        )
        assert test_res.status_code == 200
        data = test_res.json()
        assert data["status"] == "ok"
        assert "2 namespaces found" in data["message"]

        # 2. Create HCP tenant
        create_res = client.post(
            "/api/hcp/tenants",
            json={
                "name": "Finance S3 Storage",
                "host": "admin.hcp.corp.local",
                "port": 9090,
                "tenant_name": "finance",
                "username": "snoomp-monitor",
                "password": "secretpassword",
                "ignore_tls": True,
                "site": "dc",
                "enabled": True,
                "check_interval": 300,
            },
            headers=auth_headers,
        )
        assert create_res.status_code == 200
        tenant = create_res.json()
        tenant_id = tenant["id"]
        assert tenant["name"] == "Finance S3 Storage"
        assert tenant["password"] == "••••••••"  # Password is redacted
        assert tenant["last_status"] == "ok"
        assert len(tenant["metrics"]["namespaces"]) == 2

        # 3. List HCP tenants
        list_res = client.get("/api/hcp/tenants", headers=auth_headers)
        assert list_res.status_code == 200
        tenants = list_res.json()
        assert any(t["id"] == tenant_id for t in tenants)

        # 4. Update HCP tenant
        update_res = client.put(
            f"/api/hcp/tenants/{tenant_id}",
            json={
                "name": "Finance S3 Storage (Updated)",
                "host": "admin.hcp.corp.local",
                "port": 9090,
                "tenant_name": "finance",
                "username": "snoomp-monitor",
                "password": "••••••••",  # Preserves existing password
                "ignore_tls": True,
                "site": "drc",
                "enabled": True,
                "check_interval": 600,
            },
            headers=auth_headers,
        )
        assert update_res.status_code == 200
        updated = update_res.json()
        assert updated["name"] == "Finance S3 Storage (Updated)"
        assert updated["site"] == "drc"

        # 5. Manual Sync HCP tenant
        sync_res = client.post(f"/api/hcp/tenants/{tenant_id}/sync", headers=auth_headers)
        assert sync_res.status_code == 200
        synced = sync_res.json()
        assert synced["last_status"] == "ok"

        # 6. Delete HCP tenant
        del_res = client.delete(f"/api/hcp/tenants/{tenant_id}", headers=auth_headers)
        assert del_res.status_code == 204

        # Verify deletion
        get_res = client.get(f"/api/hcp/tenants/{tenant_id}", headers=auth_headers)
        assert get_res.status_code == 404


def test_hcp_cluster_lifecycle(client, auth_headers):
    mock_cluster_res = {
        "status": "ok",
        "response_time_ms": 45.0,
        "is_cluster": True,
        "cluster": {
            "total_tenants": 2,
            "total_namespaces": 2,
            "storage_used_bytes": 2 * (1024**4),
            "storage_used_formatted": "2.00 TB",
            "hard_quota_bytes": 10 * (1024**4),
            "hard_quota_formatted": "10.00 TB",
            "used_percent": 20.0,
            "object_count": 15000,
            "status": "ok",
        },
        "tenants": [{"name": "finance"}, {"name": "marketing"}],
        "namespaces_summary": {"total_count": 2, "warning_count": 0, "critical_count": 0, "healthy_count": 2},
        "namespaces": [
            {"name": "invoices", "tenant_name": "finance", "storage_used_bytes": 1024**4, "status": "ok"},
            {"name": "assets", "tenant_name": "marketing", "storage_used_bytes": 1024**4, "status": "ok"},
        ],
    }

    with patch("app.routes.hcp.list_hcp_tenants", new_callable=AsyncMock) as mock_list, \
         patch("app.routes.hcp.query_hcp_cluster_mapi", new_callable=AsyncMock) as mock_cluster:

        mock_list.return_value = ["finance", "marketing"]
        mock_cluster.return_value = mock_cluster_res

        # Test cluster test connection
        test_res = client.post(
            "/api/hcp/test",
            json={
                "host": "admin.hcp.corp.local",
                "port": 9090,
                "is_cluster": True,
                "tenant_name": "*",
                "username": "sysadmin",
                "password": "secretclusterpassword",
                "ignore_tls": True,
            },
            headers=auth_headers,
        )
        assert test_res.status_code == 200
        test_data = test_res.json()
        assert test_data["status"] == "ok"
        assert "Discovered 2 active tenant(s)" in test_data["message"]

        # Create cluster tenant endpoint
        create_res = client.post(
            "/api/hcp/tenants",
            json={
                "name": "Production HCP Cluster",
                "host": "admin.hcp.corp.local",
                "port": 9090,
                "is_cluster": True,
                "tenant_name": "*",
                "username": "sysadmin",
                "password": "secretclusterpassword",
                "ignore_tls": True,
                "site": "dc",
                "enabled": True,
                "check_interval": 300,
            },
            headers=auth_headers,
        )
        assert create_res.status_code == 200
        c_tenant = create_res.json()
        assert c_tenant["is_cluster"] is True
        assert c_tenant["metrics"]["cluster"]["total_tenants"] == 2
        assert len(c_tenant["metrics"]["namespaces"]) == 2

        # Clean up
        del_res = client.delete(f"/api/hcp/tenants/{c_tenant['id']}", headers=auth_headers)
        assert del_res.status_code == 204

