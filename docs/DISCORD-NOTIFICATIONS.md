# Snoomp to Discord Alerting

Pipes Snoomp status transitions into the Discord server built by
[`scripts/discord/`](../scripts/discord/README.md). Snoomp monitors your infrastructure with
its own checkers and reports into your own team server.

| | |
|---|---|
| Module | `backend/app/notifications/discord.py` |
| Trigger | `trigger_alerts()` in `backend/worker/tasks.py`, on incident open and recovery |
| Flusher | `_flush_discord_alerts()` in `backend/app/scheduler/runner.py`, every 10s |
| Tests | `backend/tests/test_discord_notifications.py` (42 tests, offline) |

---

## 1. Routing

| Status transition | Severity | Channel | Pings `@OnCall` |
|---|---|---|---|
| `-> down` / `critical` / `off` | critical | `#alerts-critical` | Yes |
| `-> degraded` / `warning` | warning | `#alerts-warning` | No |
| `-> up` (recovery) | recovered | `#alerts-critical` | No |

Recoveries deliberately land in `#alerts-critical` rather than a channel of their own. A
reader of that channel must be able to see that an incident closed without switching views —
an alert channel with no resolutions forces people into the dashboard to find out whether
something is still broken.

Warnings never ping. If a monitor pages `@OnCall` twice with no action required, fix the
threshold rather than muting the channel.

---

## 2. Create the webhooks

For each of `#alerts-critical` and `#alerts-warning`:

1. Right-click the channel → **Edit Channel** → **Integrations** → **Webhooks**
2. **New Webhook**. Name it `Snoomp Critical` / `Snoomp Warning`
3. **Copy Webhook URL**

The URL contains a token that grants post access to that channel. Treat it as a credential:
it belongs in `.env`, which is already gitignored, and never in the repo.

### Get the OnCall role ID

User Settings → Advanced → **Developer Mode** on. Then Server Settings → Roles → `OnCall` →
`...` → **Copy Role ID**. Leave `DISCORD_ONCALL_ROLE_ID` blank to disable pings entirely.

---

## 3. Configure

In `.env`:

```ini
DISCORD_ALERTS_ENABLED=1
DISCORD_WEBHOOK_CRITICAL=https://discord.com/api/webhooks/.../...
DISCORD_WEBHOOK_WARNING=https://discord.com/api/webhooks/.../...
DISCORD_ONCALL_ROLE_ID=1536277023822192660
DISCORD_FLUSH_INTERVAL=10
DISCORD_QUEUE_MAX=500
```

`docker-compose.yml` already passes `.env` through to both `backend-api` and
`backend-worker` via `env_file`, so no compose changes are needed. Restart:

```bash
docker compose restart backend-api backend-worker
```

Defaults: alerting is **off** unless `DISCORD_ALERTS_ENABLED` is truthy. If only
`DISCORD_WEBHOOK_CRITICAL` is set, warnings fall back to it rather than being dropped.

---

## 4. Verify

```bash
docker compose exec backend-api python -c "
from app.notifications.discord import DiscordAlert, send_now
send_now([DiscordAlert(
    target_name='verification-test', host='127.0.0.1', target_type='http',
    prev_status='up', new_status='down', response_time_ms=4021,
    error='synthetic test alert - safe to ignore')])
"
```

A red `DOWN - verification-test` embed should appear in `#alerts-critical`. Then check the
queue is draining:

```bash
docker compose exec backend-api python -c "
from app.notifications.discord import queue_depth; print(queue_depth())"
```

Steady state is `{'critical': 0, 'warning': 0}`. A depth that climbs and never falls means
the flusher isn't running — check the API logs for `Scheduled Discord alert flusher`.

---

## 5. Rate limiting

Discord allows roughly **5 requests per 2 seconds per webhook**. This is the constraint the
whole design is built around.

A network partition that takes 40 monitors down at once produces 40 transitions across
several Celery workers within a second or two. Posting each one directly means most are
rejected with `429` and lost — precisely when the alerts matter most.

So transitions are not sent from the worker. They are pushed to a Redis list
(`snoomp:discord:queue:{critical,warning}`) and drained by a single flusher running in the
API process on a 10-second interval:

- Up to **10 embeds per request** (Discord's per-message ceiling), so 40 alerts become 4 requests
- At most **4 requests per channel per cycle**, spaced 450ms apart, leaving headroom under the limit
- A backlog beyond that stays queued and drains over subsequent cycles rather than being dropped
- `@OnCall` is mentioned **once per message**, not once per alert — 40 pings for one partition is how a channel gets muted
- Failed delivery re-queues at the head with ordering preserved
- The queue is capped at `DISCORD_QUEUE_MAX`; on overflow the **oldest** alerts are dropped, since during a sustained outage the newest state is the useful one

The flusher lives in the API process, not the workers, on purpose. Batching only helps if a
single process owns the queue; several workers each posting their own batches would
reproduce the fan-out the queue exists to prevent.

### Native Windows mode

Without Redis, `enqueue()` falls back to sending directly with paced requests. That
deployment is single-process, so the concurrency the queue guards against doesn't arise.

---

## 6. Security

- **Webhook URLs are validated before use.** Only `https` on a Discord-owned host with a
  `/api/webhooks/<id>/<token>` path shape is accepted. A misconfigured or attacker-supplied
  URL here would receive every hostname, error string, and SLA figure Snoomp produces, so
  this is a whitelist rather than a generic URL check.
- **Mentions are always constrained** via `allowed_mentions`. A monitor named `@everyone`
  cannot page the server.
- **Notification failures never propagate.** The incident row is committed before alerting;
  an unreachable webhook must not roll it back.
- `webhook_url` is already in `Target._SECRET_KEYS`, so per-target webhooks are redacted in
  API responses.

Alert embeds contain infrastructure hostnames, mount points, and SLA figures. This is
another reason the internal server should not later be converted into a public community
server — see section 9 of [`DISCORD-SERVER-BLUEPRINT.md`](DISCORD-SERVER-BLUEPRINT.md).

---

## 7. Relationship to Apprise

Both paths run, and neither suppresses the other:

| | Discord | Apprise |
|---|---|---|
| Configured | Globally, via `DISCORD_*` env vars | Per target, `config_json.notifications[].apprise_uri` |
| Format | Rich embeds, colored by severity | Plain text title and body |
| Batched | Yes | No |

Apprise can technically post to Discord via a `discord://` URI, but it sends plain text with
no severity routing, no `@OnCall` mention, and no batching. Use this module for Discord and
Apprise for everything else — email, Slack, Telegram, PagerDuty.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing arrives, no errors | `DISCORD_ALERTS_ENABLED` is unset or falsy. It defaults to off. |
| `not a valid Discord webhook URL; refusing to send` | URL is malformed or truncated. It must look like `https://discord.com/api/webhooks/<id>/<token>`. |
| Queue depth climbs and never falls | Flusher isn't running. Confirm `Scheduled Discord alert flusher` appears in the API logs at startup. |
| Alerts arrive but `@OnCall` isn't pinged | `DISCORD_ONCALL_ROLE_ID` is blank or non-numeric. It's the role ID, not the role name. |
| Recoveries never arrive | Recovery alerts only fire when an open incident exists. A monitor that was never DOWN produces no RECOVERED. |
| Duplicate alerts | Multiple API instances each running a scheduler. Only one process should own the flusher. |

Run the tests after any change to this module:

```bash
cd backend && python -m pytest tests/test_discord_notifications.py -q
```
