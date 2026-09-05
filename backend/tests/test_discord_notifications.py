"""
Unit tests for app/notifications/discord.py.

Pure unit tests: no containers, no network. Redis and the HTTP POST are both
substituted, so these run in milliseconds and are safe in CI without Docker.
"""

import json

import pytest

from app.notifications import discord


WEBHOOK = "https://discord.com/api/webhooks/123456789/abcDEF-token_123"
WEBHOOK_2 = "https://discord.com/api/webhooks/987654321/zyxWVU-token_987"


# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------
class FakeRedis:
    """Just enough Redis for the queue: rpush/lpush/lrange/ltrim/llen + pipeline."""

    def __init__(self):
        self.lists: dict[str, list[bytes]] = {}

    def ping(self):
        return True

    def rpush(self, key, *vals):
        self.lists.setdefault(key, []).extend(
            v.encode() if isinstance(v, str) else v for v in vals
        )

    def lpush(self, key, *vals):
        # Redis LPUSH prepends each value in turn, so LPUSH k a b c yields
        # [c, b, a]. Modelling this matters: the requeue path relies on it to
        # restore original ordering.
        items = [v.encode() if isinstance(v, str) else v for v in vals]
        self.lists.setdefault(key, [])[0:0] = list(reversed(items))

    def lrange(self, key, start, end):
        lst = self.lists.get(key, [])
        return lst[start:] if end == -1 else lst[start:end + 1]

    def ltrim(self, key, start, end):
        lst = self.lists.get(key, [])
        self.lists[key] = lst[start:] if end == -1 else lst[start:end + 1]

    def llen(self, key):
        return len(self.lists.get(key, []))

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, r):
        self.r = r
        self.ops = []

    def rpush(self, *a):
        self.ops.append(("rpush", a)); return self

    def lpush(self, *a):
        self.ops.append(("lpush", a)); return self

    def lrange(self, *a):
        self.ops.append(("lrange", a)); return self

    def ltrim(self, *a):
        self.ops.append(("ltrim", a)); return self

    def execute(self):
        return [getattr(self.r, name)(*args) for name, args in self.ops]


@pytest.fixture
def fake_redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(discord, "_redis", lambda: r)
    return r


class DummyClient:
    """Stand-in for httpx.Client so tests never build a real connection pool."""

    def __init__(self, *a, **kw):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def close(self):
        pass

    def post(self, *a, **kw):
        raise AssertionError("real POST attempted in a unit test")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """
    Every test in this module is offline.

    Without this, constructing httpx.Client picks up ambient proxy environment
    variables and can fail before any request is even made.
    """
    monkeypatch.setattr(discord.httpx, "Client", DummyClient)
    monkeypatch.setattr(discord.time, "sleep", lambda *_: None)


@pytest.fixture
def sent(monkeypatch):
    """Capture outbound webhook payloads instead of posting them."""
    captured = []

    def _fake_post(url, payload, client=None):
        captured.append((url, payload))
        return True

    monkeypatch.setattr(discord, "_post", _fake_post)
    return captured


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("DISCORD_ALERTS_ENABLED", "1")
    monkeypatch.setenv("DISCORD_WEBHOOK_CRITICAL", WEBHOOK)
    monkeypatch.setenv("DISCORD_WEBHOOK_WARNING", WEBHOOK_2)
    monkeypatch.delenv("DISCORD_ONCALL_ROLE_ID", raising=False)


def make_alert(name="soa-osb-01", status="down", **kw):
    return discord.DiscordAlert(
        target_name=name,
        host=kw.pop("host", "10.0.0.11"),
        target_type=kw.pop("target_type", "ssh"),
        prev_status=kw.pop("prev_status", "up"),
        new_status=status,
        **kw,
    )


# --------------------------------------------------------------------------
# Webhook URL validation
# --------------------------------------------------------------------------
@pytest.mark.parametrize("url", [
    WEBHOOK,
    "https://discord.com/api/v10/webhooks/123/abc-DEF_456",
    "https://canary.discord.com/api/webhooks/123/tok",
    "https://discordapp.com/api/webhooks/123/tok",
])
def test_valid_webhooks_accepted(url):
    assert discord.is_valid_webhook(url)


@pytest.mark.parametrize("url", [
    None,
    "",
    "http://discord.com/api/webhooks/123/tok",          # not https
    "https://evil.example.com/api/webhooks/123/tok",    # wrong host
    "https://discord.com/api/webhooks/123",             # no token
    "https://discord.com/login",                        # not a webhook path
    "https://discord.com.evil.io/api/webhooks/1/t",     # host suffix trick
    "not a url",
])
def test_invalid_webhooks_rejected(url):
    assert not discord.is_valid_webhook(url)


