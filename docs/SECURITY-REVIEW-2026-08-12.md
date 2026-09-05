# Snoomp — vulnerability assessment (VA)

**Scope:** `backend/app/**`, `frontend/src/**`, `docker-compose.yml`, dependency manifests
**Date:** 2026-08-12 · **Version:** v0.3.0 + working tree
**Method:** static source review, `npm audit`, and targeted driver behaviour tests. No running instance, no dynamic testing, no exploitation.
**Baseline:** `SECURITY-REVIEW-2026-08-03.md` (3 critical, 5 high, 8 medium)

---

## Summary

**0 critical, 0 high, 3 medium, 3 low.**

Thirteen of the sixteen prior findings are fixed, including all three criticals. The
compromise chain described in the last review — forge an admin token, enumerate the
fleet over an unauthenticated WebSocket, read back stored SSH keys — is fully closed.

What remains is one chain worth attention: two *partial* fixes compose into a working
attack. F10 removed `host` from public status pages but left `id`, and `id` is the only
credential the unauthenticated push endpoint checks. Anyone with a public status page
URL can forge heartbeats for any push monitor listed on it.

**Fix order:** N1 → N2 → N3. None are urgent enough to block a release; N1 should not
survive the next one.

---

## Regression check against 2026-08-03

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| F1 | JWT secret committed | **Fixed** | `auth/security.py:16` — `os.environ.get` with no fallback, `RuntimeError` at boot |
| F2 | WebSocket unauthenticated | **Fixed** | `websockets.py:75-89` — token decoded and validated before `accept()`, closes 1008 |
| F3 | Credentials returned to viewers | **Fixed** | `models/target.py:29-39` — `_SECRET_KEYS` redacted in `to_dict`; `targets.py:90-97` sentinel-merge on write |
| F4 | Arbitrary SQL on monitored DBs | **Fixed** | `checkers/db_check.py:12-16` — `_validate_query` rejects non-`SELECT` |
| F5 | Vulnerable Vite/esbuild | **Fixed** | `package.json` — `vite ^6.4.3`, `esbuild ^0.25.0` override; 0 production advisories |
| F6 | CORS wildcard with credentials | **Fixed** | `main.py:100-105` — env allowlist, explicit methods and headers |
| F7 | No login rate limiting | **Fixed** | `routes/auth.py:21-36` — 5 attempts / 15 min per IP *(see N6)* |
| F8 | Default admin password | **Fixed** | `main.py:53-70` — random password, stdout only, never logged |
| F9 | Unauthenticated push endpoint | **Partial** | Allowlist and size cap added; no per-target token → **N1**, cast bug → **N2** |
| F10 | Public pages leak hostnames | **Partial** | `host` omitted (`status_pages.py:148`) but `id` still returned → **N1** |
| F11 | JWT in `localStorage` | **Open** | `App.tsx:177` — unchanged; accepted risk, no XSS sink present |
| F12 | Ping argument injection | **Fixed** | `checkers/ping.py:11-20` — host regex plus `--` separator |
| F13 | SSRF inherent to product | **Accepted** | Deployment constraint, unchanged |
| F14 | No dependency pinning | **Fixed** | `requirements.txt` — all 21 packages pinned with `==` |
| F15 | Unmaintained pysnmp | **Fixed** | `pysnmp-lextudio==6.1.2` |
| F16 | Broad exception swallowing | **Partial** | Still present in `database.py` and several `App.tsx` handlers |
| — | Unused `custom_css` | **Open** | Not deleted, and now writable via API → **N5** |

---

## Medium

### N1 — Public status pages hand out the push endpoint's only credential

**Files:** `routes/status_pages.py:144`, `routes/dashboard.py:443-452`
**CWE-306** Missing Authentication for Critical Function · **CWE-200** Information Exposure

The public payload includes the target UUID:

```python
monitors_data.append({
    "id": target.id,          # <-- returned to anonymous callers
    "name": target.name,
    # F10: host intentionally omitted — internal IPs must not leak to public pages
```

And the push endpoint authenticates on nothing else:

```python
# Push endpoint: publicly accessible (or optionally secured by query token,
# but target_id acts as token)
@router.api_route("/push/{target_id}", methods=["GET", "POST"])
```

The comment states the design assumption plainly — `target_id` *is* the token — and the
status page publishes it. F10 and F9 were each fixed on their own terms; together they
leave the gap open.

**Impact.** For any push-type monitor listed on a public status page, an anonymous
caller can write heartbeats: mark a failing service "up" and suppress the outage, the
alert, and the SLA impact. Because there is no rate limit and no retention policy on
`heartbeats`, the same endpoint is also an unbounded write primitive against storage.

**Fix.** Issue a per-target push token (a second UUID, not the primary key) and require
it as a header or query parameter. Omit `id` from the public payload and key the page's
own rendering on an opaque per-page index.

### N2 — Unauthenticated 500 on the push endpoint via partial metrics

**File:** `routes/dashboard.py:477-483`, `505-513`
**CWE-20** Improper Input Validation

The numeric guard only runs when **all three** metrics are present:

