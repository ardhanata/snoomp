# Snoomp — security review

**Scope:** `backend/app/**`, `frontend/src/**`, `docker-compose.yml`, `start-*.ps1`, dependency manifests
**Date:** 2026-08-03 · **Version:** v0.2.1 + working-tree changes
**Method:** source review plus `npm audit`. No dynamic testing, no running instance. Findings are code-derived and each cites a file and line.

---

## Summary

**3 critical, 5 high, 8 medium.**

The three critical findings compose into a full compromise chain: the JWT signing key is committed to the repository, so an attacker can mint an admin token; the WebSocket needs no token at all, so they can enumerate the fleet first; and the API returns stored SSH passwords, private keys and database URIs to the *lowest*-privileged role. A monitoring platform holds credentials for everything it watches, which makes it a high-value target — the blast radius here is the whole monitored estate, not just Snoomp.

Nothing here suggests carelessness so much as a project that grew features faster than it grew its threat model. Most of it is cheap to fix.

**Fix order:** F1 (rotate secrets) → F3 (stop returning credentials) → F2 (authenticate the WebSocket) → the rest.

---

## Critical

### F1 — JWT signing secret is committed to the repository

**Files:** `backend/app/auth/security.py:15`, `docker-compose.yml:48`, `start-native-windows.ps1:37`
**CWE-798** Use of Hard-coded Credentials · **CWE-321** Hard-coded Cryptographic Key

```python
JWT_SECRET = os.getenv("JWT_SECRET", "snoomp_jwt_secret_key_change_me_in_prod_2026")
```

The fallback is not merely a placeholder — the same string is the *configured* value in `docker-compose.yml:48`, and the native-Windows launcher hardcodes a second one (`snoomp_native_windows_standalone_key_2026`). Every default deployment of either mode therefore signs tokens with a key that is public to anyone holding the source.

**Impact.** Forge a token for any user, including `admin`, with no credentials and no interaction:

```
jwt.encode({"sub": "admin", "exp": <future>}, "<known secret>", algorithm="HS256")
```

`get_current_user` (`:48`) accepts it — the only checks are signature, expiry, and that the username exists and is active. This is complete authentication bypass and it grants the admin role, which in turn unlocks F3 and F4.

**Also committed:** the PostgreSQL password `snoomp_secure_pass_2026` (`docker-compose.yml:10`, `:44`, `:68`).

**Fix.**
1. Remove the default from `security.py` — fail fast instead:
   ```python
   JWT_SECRET = os.environ["JWT_SECRET"]   # raise at boot if unset
   ```
2. Generate per-deployment secrets (`secrets.token_urlsafe(64)`); read from `.env`, which must be git-ignored.
3. Rotate both the JWT secret and the database password. Rotating the JWT secret invalidates all issued tokens, which is the desired outcome.
4. If this repository is or ever was public, treat both as permanently compromised regardless of rotation, and audit for unexpected sessions.

### F2 — WebSocket endpoint requires no authentication

**File:** `backend/app/main.py:244`, `:34–35`
**CWE-306** Missing Authentication for Critical Function

```python
async def websocket_endpoint(websocket: WebSocket):
    ...
    await websocket.accept()
```

No token parameter, no `Depends`, no origin check. Every REST route is correctly guarded by `require_viewer` / `require_editor` / `require_admin` — the WebSocket is the one hole in an otherwise consistent authorization layer.

**Impact.** Anyone who can reach the port receives `initial_state` plus every live `target_update`: monitor names, internal hostnames and IP addresses, ports, status, response times, CPU/RAM/disk metrics. That is a continuously-updating map of internal infrastructure, free and anonymous. Combined with `allow_origins=["*"]` (F6), a browser visiting a malicious page can open this socket cross-origin and exfiltrate the stream — WebSockets are not subject to same-origin policy, so the CORS setting does not save you here.

**Fix.** Require the token in the connection query string or a subprotocol, validate before `accept()`, and close with 1008 on failure:
```python
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        await websocket.close(code=1008); return
    await manager.connect(websocket)
```
Also validate the `Origin` header against an allowlist.

### F3 — Stored infrastructure credentials are returned to viewer-role users

**Files:** `backend/app/routes/targets.py:42` and `:47`, `:52`; `backend/app/models/target.py:34`
**CWE-200** Exposure of Sensitive Information · **CWE-522** Insufficiently Protected Credentials

`config_json` is a free-form JSON column holding, in plaintext, exactly the secrets the checkers need:

