import pytest
from unittest.mock import patch, AsyncMock
from app.routes.system import parse_semver, is_version_newer, check_updates


def test_parse_semver():
    assert parse_semver("1.2.0") == (1, 2, 0)
    assert parse_semver("v1.2.0") == (1, 2, 0)
    assert parse_semver("V2.0.1") == (2, 0, 1)
    assert parse_semver("1.3.0-rc1") == (1, 3, 0)
    assert parse_semver("1") == (1, 0, 0)
    assert parse_semver("1.2") == (1, 2, 0)


def test_is_version_newer():
    # Newer
    assert is_version_newer("1.3.0", "1.2.0") is True
    assert is_version_newer("v2.0.0", "1.9.9") is True
    assert is_version_newer("1.2.1", "1.2.0") is True

    # Same
    assert is_version_newer("1.2.0", "1.2.0") is False
    assert is_version_newer("v1.2.0", "1.2.0") is False

    # Older
    assert is_version_newer("1.1.0", "1.2.0") is False
    assert is_version_newer("1.2.0", "1.3.0") is False


@pytest.mark.asyncio
async def test_check_updates_success_mock():
    mock_release = {
        "tag_name": "v1.4.0",
        "name": "Snoomp v1.4.0 - Major Enhancements",
        "body": "Detailed release notes here.",
        "html_url": "https://github.com/ardhanata/snoomp/releases/tag/v1.4.0",
        "published_at": "2026-09-09T10:00:00Z"
    }

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_release

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        with patch("app.routes.system.get_app_version", return_value="1.3.0"):
            res = await check_updates(force=True)
            assert res["has_update"] is True
            assert res["latest_version"] == "1.4.0"
            assert res["current_version"] == "1.3.0"
            assert res["release_name"] == "Snoomp v1.4.0 - Major Enhancements"
            assert "git pull" in res["upgrade_command_docker"]
            assert "install.sh" in res["upgrade_command_installer"]
