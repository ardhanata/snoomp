# Snoomp — audit round 2 (UX, UI, security, React)

**Scope:** `frontend/src/**` (7,285 lines), `backend/app/**`, `docker-compose.yml`, `start-native-windows.ps1`
**Date:** 2026-08-03 · working tree
**Baseline:** `UI-REVIEW-2026-07-30.md`, `A11Y-AUDIT-2026-08-03.md`, `SECURITY-REVIEW-2026-08-03.md`
**Method:** source re-audit against the prior finding set. Contrast and ΔE computed from tokens (exact); focus order and screen-reader output still need live verification.

---

## Verdict

**Most of the previous report landed, and landed properly.** The JWT secret, WebSocket authentication, CORS, login rate limiting and the default admin account are all genuinely fixed — not papered over. The button-colour regression was fixed the durable way (scoped selectors) rather than per-site. The public status page gained everything it was missing.

Three things need attention:

1. **F3 is 90% fixed, and the last 10% reopens it.** `to_dict()` redacts secrets correctly, but three routes bypass `to_dict()` entirely and return raw credentials to viewer-role users.
2. **The status pill fix traded light mode for dark.** Light went 1.93 → 4.43 (good); dark went 6.22 → 3.23 (now below AA).
3. **React performance is untouched** and the surface it has to cover keeps growing — 2,663 lines and 54 hooks in one component, with three memoization calls in the entire frontend.

---

## Landed and verified ✓

### Security

| Finding | Fix | Evidence |
|---|---|---|
| **F1** JWT secret committed | Env var now required; process refuses to boot without it. Compose uses `${JWT_SECRET:?...}`; native script auto-generates per session | `security.py:15–17`, `docker-compose.yml:50`, `start-native-windows.ps1:38–41` |
| **F2** Unauthenticated WebSocket | Token read from query params, decoded and validated **before** `accept()`, closes 1008 on failure | `main.py:254–266` |
| **F6** CORS wildcard | Replaced with `_allowed_origins` allowlist | `main.py:223` |
| **F7** No login rate limiting | 5 attempts / 15 min per IP | `auth.py:21` |
| **F8** Default admin password | `SNOOMP_ADMIN_PASSWORD` or `secrets.token_urlsafe(16)`; no longer logged | `main.py:176` |
| **F3** Credential exposure | `_SECRET_KEYS` frozenset + redaction sentinel in `to_dict()`; PUT merges so a redacted value means "unchanged" | `target.py:23–57`, `targets.py:103–110` |

The `config_json_raw()` accessor with its "never for API" docstring is a good pattern — it makes the safe path the default and the unsafe path explicit.

### UI / UX

- **Button colour inheritance** — fixed correctly. `button {}` is now a bare reset (`color: inherit`), and the styled treatment moved to `button.btn-primary, button[type="submit"]`, `.secondary`, `.danger`. This kills the whole class of bug rather than one instance.
- **Public status page** — every gap closed: `{data.name || 'System Status'}` fallback, `lastUpdated` display, `setInterval` polling, and both `uptime_24h` and `recent_heartbeats` now rendered.
- **Non-semantic controls** — down to 2, both legitimate modal-overlay backdrop handlers.
- **ARIA** — 38 attributes, up from 18.
- **Focus traps** — implemented in `MonitorModal`, `BatchEditModal`, `UserPreferencesModal` (first-element focus + Tab/Shift-Tab wrap).
- **Live region** — `role="status"` + `aria-live="polite"` on the connection pill (`App.tsx:937–938`).

---

## Open — critical

### R1 — `config_json` secrets still reachable on three routes

**Files:** `backend/app/routes/targets.py:52`, `:59`, `:88` · reopens **F3**

`to_dict()` redacts correctly, and `GET /api/targets` is safe because `compile_initial_data` calls `t.to_dict()` (`main.py:49`). But three routes return the **ORM object** with `response_model=TargetResponse`:

```python
@router.get("/{target_id}", response_model=TargetResponse, dependencies=[Depends(require_viewer)])
def get_target(target_id: str, db: Session = Depends(get_db)):
    ...
    return target          # ← Pydantic reads target.config_json, the raw column
```

`TargetResponse` declares `config_json: Dict[str, Any]` with `from_attributes = True`, so Pydantic reads the attribute directly and never touches `to_dict()`. The redaction is bypassed.

**Impact.** Unchanged from F3. A viewer calls `GET /api/targets` to harvest IDs — that response is redacted, so it looks safe — then iterates `GET /api/targets/{id}` and receives plaintext SSH passwords, private keys, SNMP communities and database URIs. `POST` and `PUT` echo the same raw values back in their responses.

