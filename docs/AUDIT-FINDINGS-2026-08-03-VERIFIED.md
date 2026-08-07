# Verification of "Snoomp Enterprise — Audit Findings Report"

**Source document:** `audit_findings.md` (Antigravity/Gemini, dated August 3 2026, target v0.2.1)
**Verified against:** working tree at `d:/Project/snoomp`, 2026-08-03
**Method:** each claim checked directly against source. No claim accepted on the report's word.

**Result: 3 of 5 findings confirmed, 1 materially overstated, 1 factually wrong.** Two of the confirmed findings carry a recommended action that would break the build if applied as written. The end-to-end browser section describes navigation this application cannot perform.

Fix #1 first — it is real, severe, and currently shipping.

---

## Verdict table

| # | Claim | Verdict |
|---|---|---|
| 1 | React Hook Exception crashes MonitorModal | **Confirmed** — real and severe. Counts and stack trace are wrong |
| 2 | 150+ lines of duplicated CSV templates | **Overstated** — real duplication is ~64 lines; realistic saving ~35–40 |
| 3 | TimescaleDB extension runs on SQLite | **Confirmed** — but the prescribed fix would break production |
| 4 | `passlib[bcrypt]` is removable | **Confirmed, and understated** — but the prescribed fix breaks auth |
| 5 | Passive push UI is speculative, receiver unbuilt | **False** — the receiver exists; acting on this deletes a working feature |

---

## 1. React Hook Exception — CONFIRMED ✅

The most important finding in the report, and it is correct.

`frontend/src/components/MonitorModal.tsx:277` places `if (!isOpen) return null;` between two hooks:

```
line  20–55   27 × useState + 1 × useRef        = 28 hooks
line  206     useEffect                          = 29 hooks
line  277     if (!isOpen) return null;   ← conditional early return
line  482     React.useEffect (Escape listener)  = 30th hook
```

`App.tsx` mounts `<MonitorModal>` unconditionally, so the component first renders with `isOpen={false}` and commits **29** hooks. Clicking "Add New Monitor" flips `isOpen` to `true`, the render proceeds past line 277 and reaches a **30th** hook. React throws `Rendered more hooks than during the previous render`, the tree unmounts, and the user gets a blank screen.

This is reproducible, blocks the app's primary write path, and is in the current tree.

**Corrections to the report:**
- Hook counts are **29 → 30**, not "27 state hooks → 28". The report undercounts by two.
- The quoted stack trace cites `MonitorModal.tsx:450:9`. Line 450 is inside `handleSubmit`, unrelated to hook dispatch. The trace appears fabricated or copied from an earlier build; it should not be cited as evidence.

**Origin.** This was introduced by the v0.2.1 accessibility work. The Escape-key handler is a correct response to finding C3 in `UI-REVIEW-2026-07-30.md` — it was simply placed below the early return instead of above it. An accessibility fix created a crash.

**Fix.** Move the guard to immediately precede the JSX return, so every hook runs on every render:

```tsx
React.useEffect(() => {
  if (!isOpen) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [isOpen, onClose]);

if (!isOpen) return null;   // now the last statement before `return (`
```

Note the added `isOpen` guard and dependency — without it the modal would swallow Escape while closed.

**Prevention.** `eslint-plugin-react-hooks` catches this class of bug statically. It was already recommended for CI in the UI review; this incident is the argument for it.

---

## 2. Duplicated CSV templates — OVERSTATED ⚠️

The duplication is real but the report's arithmetic is not.

The cited range `MonitorModal.tsx:57-204` is 148 lines, but it spans three functions, only two of which duplicate anything:

| Function | Lines | Duplicated? |
|---|---|---|
| `getCsvFormatText()` | 57–69 (13) | yes — switch over `type` |
| `handleCsvBulkImport()` | 71–153 (83) | **no** — this is the CSV parser, not a template |
| `handleDownloadSampleCsv()` | 154–204 (51) | yes — switch over `type` |

Genuine duplication is the two switch statements, **64 lines**, and the two switches encode related-but-different data (a format description string vs. a header row plus sample row). Collapsing both into one config object keyed by monitor type is worthwhile and would save roughly **35–40 lines**, not "150+".

A third switch inside `handleCsvBulkImport` (lines 102–141) branches on the same `type` values to assign column positions. Folding that into the same config object — giving each type one entry with `columns`, `headers`, `sample` and `description` — is the actually valuable refactor, and it would also fix the fragile positional parsing flagged separately in the UI review (`line.split(',')` corrupts any quoted field or comma-bearing password).

---

## 3. TimescaleDB extension on SQLite — CONFIRMED ✅, fix is wrong ⚠️

`backend/app/database.py` runs, inside `init_db()`, with no dialect check:

```python
db.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"))
db.execute(text("SELECT create_hypertable('system_metrics', 'checked_at', if_not_exists => TRUE);"))
```

Both are PostgreSQL-only. Under the native-Windows deployment (`CONTEXT.md` §4 Mode B, `sqlite:///./backend/snoomp.db`) both raise, get caught by the broad `except Exception`, and log a warning on every start. The finding is valid: it is dead work plus a misleading warning in a supported deployment mode.

**The prescribed action is unsafe.** The report says "remove redundant `CREATE EXTENSION` execution". Removing it breaks Mode A — the Docker/TimescaleDB stack that is the production deployment, and the reason `system_metrics` is a hypertable at all.

**Correct fix** — guard rather than delete:

```python
if engine.dialect.name == "postgresql":
    # existing TimescaleDB block
```

Net change is roughly +1 line, not a code reduction. While there, narrow the bare `except Exception` so a genuine Postgres failure is not silently downgraded to a warning.

---

## 4. `passlib[bcrypt]` dependency — CONFIRMED ✅ and understated, fix is wrong ⚠️

Stronger than the report claims. `passlib` is not imported anywhere in the application:

- `backend/requirements.txt:12` — `passlib[bcrypt]>=1.7.4`
- `backend/app/auth/security.py:6` — `import bcrypt`
- `:23`, `:28`, `:29` — `bcrypt.checkpw`, `bcrypt.gensalt`, `bcrypt.hashpw`

There is no `CryptContext` and no passlib usage at all. This is not "an abstraction to remove" — the migration to direct `bcrypt` already happened and the requirement was left behind. It is a straightforwardly unused dependency.

**Two corrections:**

1. **Removing the line as written breaks authentication.** `bcrypt` is currently pulled in only as the `[bcrypt]` extra of passlib. Deleting line 12 removes the sole declared source of the package `security.py` imports at module load. The change must be a swap, not a deletion:
   ```diff
   - passlib[bcrypt]>=1.7.4
   + bcrypt>=4.1.0
   ```
2. **"use direct bcrypt / FastAPI password hashing functions" is incorrect** — FastAPI provides no password hashing. It ships OAuth2 form and security dependencies only. Hashing is entirely the application's responsibility, which is what `security.py` already does.

Worth noting for whoever applies this: pinning `bcrypt>=4.1.0` explicitly also avoids the known passlib 1.7.4 / bcrypt 4.x version-detection breakage, so this change is a small robustness win beyond the dependency count.

---

## 5. Speculative passive push monitor UI — FALSE ❌

**Do not act on this finding.** Its stated premise is incorrect and applying it would delete a working feature.

The report claims the "background HTTP receiver endpoint remains unbuilt". It is built and wired end to end:

- `backend/app/routes/dashboard.py:125` — `@router.api_route("/push/{target_id}", methods=["GET", "POST"])`
- `:126` — `def receive_push_heartbeat(...)`
- `:132` — validates the target exists, is enabled, and is of type `push`
- `:139` — records the heartbeat with `{"push_received": True}`
- `backend/app/routes/targets.py:23` — `push` is in the accepted-type pattern
- `backend/app/models/target.py:12` — `push` is a documented target type
- `frontend/src/App.tsx` — the monitor detail view renders setup instructions with a live curl example against exactly this endpoint

The cited location is also wrong. `MonitorModal.tsx:138-140` is not "form fields" — it is the `type === 'push'` branch of the **CSV bulk-import parser**, assigning `host` and `check_interval` for imported rows.

Push monitoring is a shipped capability with backend, model, route, checker-type validation and frontend documentation. There is nothing speculative about it.

---

## 6. End-to-end browser section — methodology does not hold up ⚠️

The `PASS` rows should not be treated as evidence of working functionality, for two reasons.

**The routes described do not exist.** The report states it "navigated the full application lifecycle" through `/login`, `/`, `/executive` and `/status-pages`. Snoomp has no router. View state is `useState` in `App.tsx:102`:

```tsx
const [view, setView] = useState<'dashboard' | 'status-pages' | 'executive'>('dashboard');
```

The only path-driven branch is `App.tsx:540`, `pathname.startsWith('/status/')`, for public status pages. Requesting `/executive` or `/status-pages` serves the SPA and renders the **dashboard**, because `view` initialises to `'dashboard'` regardless of URL. Likewise `/login` is not a route — the login form is what `App` returns when `token` is null.

Whatever produced these rows either inferred them from component names or conflated in-app view switching with URL navigation. (This absence of URL state is itself finding 5.3 in the UI review.)

**A component is cited that does not exist.** The User Preferences row names `SettingsModal.tsx`. The file is `UserPreferencesModal.tsx`. No `SettingsModal` exists in the tree.

The critical `FAIL` row is nonetheless correct — see §1 — so the section is not worthless. But its passes are unverified, and a report that marks "Infrastructure Dashboard — real-time metrics render properly" as `PASS` while the app crashes on the primary write path deserves a second look before it is used as a release gate.

---

## 7. Corrected impact scoreboard

| Metric | Report claims | Verified |
|---|---|---|
| Net code reduction | ~180 lines | **~35–55 lines** |
| Dependencies removable | 1 | **1 swapped, not removed** (`passlib[bcrypt]` → `bcrypt`) |
| Critical crashes resolved | 1 | **1 — confirmed, and it is the headline** |
| Build stability | clean hooks across all modals | accurate once #1 lands |

The ~180-line figure does not survive checking. #2 yields ~35–40. #3 is roughly +1 line (a guard, not a deletion). #4 is net zero. #5 should not be actioned at all.

The report's real value is finding #1, which is worth more than the other four combined.

---

## 8. Recommended action order

1. **Fix the MonitorModal hook order** (§1). Ship today — the app cannot add or edit monitors.
2. **Add `eslint-plugin-react-hooks` to CI** so this cannot recur.
3. **Swap** `passlib[bcrypt]` → `bcrypt>=4.1.0` (§4). One line, verify login after.
4. **Guard** the TimescaleDB block with a dialect check (§3), and narrow the surrounding `except`.
5. **Consolidate the three CSV switches** into one type-keyed config (§2), and replace `split(',')` with a real parser while the file is open.
6. **Discard finding #5.** No action.
7. **Re-run E2E against real in-app navigation**, not assumed URLs, and re-check the PASS rows (§6).

---

## Cross-reference

Items 1, 2 and 6 overlap with `UI-REVIEW-2026-07-30.md`:

- The hook crash is the direct consequence of that review's finding **C3** (dialog Escape handling) being applied in the wrong position. Both documents should be read together when touching `MonitorModal.tsx`.
- The CSV parser fragility is Part 2, "CSV import robustness" — unbounded concurrent POSTs, `Promise.all` discarding partial results, and silent row skipping remain open.
- The absent routing is Part 5.3, still open and still the highest-value structural fix.

Also still open and **not** covered by this audit: the WebSocket reconnection listed as shipped in the v0.2.1 changelog is not present in the code. See the verification pass in `UI-REVIEW-2026-07-30.md`.