```python
if cpu is not None and mem is not None and disk is not None:
    try:
        status = evaluate_resource_status(float(cpu), float(mem), float(disk))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, ...)
```

Supplying a subset skips it entirely and reaches the unguarded casts below:

```python
if cpu is not None or mem is not None or disk is not None:   # note: or
    metric_row = SystemMetrics(
        cpu_percent=float(cpu) if cpu is not None else None,  # ValueError -> 500
```

`POST /api/dashboard/push/<id>` with `{"cpu": "abc"}` raises an unhandled `ValueError`.
Unauthenticated, and it returns a stack-trace-bearing 500 if the app is not running with
`debug=False`.

**Fix.** Coerce and validate each metric once, before either branch.

### N3 — WebSocket accepts tokens for deactivated users

**File:** `websockets.py:79-89`

The handler decodes the JWT and checks that `sub` is present, but never loads the user:

```python
payload = pyjwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
username = payload.get("sub")
if not username:
    await websocket.close(code=1008)
```

`get_current_user` (`auth/security.py:58`) checks `user is None or not user.is_active`.
The WebSocket does not. Deactivating or deleting an account therefore does not terminate
its live feed of the entire fleet — that persists until token expiry, which
`ACCESS_TOKEN_EXPIRE_MINUTES` defaults to **1440 (24 hours)**.

**Fix.** Load the user and check `is_active` before `manager.connect()`. Consider
re-validating periodically for long-lived sockets.

---

## Low

**N4 — Push payload size cap measures the wrong thing at the wrong time.**
`dashboard.py:462-465`. `sys.getsizeof(str(payload))` runs *after* FastAPI has parsed the
JSON body, so the allocation it is meant to prevent has already happened; `getsizeof`
also measures a Python object's footprint, not the request size. A body limit belongs at
the proxy or ASGI layer.

**N5 — `custom_css` is writable but never rendered.**
`models/status_page.py:16`, `routes/status_pages.py:25,55,81`. The previous review
recommended deleting it. It is still there and is now settable through the API. Nothing
renders it today, so there is no live issue — but attacker-controlled CSS on a public
page enables data exfiltration through attribute selectors, and the gap between "stored"
and "rendered" is one feature request wide.

**N6 — Login rate limiting is per-process and in-memory.**
`routes/auth.py:24`. `_login_attempts` is a module-level dict: it resets on restart and
is not shared across workers, so the effective limit under `uvicorn --workers N` is
5 × N. It also keys on IP alone, so it neither survives IP rotation nor protects a
single account from distributed guessing. Adequate against casual brute force; move the
counter to Redis, which is already a dependency.

---

## Tested and cleared

Recorded so nobody re-audits them.

**Checker error strings do not leak credentials.** `db_check.py:105`,
`mongodb.py:62`, `redis_check.py:52` interpolate `str(e)` into `heartbeat.error`, which
is stored, returned to viewer-role callers, and printed into exported PDF reports. That
looked like an F3 bypass. It is not — I tested all three drivers with credentialed URIs:

| driver | password in `str(e)` | host in `str(e)` |
|--------|----------------------|------------------|
| pymongo 4.x | no | yes |
| psycopg2 | no | yes |
| redis-py | no | yes |

psycopg2 also does not echo the DSN back on a malformed connection string. Host and port
do appear, but viewers can already read `target.host` legitimately via `to_dict`, and
error strings are not included in the public status page payload. No finding.

**Production dependencies are clean.** `npm audit --omit=dev` reports 0 vulnerabilities.
Two advisories exist in dev-only packages (`nanoid` high, `postcss` moderate, both
transitive under Vite). They do not ship in a production build, but they do execute on
developer machines and in CI — worth `npm audit fix` on the next dependency pass.

**Everything cleared in the previous review remains clear.** No SQL injection, no command
injection, no XSS sink (`dangerouslySetInnerHTML` still absent), bcrypt usage correct,
JWT algorithm still pinned, `RoleChecker` still applied consistently. The three endpoints
added since — `/sla-trend`, `/targets/{id}/report`, and `hours` on `/heartbeats` — all
carry `require_viewer`, clamp their range parameters, and build queries through the ORM.

---

## Priority

| # | Action | Finding |
|---|--------|---------|
| 1 | Per-target push token; drop `id` from the public status page payload | N1 |
| 2 | Validate metrics once, before both branches on the push path | N2 |
| 3 | Check `is_active` on the WebSocket handshake | N3 |
| 4 | Move the login rate limiter to Redis; key on IP **and** username | N6 |
| 5 | Delete `custom_css` | N5 |
| 6 | Body-size limit at the proxy; drop the `getsizeof` check | N4 |
| 7 | `npm audit fix` for the dev-only advisories | — |

Still outstanding from the previous review and unchanged in priority: encrypt
`config_json` at rest, move the JWT off `localStorage`, replace bare `except Exception`,
add a retention policy to `heartbeats` (now also an N1 amplifier), and add secret
scanning plus `pip-audit` to CI.

---

*Static assessment only. This will not have caught logic flaws requiring a running
instance, race conditions, or issues in Celery/Redis message handling. A dynamic pass
(VT) against a deployed instance is still recommended before any internet-facing
exposure.*