This is the more dangerous shape of the original bug, because the list endpoint now *looks* correct.

**Fix.** Make redaction structural rather than something a route can forget:

```python
@router.get("/{target_id}", dependencies=[Depends(require_viewer)])
def get_target(target_id: str, db: Session = Depends(get_db)):
    target = db.query(Target).filter(Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target monitor not found")
    return target.to_dict()          # drop response_model, or add a field_validator
```

Apply to all three. Then add a test asserting no response body contains a known secret value — this is exactly the regression that will otherwise return.

---

## Open — serious

### R2 — Status pill fix inverted the contrast problem

**File:** `App.tsx:930–950`

The hardcoded Tailwind hexes were correctly replaced with `var(--color-up / --color-warning / --color-down)`. But the tinted background is now 15% of the *same hue* as the text, which raises background luminance in dark mode and compresses contrast:

| State | Dark before | Dark now | Light before | Light now |
|---|---|---|---|---|
| `LIVE` | 6.22 ✓ | **3.23** ✗ | 2.02 ✗ | **4.52** ✓ |
| `RECONNECTING` | 6.55 ✓ | 5.38 ✓ | 1.93 ✗ | **4.43** ✓ |
| `OFFLINE` | 4.10 ✓ | **3.34** ✗ | 3.16 ✗ | **3.88** ✗ |

Light mode is now good. Dark `LIVE` and `OFFLINE` dropped below AA for 11px text, and light `OFFLINE` is still short.

**Fix.** Decouple the tint from the text hue — drop the background to ~8% in dark, or use a neutral `--surface-raised` tint with the status colour carried by the text and dot alone. Same-hue tints will keep fighting the text at any alpha.

### R3 — Focus is trapped but never restored

**Files:** `MonitorModal.tsx:413–429`, `BatchEditModal.tsx:96–112`, `UserPreferencesModal.tsx:90–106`

The traps are correct — first focusable element receives focus, Tab wraps at both ends. There is no counterpart on close: no stored trigger element, no `.focus()` on unmount. A keyboard user who opens "Add New Monitor", cancels, and presses Tab lands at the top of the document rather than back on the button they pressed.

The two `App.tsx` modals (`:2289` status page, `:2435` report) have `role="dialog"` but no trap at all.

Also still absent everywhere: `inert` on the app root. `aria-modal="true"` claims the background is inaccessible while the DOM still allows Tab into it.

**Fix.** Fold trap + restore + `inert` into one `<Dialog>` primitive and use it in all five places. Storing `document.activeElement` on open and restoring in the cleanup is about six lines.

---

## Open — moderate

- **`--surface-raised` is still defined only in `[data-theme="light"]`** (`dashboard.css:84`) and still has **zero usages**. Meanwhile 44 hardcoded `rgba(255,255,255,0.02–0.05)` backgrounds remain (App 9, MonitorModal 8, BatchEditModal 2, UserPreferencesModal 2, CSS 23), each invisible in light mode. The token exists but the migration never happened — and when it does, dark mode will break, because `var(--surface-raised)` resolves to nothing there. Define it in `:root` **before** migrating.
- **12 `alert()` calls** remain (App 8, MonitorModal 2, UserPreferencesModal 2). The live region exists now on the pill; extend the pattern to a toast and retire these.
- **`htmlFor` appears 6 times** across 7,285 lines — 2 each in MonitorModal, BatchEditModal, UserPreferencesModal, and **0 in App.tsx**. The login form, both search inputs and the group-by select are still unlabelled.
- **Still one layout media query** (`dashboard.css:1108`, and it only hides login art). No mobile layout; `.app-layout` remains `100vw` with a fixed 280px sidebar. WCAG 1.4.10 Reflow, unchanged.
- **Two non-lazy `localStorage` reads** in `useState(...)` argument position (`App.tsx:83`, `:99`) — executed every render, result discarded after mount.

---

## React & performance

Essentially unchanged since the first review, while the code it needs to cover grew ~10%.

| Metric | Prior | Now |
|---|---|---|
| `App.tsx` lines | 2,623 | **2,663** |
| Hooks in `App` | 54 | **54** |
| `memo` / `useMemo` / `useCallback` / `lazy` — whole frontend | 1 | **3** |
| `React.lazy` / `Suspense` | 0 | **0** |

