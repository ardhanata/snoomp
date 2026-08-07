# Snoomp Discord Server Blueprint

> **Type:** Internal team server (private, invite-only)
> **Project:** Snoomp v0.2.1 — Enterprise Infrastructure Health & Status Platform
> **Stack context:** FastAPI backend, React/Vite frontend, TimescaleDB, Redis, Celery worker

---

## 1. Server Identity

| Setting | Value |
|---|---|
| Server name | `Snoomp` (or `Snoomp — Internal`) |
| Region | Auto |
| Icon | Snoomp logo mark, 512x512 PNG, transparent background |
| Verification level | **Highest** (verified phone required) — internal server, no cost to friction |
| Explicit content filter | Scan messages from all members |
| Default notifications | **Mentions only** — critical for a server with alert webhooks |
| 2FA requirement for moderation | **Enabled** |
| Community features | **Off** — Community mode adds Rules Screening and discovery you don't need internally |

**Why "mentions only" matters:** once `#alerts-critical` is wired to Snoomp webhooks, an "all messages" default will make every member mute the server within a day.

---

## 2. Role Hierarchy

Order matters — Discord permissions cascade top-down, and a role can only manage roles below it.

| # | Role | Color | Hoist | Mentionable | Who |
|---|---|---|---|---|---|
| 1 | `@Owner` | `#2563EB` Azure | Yes | No | You. Administrator. |
| 2 | `@Maintainer` | `#10B981` Emerald | Yes | Yes | Core devs with merge rights |
| 3 | `@Backend` | `#06B6D4` Cyan | No | Yes | FastAPI / Celery / checkers |
| 4 | `@Frontend` | `#A855F7` Purple | No | Yes | React / Vite / dashboard UI |
| 5 | `@Infra` | `#F59E0B` Amber | No | Yes | Docker, TimescaleDB, Redis, deploys |
| 6 | `@OnCall` | `#EF4444` Red | Yes | Yes | Rotating — the only role pinged by critical alerts |
| 7 | `@Contributor` | `#94A3B8` Slate | No | Yes | Part-time / contract devs, scoped access |
| 8 | `@Bot` | `#4B5563` Gray | No | No | All integrations |
| 9 | `@everyone` | — | — | — | Baseline: deny almost everything |

**Functional roles (3–5) are additive and self-assignable** — a person can be both `@Backend` and `@Infra`. Keep them separate from `@Maintainer`, which is a *permission* role, not a *domain* role.

### `@everyone` baseline permissions

Deny at server level, then grant per-channel. This is the single most important step — it makes every later permission decision explicit.

**Deny:** View Channels, Create Invite, Change Nickname, Manage Messages, Mention @everyone/@here, Send TTS, Embed Links (grant per-channel), Attach Files (grant per-channel), Manage Threads, Connect, Video, Priority Speaker.

**Allow:** Read Message History, Add Reactions, Use External Emoji, Use Application Commands.

---

## 3. Channel Structure

### `INFO` (read-only for everyone except Maintainer+)

| Channel | Purpose |
|---|---|
| `#start-here` | Server map, role self-assign instructions, who to ping for what |
| `#announcements` | Releases, breaking changes, process changes. Cross-post from GitHub releases. |
| `#changelog` | GitHub webhook: tags and releases only. Mirrors `CHANGELOG.md`. |
| `#decisions` | Architecture decision log. One message per decision, threaded discussion. Prevents re-litigating settled calls like the `/proc/stat` delta CPU approach. |

### `DEV`

| Channel | Purpose |
|---|---|
| `#general-dev` | Cross-cutting discussion, questions, "anyone know why…" |
| `#backend` | FastAPI, Celery, `app/checkers/*`, database layer |
| `#frontend` | React, `App.tsx`, `dashboard.css`, double-bezel UI, a11y work |
| `#infra-deploy` | Docker Compose, TimescaleDB, Redis, native-Windows deploy path |
| `#checkers` | Protocol checker work — HTTP, ICMP, TCP/DNS, SSH, PostgreSQL, MongoDB, Redis, SNMP. This area has enough surface to deserve its own room. |
| `#code-review` | PR discussion beyond GitHub comments. Link the PR, discuss, resolve. |
| `#design-ui` | Mockups, contrast checks, Lucide icon choices, light/dark palette |

