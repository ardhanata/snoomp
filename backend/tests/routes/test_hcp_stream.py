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
from app.models.hcp_stream import (
    HcpNodeMetric,
    HcpSyntheticProbeResult,
    HcpStreamAggregate,
    HcpLogIngestJob,
)
from app.services.hcp_stream_service import parse_hcp_access_log_line
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
        username="stream_admin",
        email="stream_admin@example.com",
        hashed_password=get_password_hash("streampass"),
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
    token = create_access_token({"sub": "stream_admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_hcp():
    db = TestingSessionLocal()
    hcp = HcpTenant(
        name="Stream Cluster",
        host="admin.hcp.internal",
        port=9090,
        tenant_name="*",
        is_cluster=True,
        username="sysadmin",
        password="secretpassword",
        metrics_cache={
            "namespaces": [
                {"name": "ns-finance", "tenant_name": "finance"},
                {"name": "ns-ops", "tenant_name": "operations"},
            ],
            "tenants": [
                {"name": "finance", "status": "ok", "namespaces_accessible": True},
                {"name": "restricted-tenant", "status": "warning", "namespaces_accessible": False},
            ],
        },
    )
    db.add(hcp)
    db.commit()
    db.refresh(hcp)
    hcp_id = hcp.id
    db.close()
    return hcp_id


def test_parse_hcp_access_log_line():
    sample_line = (
        '2026-10-16T12:00:00.123+0700 10.242.143.50 testuser GET /rest/bucket/key 200 4096 128 32 finance ns-finance 101'
    )
    parsed = parse_hcp_access_log_line(sample_line)
    assert parsed is not None
    assert parsed["client_ip"] == "10.242.143.50"
    assert parsed["user"] == "testuser"
    assert parsed["method"] == "GET"
    assert parsed["path"] == "/rest/bucket/key"
    assert parsed["status_code"] == 200
    assert parsed["status_class"] == "2xx"
    assert parsed["duration_ms"] == 32.0
    assert parsed["tenant_name"] == "finance"
    assert parsed["namespace_name"] == "ns-finance"
    assert parsed["node_number"] == 101


def test_get_stream_overview(client, auth_headers, test_hcp):
    resp = client.get(f"/api/hcp/{test_hcp}/stream/overview", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "traffic" in data
    assert "probe" in data
    assert "cluster_nodes" in data
    assert "flagged_tenants" in data
    # restricted-tenant should be flagged for HTTP 403
    flagged_names = [f["name"] for f in data["flagged_tenants"]]
    assert "restricted-tenant" in flagged_names


def test_get_stream_nodes(client, auth_headers, test_hcp):
    resp = client.get(f"/api/hcp/{test_hcp}/stream/nodes", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "cluster_avg_cpu_percent" in data


def test_get_stream_tenants_and_probes(client, auth_headers, test_hcp):
    resp_tenants = client.get(f"/api/hcp/{test_hcp}/stream/tenants", headers=auth_headers)
    assert resp_tenants.status_code == 200
    assert "streams" in resp_tenants.json()

    resp_probes = client.get(f"/api/hcp/{test_hcp}/stream/probes", headers=auth_headers)
    assert resp_probes.status_code == 200
    assert "probes" in resp_probes.json()


def test_investigation_endpoint(client, auth_headers, test_hcp):
    resp = client.get(f"/api/hcp/{test_hcp}/stream/investigation", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "top_clients" in data
    assert "client_errors_4xx" in data
    assert "slow_transfers" in data