- `rerender-memo` — one component holding 54 hooks means every WebSocket frame re-renders the navbar, both filter rows, every monitor row and its 20–30 heartbeat bars, all five modals and both charts. Extracting a memoized `MonitorRow` keyed on `id`/`status`/`response_time_ms` is still the single highest-value change, and it gets harder every week.
- `bundle-dynamic-imports` — `recharts` (~150 KB gz) is statically imported in `App.tsx:2` and `ExecutiveDashboard.tsx:3`; five modals are eagerly imported. All of it ships in the bundle that renders the login form.
- `bundle-barrel-imports` — `lucide-react` barrel imports across five files, now including `UserPreferencesModal` with 19 icons on one line.
- `js-cache-storage` — `App.tsx:83`, `:99`.
- `rendering-content-visibility` — sidebar and Infrastructure Overview still map unbounded arrays.
- **URL state** — `view`, `selectedMonitor`, both tag filters, `searchTerm`, `groupBy`, `isBatchMode` all `useState`. No deep links, no back button, no shareable link to a failing monitor.

The debounced stats refetch and the reconnect logic from last round are both still correct and in place. Those were the two CRITICAL-tier items; what remains is MEDIUM-tier but compounding.

---

## Open — data integrity and visual design (monitor detail, database type)

Reviewed against a live dark-mode screenshot of `MIS PROD DB`. These are separate from the accessibility findings above and mostly concern whether the screen tells the truth.

### R4 — Database metrics are system metrics wearing database labels

**Files:** `App.tsx:1627`, `:1628`, `:1761–1763` · **highest-severity item in this section**

```tsx
<RadialGauge value={sm.metrics.mem_percent}  label="Connections"  sublabel="active clients" />
<RadialGauge value={sm.metrics.disk_percent} label="Cache Hit %"  sublabel="buffer ratio" inverseColor />
```

Memory percent is rendered as "Connections". Disk percent is rendered as "Cache Hit %". The 24h chart does the same thing — `dataKey="cpu"` is labelled "Throughput/Ops", `dataKey="mem"` becomes "Connections", `dataKey="disk"` becomes "Cache Hit / Ratio".

The whole Database Metrics block is the SSH/system-metrics component with database captions applied. The numbers are real, they just do not measure what the label claims.

**This is visible on screen right now.** The Connections gauge reads **54%** while the Engine Diagnostics panel three hundred pixels below — which queries `pg_stat_activity` properly — reads **47 / 250**, or 18.8%. Two cards labelled "Connections" on one screen, disagreeing by a factor of three.

Cache Hit shows a flawless **100%** for the same reason: it is disk-usage percent, not a buffer ratio.

**Why it matters more than the styling issues.** An operator who trusts "Cache Hit 100%" will not investigate a cache problem. An operator who sees "Connections 54%" may act on a pool that is actually at 19%. A monitoring tool that displays plausible-but-wrong numbers is worse than one that displays nothing, because nothing prompts a second look.

**Fix.** The backend already collects the right values — `active_connections`, `max_connections`, `cache_hit_ratio` are present in the Engine Diagnostics payload. Feed the gauges from those fields, or remove the gauges and let Engine Diagnostics be the single source. Do not ship both.

### R5 — The same metric is presented twice with different values

`Total Server Size — 1.4 GB / 21 databases` (Database Metrics) and `Total Size — 1.4 GB / 21 databases` (Engine Diagnostics) are the same card rendered twice, roughly 400px apart, differing only in label casing. "Connections" appears twice with the conflict described in R4.

Pick one home for each metric. Database Metrics and Engine Diagnostics currently overlap without a stated division of labour — one reads like a summary and the other like detail, but they duplicate rather than nest.

### R6 — The 24h chart is unreadable and mixes incompatible units

**File:** `App.tsx:1758–1763`

Four separate problems compound:

- **~40 x-axis labels.** `<XAxis dataKey="time">` has no `interval`, so recharts renders every tick it can fit: `11:35PM 12:08AM 12:42AM 01:15AM …` across the full width. Set `interval="preserveStartEnd"` with `minTickGap={40}`, or format to ~6 ticks.
- **Three unit types on one unlabelled axis.** `domain={[0, 'auto']}` with no `unit` plots a rate (queries/sec), a count (connections) and a percentage (cache hit) against the same 0–120 scale. 47 connections and 100% cache hit are not comparable quantities and should not share an axis. Use a second Y-axis for the percentage, or split into two charts.
- **The loudest element carries the least information.** The magenta "Cache / Storage Ratio" series is pinned flat at 100 for the entire window, and its area fill washes the full chart — the most visually dominant thing on the page is a constant. Flat series should render as a thin reference line, not a filled area.
- **`Queries/Ops` is effectively invisible**, flat near zero at this scale, which is itself a consequence of the shared axis.