### `OPERATIONS` (webhook-driven, low chat)

| Channel | Purpose |
|---|---|
| `#github` | Push, PR opened/merged, issue events. Bot-only, humans read. |
| `#ci-builds` | Build and test results |
| `#deployments` | Deploy start/success/failure, version bumps |
| `#alerts-critical` | Snoomp monitoring its own infra — DOWN status only. Pings `@OnCall`. |
| `#alerts-warning` | Degraded / SLA-warning / SSL-expiring. **No pings.** |

**Split critical from warning.** A single `#alerts` channel trains people to ignore it. Warning noise is exactly what kills alert channels.

### `WORK`

| Channel | Purpose |
|---|---|
| `#standup` | Daily async standup. Thread per day. |
| `#roadmap` | v0.3.0 planning, milestone tracking |
| `#bugs-triage` | Triage inbox before issues get filed properly |
| `#audits` | A11y, security, and UI audit findings — mirrors your `docs/AUDIT-*.md` cadence |

### `VOICE`

| Channel | Purpose |
|---|---|
| `Standup` | Daily sync, 15 min cap |
| `Pairing 1` / `Pairing 2` | Ad-hoc pairing rooms |
| `War Room` | Incident response. Private to `@Maintainer` + `@Infra` + `@OnCall`. |

### `PRIVATE` (Maintainer + Owner only)

| Channel | Purpose |
|---|---|
| `#maintainers` | Access, credentials rotation, hiring, anything not for `@Contributor` |
| `#secrets-rotation` | Log of what was rotated and when. **Never the values themselves.** |

---

## 4. Permission Matrix

`V` = View, `S` = Send, `M` = Manage messages, `—` = no access

| Channel group | @everyone | @Contributor | @Backend/@Frontend/@Infra | @Maintainer | @Owner |
|---|---|---|---|---|---|
| INFO | V | V | V | V S M | All |
| `#decisions` | V | V | V S | V S M | All |
| DEV | — | V S (scoped) | V S | V S M | All |
| `#code-review` | — | V S | V S | V S M | All |
| OPERATIONS | — | V | V | V S M | All |
| `#alerts-critical` | — | — | V | V S M | All |
| WORK | — | V S | V S | V S M | All |
| VOICE | — | Connect (Pairing) | Connect | All | All |
| `War Room` | — | — | Connect (`@OnCall`) | All | All |
| PRIVATE | — | — | — | V S M | All |

**Contributor scoping:** grant `@Contributor` view access only to the DEV channels matching their work. Use channel-level overwrites, not a separate role per contractor.

---

## 5. Integrations

### GitHub (essential)

Use the native Discord GitHub webhook — `Server Settings → Integrations → Webhooks`, then add `/github` to the webhook URL end and paste into your repo's webhook settings.

| Target channel | Events |
|---|---|
| `#github` | push, pull_request, issues, issue_comment |
| `#changelog` | release, create (tags) |
| `#ci-builds` | workflow_run / check_run |

Filter aggressively. Every-commit noise in `#github` is the reason people mute it.

### Snoomp → Discord alerting (dogfooding)

Snoomp already runs multi-protocol checks; point a notification channel at Discord and you're monitoring your own stack with your own product.

Create two webhooks:

- `Snoomp Critical` → `#alerts-critical`, message prefixed with `<@&ONCALL_ROLE_ID>`
- `Snoomp Warning` → `#alerts-warning`, no mention

Payload shape for a Discord webhook:

```json
{
  "content": "<@&ONCALL_ROLE_ID>",
  "embeds": [{
    "title": "DOWN — SOA OSB Server 1",
    "description": "SSH check failed: connection timeout after 4s",
    "color": 15548997,
    "fields": [
      { "name": "Monitor",  "value": "soa-osb-01",   "inline": true },
      { "name": "Protocol", "value": "SSH",          "inline": true },
      { "name": "Duration", "value": "4.02s",        "inline": true },
      { "name": "SLA 30d",  "value": "99.21%",       "inline": true }
    ],
    "timestamp": "2026-08-04T09:12:00Z"
  }]
}
```

Color codes: DOWN `15548997` (red), WARNING `16098851` (amber), RECOVERED `3066993` (green).

**Send a RECOVERED message for every DOWN.** An alert channel with no resolution messages forces people into the dashboard to find out if something is still broken.

**Rate limits:** Discord webhooks allow ~5 requests per 2 seconds per webhook. If a network partition takes 40 monitors down at once you will hit that ceiling and lose messages. Batch alerts fired within a 10-second window into one embed with multiple fields, or queue them through Celery with backoff.

### Bots

| Bot | Role |
|---|---|
| **Carl-bot** or **Mee6** | Reaction roles for `@Backend`/`@Frontend`/`@Infra` self-assignment, auto-role on join |
| **Wick** | Anti-nuke / audit logging. Worth it even internally — it logs permission and role changes. |
| **Sesh** | Standup reminders, on-call rotation scheduling, meeting polls |

Three bots is enough. Every bot is an account with permissions in a server that has your infrastructure alerts in it — keep the surface small, and never grant a bot Administrator.

---

## 6. Setup Order

Build in this sequence — doing roles before channels saves re-doing every permission overwrite.

1. Create server, set name/icon/region
2. Set verification to Highest, notifications to Mentions Only, enable 2FA requirement
3. Strip `@everyone` down to the baseline in section 2
4. Create all roles top-down in the section 2 order, set colors and hoist flags
5. Create categories, set category-level permission overwrites (channels inherit — this is the big time saver)
6. Create channels inside categories, override only where a channel differs from its category
7. Add integration webhooks — GitHub first, verify events land, then Snoomp
8. Invite bots, configure reaction roles in `#start-here`
9. Write `#start-here` content, pin it
10. Invite the team. Use a **no-expiry, no-max-uses invite for yourself only**; generate single-use 24h invites per person.

---

## 7. Conventions

**Channel naming:** lowercase, hyphenated, no emoji prefixes. Emoji prefixes break search and autocomplete — and your codebase already holds a zero-emoji-in-source rule; keep the tooling consistent with it.

**Threads over channels.** New topic = thread in the relevant channel, not a new channel. Set auto-archive to 24h in `#general-dev` and 7 days in `#backend`/`#frontend`. Servers die of channel sprawl far more often than of channel scarcity.

**Pin discipline.** Max 10 pins per channel. When you hit the cap, promote the durable one to `#decisions` and unpin the rest.

**Alert etiquette.** Only `#alerts-critical` may mention a role. If a monitor pages `@OnCall` twice with no action needed, fix the threshold — don't mute the channel.

**Standup format** — one message per person in a daily thread:

```
Yesterday: <what shipped>
Today:     <what's in flight>
Blocked:   <or "no">
```

---

## 8. Deliberately Omitted

- **Community/onboarding features** — Rules Screening, Welcome Screen, and Discovery add friction with no internal benefit
- **A `#random` channel** — add it later if the team asks; empty social channels signal a dead server
- **Per-person roles** — use channel overwrites for scoped access instead
- **A `#support` channel** — that's for the public server, if Snoomp ever ships one

---

## 9. If Snoomp Goes Public Later

Don't convert this server. Run a **separate public community server** and keep this one internal. Reasons: your alert channels expose infrastructure hostnames (`SOA OSB Server 1`, `/u01`, `/mnt/nfs`) and SLA figures, permission mistakes in a converted server leak silently, and public moderation load will bury internal signal. Link the two with a shared `#announcements` webhook that publishes one direction only — internal to public.
