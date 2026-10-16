import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from app.services.hcp_service import (
    generate_hcp_auth_header,
    parse_quota_bytes,
    format_bytes,
    determine_quota_status,
    list_hcp_tenants,
    query_hcp_cluster_mapi,
)


def test_generate_hcp_auth_header():
    header = generate_hcp_auth_header("lgreen", "p4ssw0rd")
    assert header == "HCP bGdyZWVu:2a9d119df47ff993b662a8ef36f9ea20"

    # Unpadded base64 username + 32-char hex MD5 secret key
    header2 = generate_hcp_auth_header("c2FtcGxldXNy", "5f4dcc3b5aa765d61d8327deb882cf99")
    assert header2 == "HCP c2FtcGxldXNy:5f4dcc3b5aa765d61d8327deb882cf99"

    # Raw username + 32-char hex MD5 secret key
    header3 = generate_hcp_auth_header("sampleusr", "5f4dcc3b5aa765d61d8327deb882cf99")
    assert header3 == "HCP c2FtcGxldXNy:5f4dcc3b5aa765d61d8327deb882cf99"

    # Full header passthrough
    header4 = generate_hcp_auth_header("", "HCP c2FtcGxldXNy:5f4dcc3b5aa765d61d8327deb882cf99")
    assert header4 == "HCP c2FtcGxldXNy:5f4dcc3b5aa765d61d8327deb882cf99"


def test_parse_quota_bytes():
    assert parse_quota_bytes(None) is None
    assert parse_quota_bytes("-1") is None
    assert parse_quota_bytes("unlimited") is None
    assert parse_quota_bytes("50 GB") == 50 * (1024**3)
    assert parse_quota_bytes("2.5 TB") == int(2.5 * (1024**4))
    assert parse_quota_bytes("1,000.00 GB") == 1000 * (1024**3)
    assert parse_quota_bytes("2,500 MB") == 2500 * (1024**2)
    assert parse_quota_bytes(10737418240) == 10737418240
    assert parse_quota_bytes("10737418240") == 10737418240


def test_format_bytes():
    assert format_bytes(None) == "Unlimited"
    assert format_bytes(-1) == "Unlimited"
    assert format_bytes(0) == "0 B"
    assert format_bytes(1024) == "1.00 KB"
    assert format_bytes(1073741824) == "1.00 GB"
    assert format_bytes(int(2.5 * (1024**4))) == "2.50 TB"


def test_determine_quota_status():
    hard = 100 * (1024**3)
    soft = 80.0

    status, pct = determine_quota_status(50 * (1024**3), hard, soft)
    assert status == "ok"
    assert pct == 50.0

    status, pct = determine_quota_status(82 * (1024**3), hard, soft)
    assert status == "warning"
    assert pct == 82.0

    status, pct = determine_quota_status(96 * (1024**3), hard, soft)
    assert status == "critical"
    assert pct == 96.0

    status, pct = determine_quota_status(500 * (1024**3), None, soft)
    assert status == "ok"
    assert pct == 0.0


@pytest.mark.asyncio
async def test_list_hcp_tenants_json_and_xml():
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        # Test JSON response
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"name": ["default", "finance", "engineering"]}
        mock_get.return_value = mock_resp

        tenants = await list_hcp_tenants("admin.hcp.local", 9090, "admin", "pass", True)
        assert tenants == ["default", "engineering", "finance"]

        # Test XML fallback
        mock_resp.json.side_effect = Exception("Not JSON")
        mock_resp.text = "<tenants><name>tenantA</name><name>tenantB</name></tenants>"
        tenants_xml = await list_hcp_tenants("admin.hcp.local", 9090, "admin", "pass", True)
        assert tenants_xml == ["tenantA", "tenantB"]


@pytest.mark.asyncio
async def test_query_hcp_cluster_mapi():
    with patch("app.services.hcp_service.list_hcp_tenants", new_callable=AsyncMock) as mock_list, \
         patch("app.services.hcp_service.query_hcp_tenant_mapi", new_callable=AsyncMock) as mock_query_tenant:

        mock_list.return_value = ["finance", "marketing"]
        mock_query_tenant.side_effect = [
            {
                "status": "ok",
                "response_time_ms": 25.0,
                "tenant": {
                    "name": "finance",
                    "storage_used_bytes": 1024**4,
                    "hard_quota_bytes": 2 * (1024**4),
                    "ingested_volume_bytes": 1024**4,
                    "object_count": 500,
                    "status": "ok",
                },
                "namespaces_summary": {"total_count": 1, "warning_count": 0, "critical_count": 0, "healthy_count": 1},
                "namespaces": [{"name": "invoices", "storage_used_bytes": 1024**4, "status": "ok"}],
            },
            {
                "status": "warning",
                "response_time_ms": 30.0,
                "tenant": {
                    "name": "marketing",
                    "storage_used_bytes": 850 * (1024**3),
                    "hard_quota_bytes": 1024**4,
                    "ingested_volume_bytes": 850 * (1024**3),
                    "object_count": 1200,
                    "status": "warning",
                },
                "namespaces_summary": {"total_count": 1, "warning_count": 1, "critical_count": 0, "healthy_count": 0},
                "namespaces": [{"name": "assets", "storage_used_bytes": 850 * (1024**3), "status": "warning"}],
            },
        ]

        cluster = await query_hcp_cluster_mapi("admin.hcp.local", 9090, "admin", "pass", True)
        assert cluster["is_cluster"] is True
        assert cluster["status"] == "warning"
        assert cluster["cluster"]["total_tenants"] == 2
        assert cluster["cluster"]["total_namespaces"] == 2
        assert len(cluster["namespaces"]) == 2
        assert any(ns["name"] == "invoices" and ns["tenant_name"] == "finance" for ns in cluster["namespaces"])
        assert any(ns["name"] == "assets" and ns["tenant_name"] == "marketing" for ns in cluster["namespaces"])
