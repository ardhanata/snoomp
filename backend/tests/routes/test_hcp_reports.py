import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models.user import User
from app.models.hcp import HcpTenant
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
        username="report_admin",
        email="report_admin@example.com",
        hashed_password=get_password_hash("secretpass"),
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
    token = create_access_token({"sub": "report_admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


MOCK_CLUSTER_CACHE = {
    "status": "ok",
    "response_time_ms": 45.0,
    "is_cluster": True,
    "cluster": {
        "total_tenants": 2,
        "total_namespaces": 3,
        "storage_used_bytes": 10737418240,
        "storage_used_formatted": "10.00 GB",
        "hard_quota_bytes": 107374182400,
        "hard_quota_formatted": "100.00 GB",
        "used_percent": 10.0,
        "object_count": 15000,
        "status": "ok",
    },
    "tenants_summary": {
        "total_count": 2,
        "warning_count": 0,
        "critical_count": 0,
        "healthy_count": 2,
    },
    "tenants": [
        {
            "name": "finance",
            "storage_used_bytes": 8589934592,
            "storage_used_formatted": "8.00 GB",
            "hard_quota_bytes": 10737418240,
            "hard_quota_formatted": "10.00 GB",
            "used_percent": 80.0,
            "object_count": 12000,
            "status": "ok",
            "namespaces_accessible": True,
        },
        {
            "name": "marketing",
            "storage_used_bytes": 2147483648,
            "storage_used_formatted": "2.00 GB",
            "hard_quota_bytes": 21474836480,
            "hard_quota_formatted": "20.00 GB",
            "used_percent": 10.0,
            "object_count": 3000,
            "status": "ok",
            "namespaces_accessible": True,
        },
    ],
    "namespaces": [
        {
            "name": "ledger-2025",
            "tenant_name": "finance",
            "storage_used_bytes": 7516192768,
            "storage_used_formatted": "7.00 GB",
            "hard_quota_bytes": 8589934592,
            "hard_quota_formatted": "8.00 GB",
            "soft_quota_pct": 85.0,
            "used_percent": 87.5,
            "object_count": 10500,
            "status": "warning",
        },
        {
            "name": "receipts",
            "tenant_name": "finance",
            "storage_used_bytes": 1073741824,
            "storage_used_formatted": "1.00 GB",
            "hard_quota_bytes": 2147483648,
            "hard_quota_formatted": "2.00 GB",
            "soft_quota_pct": 85.0,
            "used_percent": 50.0,
            "object_count": 1500,
            "status": "ok",
        },
        {
            "name": "campaigns",
            "tenant_name": "marketing",
            "storage_used_bytes": 2147483648,
            "storage_used_formatted": "2.00 GB",
            "hard_quota_bytes": 21474836480,
            "hard_quota_formatted": "20.00 GB",
            "soft_quota_pct": 85.0,
            "used_percent": 10.0,
            "object_count": 3000,
            "status": "ok",
        },
    ],
}


def test_hcp_cluster_report_404(client, auth_headers):
    resp = client.get("/api/reports/hcp/nonexistent-id/cluster.pdf", headers=auth_headers)
    assert resp.status_code == 404


def test_hcp_cluster_report_success(client, auth_headers):
    db = TestingSessionLocal()
    cluster = HcpTenant(
        name="Production Cluster",
        host="admin.hcp.corp.internal",
        port=9090,
        tenant_name="*",
        is_cluster=True,
        username="sysadmin",
        password="secretpassword",
        metrics_cache=MOCK_CLUSTER_CACHE,
        last_status="ok",
    )
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    cluster_id = cluster.id
    db.close()

    resp = client.get(f"/api/reports/hcp/{cluster_id}/cluster.pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment; filename=" in resp.headers["content-disposition"]
    assert resp.content.startswith(b"%PDF-")


def test_hcp_tenant_report_validation_and_success(client, auth_headers):
    db = TestingSessionLocal()
    cluster = HcpTenant(
        name="Production Cluster 2",
        host="admin.hcp.corp.internal",
        port=9090,
        tenant_name="*",
        is_cluster=True,
        username="sysadmin",
        password="secretpassword",
        metrics_cache=MOCK_CLUSTER_CACHE,
        last_status="ok",
    )
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    cluster_id = cluster.id
    db.close()

    # When requesting tenant.pdf without tenant_name on a cluster endpoint -> 400
    resp_missing = client.get(f"/api/reports/hcp/{cluster_id}/tenant.pdf", headers=auth_headers)
    assert resp_missing.status_code == 400

    # With tenant_name specified -> 200 with valid PDF
    resp_ok = client.get(f"/api/reports/hcp/{cluster_id}/tenant.pdf?tenant_name=finance", headers=auth_headers)
    assert resp_ok.status_code == 200
    assert resp_ok.headers["content-type"] == "application/pdf"
    assert "attachment; filename=" in resp_ok.headers["content-disposition"]
    assert resp_ok.content.startswith(b"%PDF-")