| Monitor type | Secrets in `config_json` | Written at |
|---|---|---|
| SSH | `password`, `private_key` | `MonitorModal.tsx` SSH panel |
| SNMP | `community` | SNMP panel |
| PostgreSQL / MongoDB / Redis | `connection_string` (credentials embedded in the URI) | DB panel |
| Alerts | `webhook_url`, `bot_token`, `chat_id` | Alerts panel |

`TargetResponse` declares `config_json: Dict[str, Any]` and `to_dict()` returns it whole. Both `GET /api/targets` and `GET /api/targets/{id}` are gated only by `require_viewer` — the *read-only* role.

**Impact.** A viewer — the role you would hand to a junior on-call, a contractor, or a dashboard kiosk — can issue one request and harvest every SSH password and private key, every SNMP community string, and every database URI in the fleet. That is privilege escalation out of Snoomp entirely and into the monitored estate. The frontend confirms the data is on the wire: `MonitorModal.tsx` repopulates `cfg.password` and `cfg.private_key` into form fields when editing.

Storage is plaintext too — anyone with database read access, or a copy of `snoomp.db` from the native-Windows mode, gets the same haul.

**Fix.**
1. **Never return secrets.** Redact on read: return `{"password": "••••••••"}` or omit the keys. On update, treat an absent/sentinel value as "unchanged" rather than "clear".
2. **Encrypt at rest.** Envelope-encrypt secret fields with a key from the environment (`cryptography.fernet`), so a database dump is not a credential dump.
3. **Split the response models.** A `TargetResponse` for viewers with no `config_json`, and an editor-only variant with secrets redacted.
4. Prefer SSH keys over passwords, and consider a dedicated secret store rather than a JSON column.

---

## High

### F4 — Editor role can execute arbitrary SQL on monitored databases

**File:** `backend/app/checkers/db_check.py:27` · **CWE-89** (by design, but unbounded)

```python
cursor.execute(query)   # `query` comes verbatim from config_json
```

The "Verification Query" field is intended for `SELECT 1`, but nothing constrains it. An editor can set it to anything, and it runs on every check interval against the target database using the stored credentials.

**Impact.** Data destruction (`DROP TABLE`), data exfiltration into the heartbeat record, and — if the stored role is superuser, which it often is for monitoring accounts — remote code execution on the database host via `COPY … FROM PROGRAM`. Editor is not an administrative role; it should not confer RCE on production databases.

**Fix.** Allowlist the verification query (offer `SELECT 1` and a small set), or parse and reject anything that is not a single read-only `SELECT`. Enforce a statement timeout and connect with a least-privilege role. If arbitrary queries must stay, restrict the field to admins and log every change.

### F5 — Vulnerable Vite and esbuild, and the dev server is the production server

**Files:** `frontend/package.json` · installed `vite@5.4.21`, `esbuild@0.21.5`

| Advisory | Severity | Effect |
|---|---|---|
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | **high** | Path traversal in optimized-deps `.map` handling |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | moderate | Any website can send requests to the dev server and read the response |

These are normally low-consequence because dev servers are not exposed. **Here they are.** `start-native-windows.ps1` runs `npm run dev` as the actual deployment (`CONTEXT.md` §4 Mode B), so a supported production mode ships a dev server carrying a high-severity path-traversal advisory, on a machine inside the monitored network.

**Fix.** Short term, upgrade within the 5.x line to a patched release and re-run `npm audit`. Properly: `npm run build` and serve the static output from a real server in Mode B — the dev server should never be a deployment target. Note `npm audit fix --force` proposes `vite@8`, a major jump; test that deliberately rather than running it blind.

### F6 — CORS allows any origin with credentials

**File:** `backend/app/main.py:212–217` · **CWE-942**

```python
allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
```

Starlette does not send a literal `*` when credentials are enabled — it reflects the requesting `Origin`, which means *every* origin is trusted. The `# Adjust for production` comment acknowledges this; it was never adjusted.

Because the token lives in `localStorage` and travels in an `Authorization` header rather than a cookie, classic CSRF is not the main risk. The exposure is that any page can call the API with a token it has obtained, and any XSS anywhere in the app becomes trivially exfiltratable.

**Fix.** An explicit origin allowlist from an environment variable, and narrow `allow_methods` / `allow_headers` to what is used.

### F7 — No rate limiting on authentication

**File:** `backend/app/routes/auth.py` · **CWE-307**