### R7 — Uptime badge and heartbeat strip appear to contradict each other

In the sidebar, `Dev_Master`, `Dev_Settlement` and `Dev_PPD` show a red **54.0%** badge directly above a heartbeat strip that is entirely green.

Not a bug: the badge is `uptime_24h` while the strip is `recent_heartbeats.slice(0, 30)` — at a 60s interval that is the last 30 minutes. Both are correct for their own window.

But they sit adjacent with no indication that they cover different periods, so the pair reads as broken data — which costs trust in exactly the component operators scan fastest. Either label the windows (`24h` on the badge, `30m` on the strip), or make the strip cover 24h by sampling.

### R8 — Smaller visual inconsistencies

- **Engine Diagnostics uses four arbitrary accent colours** — blue for size, green for connections, purple for shared buffers, amber for uptime. None encodes anything; storage is not "blue" and uptime is not "amber". Elsewhere the palette is disciplined and reserves colour for state. Use `--text-primary` for all four and let colour keep meaning something.
- **The tab bar is disproportionate.** The active "Slow & Idle Queries (25)" tab renders as a saturated full-width primary-blue bar occupying ~60% of the container, while "Databases (21)" is plain text. It reads as a call-to-action rather than a tab. Give both tabs equal weight and mark selection with a subtle background plus `aria-selected`.
- **"Slow & Idle Queries" conflates two different conditions.** A slow query and an idle connection are unrelated problems with unrelated remedies. The screenshot shows a row with state `idle` and duration `1422h 37m` — 59 days — presented as a slow query. Split into two tabs, or rename to "Active sessions" and let the `state` column do the work.
- **The third metric card is mostly empty.** Two circular gauges sit beside a rectangle roughly twice their width containing one number. Either give it a visual of its own or move it into Engine Diagnostics (see R5).
- **Client IP is styled in accent blue** in the query table, which reads as a link but is not interactive. Reserve accent for actionable text.
- **The heartbeat timeline has no time axis** — only "← Oldest" and "Latest →". It is the best element on the page and the one place a hover readout of timestamp, latency and error would pay for itself.

### R4–R8 priority

R4 belongs in **P0** — it is a correctness problem visible to users, not a polish item. R5 and R6 belong in **P1**; a 24h chart nobody can read is a feature that is not shipping. R7 and R8 are **P2**.

---

## Priority

**P0 — reopens a critical finding / displays false data**
1. Redact `config_json` on `GET /api/targets/{id}`, `POST`, `PUT` (R1). Add a test asserting no response body contains a secret.
2. Feed the database gauges from real database fields, or delete them (R4). Two cards labelled "Connections" currently disagree by 3×.

**P1 — regressions, access blockers, unusable features**
3. Decouple the pill tint from the text hue; verify all six state × theme combinations (R2).
4. Add focus restore and `inert` to the three existing traps; extend to the two `App.tsx` modals (R3).
5. Fix the 24h chart: tick interval, separate axes for percentage vs count, reference line for flat series (R6).
6. Resolve the duplicated Total Size / Connections cards — one home per metric (R5).
7. Define `--surface-raised` in `:root`, then migrate the 44 literals.

**P2 — carried forward**
8. Label the windows on the uptime badge and heartbeat strip (R7).
9. Engine Diagnostics colour discipline; tab-bar weight; split slow vs idle (R8).
10. `<Field>` primitive for label association; `<Toast>` to retire the 12 `alert()` calls.
11. Extract and memoize `MonitorRow`; lazy-load `recharts` and the modals.
12. Mobile layout.
13. Router + URL state.

**Preventive — highest leverage on this list**
- `eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks` in CI.
- A lint rule rejecting hex and `rgba()` inside `style={{}}` — R2, the 44 literals and the original pill bug all share that root cause.
- `gitleaks`, `pip-audit`, `npm audit` as blocking steps.
- A response-body test for secret values (see R1).

---

## Note on the pattern

Three of the four issues in this round were introduced by fixes to the previous round: the pill contrast inverted, the redaction was added to `to_dict()` but not to the routes that bypass it, and `--surface-raised` was defined in one theme only. None is careless — each is the last mile of an otherwise correct change.

That is what the preventive controls are for. A test asserting "no API response contains a secret" would have caught R1; a contrast check in CI would have caught R2. Both are cheaper than another audit round.