def test_malformed_webhook_env_is_refused(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_CRITICAL", "https://evil.example.com/hook")
    assert discord.webhook_for("critical") is None


def test_warning_falls_back_to_critical_webhook(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_CRITICAL", WEBHOOK)
    monkeypatch.delenv("DISCORD_WEBHOOK_WARNING", raising=False)
    assert discord.webhook_for("warning") == WEBHOOK


# --------------------------------------------------------------------------
# Severity routing
# --------------------------------------------------------------------------
@pytest.mark.parametrize("status,severity", [
    ("down", discord.SEVERITY_CRITICAL),
    ("critical", discord.SEVERITY_CRITICAL),
    ("off", discord.SEVERITY_CRITICAL),
    ("degraded", discord.SEVERITY_WARNING),
    ("warning", discord.SEVERITY_WARNING),
    ("up", discord.SEVERITY_RECOVERED),
    ("DOWN", discord.SEVERITY_CRITICAL),
])
def test_severity_mapping(status, severity):
    assert discord.severity_for(status) == severity


def test_recovery_routes_to_the_channel_that_raised_the_alarm():
    # A RECOVERED for a DOWN must land in #alerts-critical, otherwise readers of
    # that channel never learn the incident closed.
    assert discord.channel_for(discord.SEVERITY_RECOVERED) == "critical"
    assert discord.channel_for(discord.SEVERITY_CRITICAL) == "critical"
    assert discord.channel_for(discord.SEVERITY_WARNING) == "warning"


# --------------------------------------------------------------------------
# Embeds
# --------------------------------------------------------------------------
def test_embed_shape_and_color():
    embed = make_alert(status="down", response_time_ms=4021.4,
                       error="connection timeout after 4s").to_embed()

    assert embed["title"].startswith("DOWN - soa-osb-01")
    assert embed["color"] == 15548997
    assert "connection timeout" in embed["description"]
    names = {f["name"]: f["value"] for f in embed["fields"]}
    assert names["Protocol"] == "SSH"
    assert names["Transition"] == "UP -> DOWN"
    assert names["Response"] == "4021 ms"


def test_recovered_embed_is_green_and_reports_downtime():
    embed = make_alert(status="up", prev_status="down", duration_s=930).to_embed()
    assert embed["title"].startswith("RECOVERED")
    assert embed["color"] == 3066993
    names = {f["name"]: f["value"] for f in embed["fields"]}
    assert names["Downtime"] == "15m 30s"


def test_long_fields_are_clipped():
    embed = make_alert(name="x" * 400, error="e" * 6000).to_embed()
    assert len(embed["title"]) <= 210
    assert len(embed["description"]) <= discord.MAX_DESCRIPTION


def test_embed_roundtrips_through_json():
    original = make_alert(response_time_ms=12.5, duration_s=60)
    restored = discord.DiscordAlert.from_json(original.to_json())
    assert restored.to_embed() == original.to_embed()


# --------------------------------------------------------------------------
# Message assembly
# --------------------------------------------------------------------------
def test_oncall_pinged_once_regardless_of_alert_count(monkeypatch):
    monkeypatch.setenv("DISCORD_ONCALL_ROLE_ID", "555")
    msg = discord.build_message([make_alert(f"host-{i}") for i in range(8)])
    assert msg["content"].count("<@&555>") == 1
    assert "8 monitors down" in msg["content"]


def test_recovered_alerts_do_not_ping(monkeypatch):
    monkeypatch.setenv("DISCORD_ONCALL_ROLE_ID", "555")
    msg = discord.build_message([make_alert(status="up", prev_status="down")])
    assert "content" not in msg


def test_warning_alerts_do_not_ping(monkeypatch):
    monkeypatch.setenv("DISCORD_ONCALL_ROLE_ID", "555")
    msg = discord.build_message([make_alert(status="degraded")])
    assert "content" not in msg


def test_mentions_are_always_constrained(monkeypatch):
    # A monitor named "@everyone" must not be able to page the server.
    monkeypatch.delenv("DISCORD_ONCALL_ROLE_ID", raising=False)
    msg = discord.build_message([make_alert(name="@everyone")])
    assert msg["allowed_mentions"] == {"parse": []}


def test_message_respects_discord_embed_ceiling():
    msg = discord.build_message([make_alert(f"h{i}") for i in range(25)])
    assert len(msg["embeds"]) == discord.MAX_EMBEDS_PER_MESSAGE


# --------------------------------------------------------------------------
# Queue and flush
# --------------------------------------------------------------------------
def test_enqueue_is_a_noop_when_disabled(monkeypatch, fake_redis):
    monkeypatch.delenv("DISCORD_ALERTS_ENABLED", raising=False)
    assert discord.enqueue(make_alert()) is False
    assert fake_redis.lists == {}


def test_enqueue_routes_to_the_right_queue(enabled, fake_redis):
    discord.enqueue(make_alert(status="down"))
    discord.enqueue(make_alert(status="degraded"))

    assert fake_redis.llen("snoomp:discord:queue:critical") == 1
    assert fake_redis.llen("snoomp:discord:queue:warning") == 1


def test_queue_is_capped(enabled, fake_redis, monkeypatch):
    monkeypatch.setenv("DISCORD_QUEUE_MAX", "5")
    for i in range(20):
        discord.enqueue(make_alert(f"host-{i}"))

    key = "snoomp:discord:queue:critical"
    assert fake_redis.llen(key) == 5
    # Oldest dropped, newest retained.
    kept = [json.loads(x)["target_name"] for x in fake_redis.lists[key]]
    assert kept == [f"host-{i}" for i in range(15, 20)]


def test_flush_batches_ten_alerts_per_request(enabled, fake_redis, sent):
    for i in range(10):
        discord.enqueue(make_alert(f"host-{i}"))

    delivered = discord.flush()

    assert delivered == 10
    assert len(sent) == 1                      # one request, not ten
    url, payload = sent[0]
    assert url == WEBHOOK
    assert len(payload["embeds"]) == 10
    assert fake_redis.llen("snoomp:discord:queue:critical") == 0


def test_flush_paces_a_large_backlog_across_cycles(enabled, fake_redis, sent):
    # 40 monitors dropping at once is the scenario that breaks a naive sender.
    for i in range(40):
        discord.enqueue(make_alert(f"host-{i}"))

    first = discord.flush()
    assert first == 40 if discord.MAX_REQUESTS_PER_FLUSH >= 4 else first
    assert len(sent) <= discord.MAX_REQUESTS_PER_FLUSH

    # Anything beyond the per-cycle cap stays queued rather than being dropped.
    for i in range(40, 80):
        discord.enqueue(make_alert(f"host-{i}"))
    before = fake_redis.llen("snoomp:discord:queue:critical")
    discord.flush()
    after = fake_redis.llen("snoomp:discord:queue:critical")
    assert after < before


def test_failed_delivery_requeues_instead_of_dropping(enabled, fake_redis, monkeypatch):
    monkeypatch.setattr(discord, "_post", lambda *a, **k: False)

    for i in range(3):
        discord.enqueue(make_alert(f"host-{i}"))
    assert discord.flush() == 0

    key = "snoomp:discord:queue:critical"
    assert fake_redis.llen(key) == 3
    order = [json.loads(x)["target_name"] for x in fake_redis.lists[key]]
    assert order == ["host-0", "host-1", "host-2"]   # order preserved


def test_malformed_queue_entry_is_discarded_not_fatal(enabled, fake_redis, sent):
    fake_redis.rpush("snoomp:discord:queue:critical", "{not json")
    discord.enqueue(make_alert("good-host"))

    assert discord.flush() == 1
    assert sent[0][1]["embeds"][0]["title"].endswith("good-host")


def test_flush_without_redis_is_a_noop(enabled, monkeypatch):
    monkeypatch.setattr(discord, "_redis", lambda: None)
    assert discord.flush() == 0


def test_enqueue_without_redis_sends_directly(enabled, monkeypatch, sent):
    monkeypatch.setattr(discord, "_redis", lambda: None)
    assert discord.enqueue(make_alert()) is True
    assert len(sent) == 1


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def test_notify_status_change_never_raises(monkeypatch, enabled):
    def boom():
        raise RuntimeError("redis exploded")
    monkeypatch.setattr(discord, "_redis", boom)

    assert discord.notify_status_change(
        target_name="db-01", host="10.0.0.5", target_type="db",
        prev_status="up", new_status="down",
    ) is False


def test_notify_status_change_queues(enabled, fake_redis):
    assert discord.notify_status_change(
        target_name="db-01", host="10.0.0.5", target_type="db",
        prev_status="up", new_status="down", error="pg: too many connections",
    ) is True

    raw = fake_redis.lists["snoomp:discord:queue:critical"][0]
    assert json.loads(raw)["error"] == "pg: too many connections"