`POST /api/auth/login` has no attempt counter, no lockout, no delay, and no CAPTCHA. bcrypt provides some natural cost, but nothing prevents sustained distributed guessing — and the default account name is known (F8).

**Fix.** `slowapi` or equivalent, keyed on IP and username: roughly 5 attempts per 15 minutes, escalating backoff, and log failures. Rate-limit the public push endpoint (F9) in the same pass.

### F8 — Default administrator account, with the password written to logs

**File:** `backend/app/main.py:174–183` · **CWE-1392**, **CWE-532**

```python
admin_pwd = get_password_hash("adminpassword")
...
logger.info("Default admin user created: admin / adminpassword")
```

A known-credential admin account is seeded on first boot, with nothing forcing a change, and the plaintext password is written at INFO to logs that are typically shipped and retained.

**Fix.** Generate a random password at seed time and print it once to stdout (never `logger`), or require `SNOOMP_ADMIN_PASSWORD` at first boot. Force a password change on first login. Remove the credential from the log line regardless.

---

## Medium

**F9 — Unauthenticated push endpoint accepts arbitrary JSON.** `dashboard.py:125–148`. No auth by design, but `details.update(payload)` writes attacker-controlled JSON of unbounded size straight into heartbeat storage (CWE-770), and `float(cpu)` at `:152` is unguarded, so a non-numeric value raises and returns 500 (CWE-20). Anyone learning a target UUID can also forge heartbeats and mask a real outage. *Fix:* per-target push tokens, a payload size cap and key allowlist, `try/except` around the casts, rate limiting.

**F10 — Public status pages disclose internal hostnames.** `status_pages.py`, `monitors_data` includes `"host": target.host`. Anyone with the public URL gets internal DNS names and IPs — reconnaissance for the monitored network. *Fix:* omit `host` from the public payload, or make it opt-in per page.

**F11 — JWT stored in `localStorage`.** `App.tsx` — readable by any script, so any XSS becomes full account takeover, and the 1440-minute lifetime widens the window. *Fix:* httpOnly `SameSite=Strict` cookie with CSRF protection, or shorter access tokens plus refresh.

**F12 — Argument injection in the ping fallback.** `checkers/ping.py:14–16`. `host` is appended to an argv list with no `--` separator, so a host of `-f` is parsed as a flag (flood ping) rather than a destination. No shell is involved, so this is not command injection — but it is unintended flag control. *Fix:* validate `host` as a hostname/IP and insert `--` before it.

**F13 — Server-side request forgery is inherent to the product.** `targets.py:139` (`POST /api/targets/test`, editor) lets an authenticated user make the server connect to any host and port and reports the outcome — usable as an internal port scanner from a box with network reach. This is what a monitoring tool does, so treat it as a deployment constraint: network-segment the backend, and consider a deny-list for cloud metadata endpoints (`169.254.169.254`) and loopback.

**F14 — No dependency pinning or lockfile on the backend.** `requirements.txt` uses `>=` for all 20 packages with no upper bounds and no `requirements.lock` / `poetry.lock`. Builds are non-reproducible and a compromised upstream release is pulled automatically. *Fix:* pin exact versions, commit a lockfile, add `pip-audit` to CI.

**F15 — Unmaintained SNMP library.** `requirements.txt:8`, `pysnmp>=4.4.12`. The original `pysnmp` is no longer maintained; the actively maintained line is the lextudio fork. Unmaintained network-parsing code is a poor place to be. *Fix:* migrate to `pysnmp-lextudio` and verify provenance.

**F16 — Errors are swallowed broadly.** `database.py:54` catches bare `Exception` around the TimescaleDB block and downgrades it to a warning; `App.tsx` has multiple empty `catch {}`. Real failures — including auth and connection errors worth alerting on — disappear. *Fix:* catch specific exceptions, log with context.

---

## Not vulnerabilities — checked and clear

Worth recording so nobody re-audits them:

- **No SQL injection in Snoomp's own queries.** Everything goes through SQLAlchemy ORM with bound parameters. The only raw SQL is the static TimescaleDB DDL in `database.py`. F4 is arbitrary SQL *by feature design*, not injection.
- **No command injection.** `ping.py` is the only `subprocess` call; it uses an argv list with no `shell=True`. F12 is argument injection, a weaker class.
- **No XSS sink.** No `dangerouslySetInnerHTML` anywhere in the frontend. The `custom_css` column exists on `StatusPage` but is never rendered — worth deleting before someone wires it up, since injecting attacker CSS into a public page enables data exfiltration via selectors.
- **Password hashing is correct.** `bcrypt.gensalt()` + `checkpw`, per-password salt, constant-time comparison, exceptions swallowed to a `False` return rather than leaking. This is the right implementation.
- **Role-based access control is well structured.** `RoleChecker` is clean and applied consistently across every REST route. The failures above are gaps in *what data* passes the check (F3) and one route that never registered a check (F2) — not a broken model.
- **JWT algorithm is pinned.** `jwt.decode(..., algorithms=[ALGORITHM])` prevents the `alg: none` / algorithm-confusion class.

---

## Priority list

Ordered by exploitability × blast radius, not by effort. Within a tier, the sequence matters where noted.

### P0 — Unauthenticated or trivial compromise

Any one of these alone yields admin access or credential theft. They are also mutually reinforcing, so partial fixes leave the chain intact.

| # | Action | Finding |
|---|---|---|
| 1 | Rotate the JWT secret and the database password. Remove the hardcoded fallback so a missing `JWT_SECRET` fails at boot | F1 |
| 2 | Stop returning `config_json` secrets in API responses — redact on read, treat absent values as unchanged on write | F3 |
| 3 | Authenticate the WebSocket: validate the token before `accept()`, close 1008 on failure | F2 |

Do 1 first — it invalidates every existing token, so any session an attacker already holds dies before the other two land.

### P1 — Authenticated escalation and known-vulnerable surface

Requires a foothold, but each converts a low-privilege account or a stale dependency into something much worse.

| # | Action | Finding |
|---|---|---|
| 4 | Constrain the DB verification query to read-only `SELECT`, or restrict the field to admins | F4 |
| 5 | Upgrade Vite/esbuild; serve a production build in Mode B instead of the dev server | F5 |
| 6 | Replace `allow_origins=["*"]` with an explicit allowlist from the environment | F6 |
| 7 | Rate-limit `/api/auth/login` on IP and username, with escalating backoff | F7 |
| 8 | Remove the default admin password and the plaintext log line; force a change at first login | F8 |

F5 and F8 are near-P0 in practice — F5 because the vulnerable dev server is a supported deployment mode, F8 because `admin` / `adminpassword` is guessable in one attempt. They sit here only because both need an initial network position.

### P2 — Hardening and defence in depth

Reduces damage from a breach rather than preventing entry.

| # | Action | Finding |
|---|---|---|
| 9 | Encrypt `config_json` secrets at rest so a database dump is not a credential dump | F3 (part 2) |
| 10 | Per-target push tokens, payload size caps, input validation on the metric casts | F9 |
| 11 | Move the JWT out of `localStorage` to an httpOnly `SameSite=Strict` cookie | F11 |
| 12 | Omit `host` from public status page payloads, or make it opt-in per page | F10 |
| 13 | Add `--` before `host` in the ping argv and validate it as a hostname/IP | F12 |
| 14 | Network-segment the backend; deny-list cloud metadata and loopback for probe targets | F13 |

### P3 — Supply chain and maintainability

No known active exploit path; these govern how quickly the next issue arrives and how fast you notice it.

| # | Action | Finding |
|---|---|---|
| 15 | Pin backend dependencies to exact versions and commit a lockfile | F14 |
| 16 | Migrate from the unmaintained `pysnmp` to the maintained fork | F15 |
| 17 | Replace bare `except Exception` and empty `catch {}` with specific handling and logging | F16 |
| 18 | Delete the unused `custom_css` column before anything renders it | — |

### Preventive controls

Not sequenced against the above — land them alongside P0/P1 so the same class of finding cannot return.

- **Secret scanning in CI** (`gitleaks` or equivalent). F1 is exactly what this catches, and it is the single highest-leverage control on this list.
- **`pip-audit` and `npm audit` as blocking CI steps.** F5 and F14 were both findable in seconds by a tool.
- **Threat-model note in `CONTEXT.md`:** Snoomp holds credentials for everything it monitors. It is tier-0 infrastructure and should be segmented, access-reviewed and patched on that basis — the current viewer role was clearly designed as "harmless read-only", which F3 shows it is not.

---

*Static review only. It will not have caught logic flaws that need a running instance, race conditions, or issues in Celery/Redis message handling. Consider a dynamic pass and a dependency-provenance review before any internet-facing deployment.*
