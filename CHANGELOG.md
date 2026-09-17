# Changelog

All notable changes to Snoomp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-09-17

### Fixed
- **System Uptime Normalization & Formatting (`ssh.py`, `utilization_report.py`, `App.tsx`):**
  - **SSH Checker Uptime Command & Output Parsing:** Updated SSH checker metric gathering command to prefer `(uptime -p 2>/dev/null || uptime)`. Replaced dumping raw standard `uptime` output lines (which previously included server time-of-day clock timestamps, user counts, and load averages) with `parse_uptime_str()`.
  - **SNMP-Aligned Output Format:** Uptime values are now normalized to simple, human-readable strings (`X days, Y hours` or pretty uptime `up 1 week, 23 hours, 27 minutes`) matching the clean convention of SNMP monitors.
  - **Frontend Regex Demangling:** Replaced fragile frontend regex replacements in `App.tsx` with a robust `formatUptime()` parser, preventing mangled clock timestamp prefixes (e.g. `8 hours, 55 minutes:09 up 209 days...`) in dashboard metric cards and utilization dialogs.
  - **Database Historical Backfill:** Sanitized and normalized existing historical uptime records in `SystemMetrics` and check results.

## [1.4.2] - 2026-09-16

### Fixed
- **Anti-Slop Audit 002 & Backend Resilience (`websockets.py`, `dashboard.py`, `targets.py`, `ssh.py`, `http.py`):**
  - **Push Monitor 500 NameError:** Added unified `publish_update` helper in `app/websockets.py` with safe synchronous Redis pub/sub client and in-memory fallback. Fixed HTTP 500 error in `receive_push_heartbeat` (`app/routes/dashboard.py`) caused by uninstantiated `redis_client`.
  - **Target Reload Event Broadcasting:** Fixed silent failure in `app/routes/targets.py` during target creation, update, and deletion, restoring WebSocket `{"type": "reload"}` signals so client browsers refresh without manual reloads.
  - **SSH Multi-Worker CPU Utilization Cache:** Added missing `import redis` in `app/checkers/ssh.py`, resolving `NameError` and restoring multi-worker shared delta CPU calculation across check intervals.
  - **Anti-Slop Copywriting Hard Gate (`R-02`):** Removed raw em dashes (`—`) from operator UI text in `UserPreferencesModal.tsx` and `ErrorBoundary.tsx`.
  - **IPv6 Pre-Flight Socket Probes:** Updated socket inspection in `app/checkers/http.py` to dynamically detect address family (`AF_INET` / `AF_INET6`), eliminating probe socket errors on IPv6 endpoints. Replaced deprecated `datetime.utcnow()` with timezone-aware UTC datetime.
  - **Architecture Import Cleanup:** Replaced circular re-export import `from app.main import compile_initial_data` with direct `from app.services.dashboard import compile_initial_data` in `app/routes/targets.py`.
- **Ponytail Repo Optimization:**
  - Removed dead in-process WebSocket broadcast fallback in Celery worker task (`worker/tasks.py`).
  - Deleted obsolete 1-line empty stylesheet `frontend/src/styles/theme.css` and its unreferenced import in `main.tsx`.
  - Removed legacy SQLite database file `backend/snoomp.db` from repository.
- **SNMP Checker Multi-Core CPU Discovery Bug (`backend/app/checkers/snmp.py`, `backend/tests/test_snmp_checker.py`):**
  - Fixed an issue where the SNMP monitor and dashboard always reported all SNMP targets as having `1 Core` regardless of actual server hardware specifications.
  - Resolved PySNMP type error in `hrProcessorLoad` table traversal where `varBind[0]` returned an `ObjectType` instance instead of an `ObjectIdentity`. Passing `ObjectType(varBind[0])` raised an unhandled `SmiError` on the second iteration, which caused the checker exception handler to silently fall back to `cores = 1`.
  - Upgraded CPU core discovery to use fast asynchronous SNMP `bulkCmd` (GETBULK) querying `1.3.6.1.2.1.25.3.3.1.2` with up to 64 repetitions in a single network round-trip, drastically accelerating polling speed while eliminating worker pool starvation.
  - Implemented multi-tier fallback mechanism: clean string-based OID extraction for `nextCmd` (GETNEXT), followed by `hrDeviceProcessor` entry counting in `hrDeviceTable` (`1.3.6.1.2.1.25.3.2.1.2`) if load tables are inaccessible.
- **Storage Partition Telemetry & PDF Report Generation (`backend/app/checkers/ssh.py`, `backend/app/services/utilization_report.py`, `backend/app/reports/pdf.py`, `frontend/src/App.tsx`):**
  - **Used Space & Utilization Display Bug:** Fixed issue where the PDF report's "Storage partitions" table rendered all partitions with `0.0%` utilization and `—` for used space. Resolved property key mismatch where the SSH checker produced `used_percent` while the reporting service expected `use_pct`.
  - **Dynamic Fallback Calculation:** Partition extraction in `utilization_report.py` now accepts `use_pct`, `percent`, or `used_percent` and dynamically computes `used_gb` (`size_gb * (use_pct / 100)`) when not explicitly stored, guaranteeing accurate metrics for all legacy and active heartbeats.
  - **Sub-Gigabyte Partition Precision:** Fixed truncation where small mounts (e.g. `/run/lock` under 100 MB) rounded to `0.0` and evaluated to `None` via falsy operators, displaying `—`. Added `_fmt_storage` helper in `pdf.py` which formats values into clean MB units (e.g. `5 MB`, `154 MB`) or `< 100 MB` when small.
  - **POSIX `df -h -P` Parsing:** Added `_parse_df_size_to_gb` to parse both total size and used size columns directly from POSIX `df` output across Linux and Windows hosts.
  - **Frontend Volume Breakdown:** Updated volume cards in `App.tsx` to handle `0.0` used space and utilization values cleanly without dropping to empty dashes or omitting used space.
  - **Multi-Page PDF LayoutError (500 Error):** Fixed 500 Internal Server Error occurring when generating 7-day reports (`hours=168`) with multi-page table overflow. In two-pass ReportLab rendering, flowables postponed to page 2 retained `_postponed = 1` from pass 1 across shallow copies, triggering `LayoutError` on pass 2. Resolved by isolating passes with deep copies and clearing deferred pagination flags.

## [1.4.1] - 2026-09-16

### Changed
- **Unified Two-Tone SVG Icon Buttons (`frontend/src/components/IconButton.tsx` & `frontend/src/styles/dashboard.css`):**
  - Standardized all icon buttons across the application (monitor detail header, status pages, modal close triggers, and tag management) using a new reusable `IconButton` component and `.icon-btn` design system tokens.
  - Implemented semantic two-tone SVG iconography (Tone 1: solid crisp stroke in `currentColor`; Tone 2: translucent `fill-opacity: 0.18` fill for enclosed geometry).
  - Added semantic color-coded variants (`accent`, `success`, `danger`, `warning`, `purple`, `cyan`, `neutral`) with matching soft translucent button surfaces and subtle glowing hover borders.
  - Replaced ad-hoc inline styles and inconsistent Unicode `✕` characters in modals (`MonitorModal`, `StatusPageModal`, `ReportModal`, `UserPreferencesModal`, `UpdateModal`, `NotificationDialog`, `BatchEditModal`) with accessible, keyboard-operable SVG icon buttons.
  - Maintained full WCAG AA contrast standards across both Light and Dark themes, with strict adherence to Anti-Slop UI guidelines.

## [1.4.0] - 2026-09-16

### Added
- **Metric Utilization Report Feature:**
  - **Server-Side Metrics Aggregation (`backend/app/services/utilization_report.py` & `backend/app/routes/dashboard.py`):** Added `GET /api/dashboard/targets/{target_id}/utilization-report` endpoint aggregating telemetry from `SystemMetrics`. Computes statistical figures (Current, Average, Minimum, Peak/Max, 95th Percentile) for CPU, Memory, and Disk volumes, evaluates storage partition allocations, tracks peak occurrence timestamps, downsamples trend intervals, and diagnoses capacity saturation thresholds (> 80% warning, > 90% critical).
  - **Server-Side PDF Utilization Report Generator (`backend/app/reports/pdf.py` & `backend/app/routes/reports.py`):** Added `GET /api/reports/targets/{target_id}/utilization.pdf` endpoint generating print-ready ReportLab documents featuring a capacity verdict banner (Optimal Headroom, Elevated Load, Critical Saturation), executive KPI summary blocks, multi-resource sparkline trends with 80% threshold markers, detailed statistical metrics breakdown, filesystem volume tables, and high-utilization incident logs.
  - **Enhanced Multi-Tab Report Modal (`frontend/src/App.tsx` & `frontend/src/styles/dashboard.css`):** Upgraded the monitor report modal with a segmented tab switcher between "Availability & SLA" and "Metric Utilization". Provides an interactive preview of capacity status, resource metrics (Avg & Peak), volume breakdown, saturation counts, and direct one-click PDF downloads.
  - **Dedicated Toolbar Shortcut:** Added `<Activity />` quick-action button on monitor detail headers for instant 1-click access to the Metric Utilization Report.
  - **Anti-Slop & UI Invariant Compliance:** Designed with AAA light/dark theme contrast, tabular numerical alignment, zero emojis in source code, and full keyboard navigation (Escape modal dismissal, tab key focus indicators).

## [1.3.0] - 2026-09-09

### Added
- **Check for Update Feature:**
  - **Backend Release Checking (`backend/app/routes/system.py`):** Added `GET /api/system/check-updates` endpoint querying official GitHub releases (`ardhanata/snoomp`) with in-memory 15-minute TTL caching to respect rate limits, semver comparison logic, and custom upgrade instructions for Docker Compose and the Turnkey Linux installer.
  - **Interactive Software Updates Modal (`UpdateModal.tsx`):** Dedicated double-bezel modal displaying current version, latest version, update availability indicators, formatted release notes, and one-click copyable upgrade commands.
  - **Dashboard & Navigation Integration:** Added clickable interactive version badge in the sidebar footer with update indicator dots, a "Check for Updates" shortcut in the user profile avatar menu, and a dedicated "Updates" tab in User Preferences (`UserPreferencesModal.tsx`).
  - **Silent Background Detection:** Automatically inspects update status on dashboard load and signals when newer releases are published.

---

## [1.2.0] - 2026-09-07

### Added
- **Turnkey Linux Installer (`install.sh`):** Interactive and unattended automated installer with GitHub auto-bootstrap capability (`curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash`). Automatically clones the repository if run standalone, validates Docker Engine and Compose v2, auto-generates 48-byte cryptographic `JWT_SECRET` and `POSTGRES_PASSWORD`, configures network interfaces and `ALLOWED_ORIGINS`, launches the stack, and outputs initial admin credentials.
- **Remote Push Deployment (`scripts/deploy-remote.sh`):** Single-command deployment from administrator workstation directly to remote servers over SSH.
- **Self-Contained Deployment Packager (`scripts/package.sh`):** Builds standalone release bundles (`snoomp-deploy.tar.gz`) for offline and air-gapped environments.
- **Instance Migration Suite (`scripts/backup.sh` & `scripts/restore.sh`):** Automates full database dumps (including TimescaleDB hypertables) and configuration migration between servers.
- **Production Hardening (`deploy/`):** Added systemd unit file (`deploy/systemd/snoomp.service`), production Nginx reverse proxy template with WebSocket support (`deploy/nginx/snoomp.conf`), and Caddy configuration (`deploy/caddy/Caddyfile`).
- **Production Deployment Guide (`docs/DEPLOYMENT.md`):** Complete operations guide covering fresh installs, remote deployments, server migrations, SSL setups, and maintenance.

### Changed
- **Network Interface Binding (`docker-compose.yml` & `.env.example`):** Added `SNOOMP_BIND_IP` to support binding to `127.0.0.1` when operating behind reverse proxies.

---

## [1.1.1] - 2026-09-06

### Improved
- **Backup Export UX (`UserPreferencesModal.tsx`):** Clearly display file save destination, exact downloaded filename, and file size upon backup generation. Added pre-export save destination notice informing users that exports are delivered directly to their local machine's `Downloads` folder, alongside a keyboard shortcut prompt (`Ctrl + J` / `Cmd + Option + L`) to view the file.

---

## [1.1.0] - 2026-09-06

### Changed
- **Unified Containerized Architecture:** Switched to a multi-stage Docker build packaging both the compiled React SPA and FastAPI backend into a single container (`snoomp:local`), eliminating host-level Node.js dependencies and version drift.
- **Same-Origin Delivery:** Frontend is served directly by FastAPI from `/app/frontend_dist` with content-hashed assets marked as immutable and dynamic `index.html` cache suppression.
- **Database Upgrade:** Upgraded default database image to TimescaleDB PostgreSQL 16 (`timescale/timescaledb:2.17.2-pg16`) with strict parameter validation guards (`:?`).
- **Enhanced Network Capabilities:** Added `NET_RAW` capabilities to both API and worker containers for ICMP ping probing under non-root execution.

### Removed
- **Windows Host Runtime Scripts & Fallbacks:** Removed `start-windows.*`, `start-native-windows.*`, `deploy-frontend.ps1`, `scripts/{install,build-windows,update-snoomp}.ps1`, `backend/snoomp_server.py`, `backend/snoomp.spec`, and `frontend/Dockerfile`.
- **In-Process Fallbacks:** Removed SQLite engine fallback and silent threadpool scheduler fallback; Celery broker unavailability now fails explicitly.
- **UI Updater:** Removed `UpdateModal.tsx` and the `/api/system/check-updates` endpoint.

### Preserved
- **Windows Target Monitoring:** Retained OpenSSH PowerShell CIM queries (`Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`) in `backend/app/checkers/ssh.py` for monitoring remote Windows target servers.

---

## [1.0.0] - 2026-09-06

### Added
- **Automated 1-Click Dependency Provisioning (`scripts/install.ps1`):**
  - Automated installation of **PostgreSQL 15** via Windows Package Manager (`winget`) or direct unattended EnterpriseDB silent installer fallback with automatic database (`snoomp_db`) and role (`snoomp_admin`) provisioning.
  - Automated installation of native **Redis Windows Service** (`SnoompRedis` on TCP 6379) via `winget` or direct standalone pre-compiled binary distribution.
- **Smart Pre-Flight Network Engine (`scripts/install.ps1`):**
  - Automatic Hyper-V / Host Network Reserved Range collision detection (`netsh interface ipv4 show excludedportrange`).
  - Active listener detection and process inspection (`PID`, process name, executable path).
  - Pre-flight status table rendering with zero-friction auto-adoption of free port 8008 and automated conflict resolution.
- **GitHub Release Distribution:**
  - Published official standalone Windows executable distribution package (`snoomp-windows-x64.zip`) attached to GitHub Release `v1.0.0` for 1-liner native server installations (`irm https://raw.githubusercontent.com/ardhanata/snoomp/main/scripts/install.ps1 | iex`).

### Changed
- Graduated versioning scheme to SemVer `v1.0.0` (Enterprise GA Release) across frontend, backend API metadata, `VERSION`, and documentation.

---

## [0.3.1] - 2026-09-05

### Added
- **Windows Standalone Native Executable (`dist/snoomp-windows-x64`):** Packaged Snoomp into a standalone Windows binary (`snoomp.exe`) bundling FastAPI, Uvicorn, Celery, Psycopg2, PySNMP, AsyncSSH, and pre-compiled React SPA assets. Runs completely independently of Python or system dependencies.
- **Interactive PowerShell Installer (`scripts/install.ps1`):** Complete interactive one-liner deployment script (`irm https://<host>/install.ps1 | iex`):
  - **Port Collision Detection & Process Inspection:** Detects occupied ports, identifies conflicting process name/PID/path, and offers custom port choice, auto-assignment, or process termination.
  - **Full Production Enterprise Package:** Interactive configuration for TimescaleDB / PostgreSQL + Redis, pre-flight TCP verification handshakes, schema auto-initialization via `snoomp.exe --test-db`, and worker thread tuning.
  - **Zero-Dependency Fallback:** Embedded SQLite with automatic WAL mode and in-process asynchronous task scheduler.
  - **24/7 Windows Service:** Automated Windows Scheduled Task (`SnoompServer`) with automatic restart on failure and Windows Defender Firewall inbound rule creation.
  - **Management Helper Scripts:** Installs `status-snoomp.ps1`, `start-snoomp.ps1`, `stop-snoomp.ps1`, `restart-snoomp.ps1`, and `view-logs.ps1`.

### Fixed
- **SSH Checker Flapping & Handshake Timeouts (`backend/app/checkers/ssh.py`):** Added explicit `config=None` and `agent_path=None` to avoid Windows OpenSSH agent contention. Implemented immediate single-retry on handshake timeouts and increased default login timeout to 15s.
- **ICMP Ping Latency Masking (`backend/worker/tasks.py`):** Removed ping latency override on SSH checks that was disguising connection timeouts with 6ms ICMP roundtrips.

---

## [0.3.0] - 2026-08-07

### Added
- **E2E Testing Framework:** Integrated `testcontainers` for PostgreSQL and Redis to run fully isolated backend tests. Added 11 comprehensive tests covering Auth, Targets lifecycle, SSH Checkers, and WebSocket connectivity.

### Changed
- **Backend Architecture Decoupling:** Refactored the God-object `main.py` into dedicated modules. Extracted dashboard data aggregation into `app.services.dashboard` and realtime infrastructure into `app.websockets`. The core `main.py` now purely handles FastAPI orchestration and lifecycle management.

---

## [0.2.1] - 2026-07-30

### Fixed & Improved
- **Database 24h Time-Series Metrics Logging (`worker/tasks.py` & `App.tsx`):** Fixed database checker metric persistence bug. Database monitors (`db`, `mongodb`, `redis`) now save `queries_per_sec`, `ops_per_sec`, `active_connections`, and `cache_hit_ratio` into `system_metrics` time-series table, rendering 24h Database Performance charts accurately.
- **User Preferences Modal Mounting (`App.tsx`):** Mounted `<UserPreferencesModal>` in `App.tsx` so clicking "User Preferences" in profile menu opens the preferences dialog with full SLA, theme, sound, and check interval controls.
- **Stateful Delta `/proc/stat` CPU Calculation (`app/checkers/ssh.py`):** Replaced load-average estimate with stateful delta `/proc/stat` calculations stored in Redis (`ssh_cpustat:{target_id}`) matching `sar`/`nmon` Idle% precision.
- **UI & Accessibility Audit Compliance (`UI-REVIEW-2026-07-30.md`):** Resolved all 6 parts of the UI & Rev 3 audit:
  - **WebSocket Reconnection & Status Pill (`App.tsx`):** Added automatic exponential backoff WebSocket reconnection with live status badge (`LIVE` / `RECONNECTING` / `OFFLINE`) in top navbar and debounced stats fetching (1.5s window).
  - **Light Theme & Contrast Polish (`dashboard.css` & `App.tsx`):** Defined distinct light surfaces (`#E2E8F0` / `#F8FAFC` / `#F1F5F9` / `#FFFFFF`), elevated stat card backgrounds, boosted `--color-off` contrast to `4.8:1`, hardened chart gridlines with `var(--border)`, and tuned `--chart-2` contrast in light mode.
  - **Semantic Controls Sweep (`App.tsx` & `PublicStatusPage.tsx`):** Upgraded logo link, filter chips, monitor rows, group headers, and public status page accordions to keyboard-navigable `<button>` elements with `aria-pressed`, `aria-selected`, and `aria-expanded`.
  - **Modal Dialog Semantics (`MonitorModal.tsx`, `UserPreferencesModal.tsx`, `App.tsx`):** Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape key handlers, and backdrop dismissal across all modals.
  - **Unified Accent Palette (`App.tsx` & `UserPreferencesModal.tsx`):** Unified accent swatches across `App.tsx` and `UserPreferencesModal.tsx` (Azure Blue, Emerald Green, Cyan Tech, Purple Ray).
  - **Database Diagnostics Columns (`dashboard.py` & `App.tsx`):** Added `Client IP` and `App Name` columns to slow/idle queries table with scrollable query block and one-click copy.

---

## [0.2.0] - 2026-07-27

### Added
- **User SLA Preferences Modal (`UserPreferencesModal.tsx`):** Users can now configure custom SLA threshold preferences for **Normal Target (%)**, **Warning Threshold (%)**, and **Critical Threshold (%)**.
- **Dynamic SLA Classification:** Global Executive Availability SLA Scorecard, monitor detail badges, and uptime indicators now evaluate dynamically based on user SLA preferences stored in `localStorage`.
- **Expanded Multi-Disk Storage UI:** Dedicated Attached Storage & Volume Breakdown panel displaying Mounts (`/`, `/u01`, `/data`, `/mnt/nfs`), NFS badges, progress bars, and device paths.
- **Windows Host & Platform Compatibility:** Added Windows OpenSSH & PowerShell CIM metric query fallback to `backend/app/checkers/ssh.py` (queries `Win32_OperatingSystem`, `Win32_Processor`, and `Win32_LogicalDisk`). Created [`start-windows.ps1`](file:///d:/Project/snoomp/start-windows.ps1) and [`start-windows.bat`](file:///d:/Project/snoomp/start-windows.bat) for one-click deployment on Windows hosts.
- **Standalone Native Windows Deployment (No Docker Required):** Added native SQLite engine support in `backend/app/database.py` and threadpool job execution fallback in `backend/app/scheduler/runner.py`. Created [`start-native-windows.ps1`](file:///d:/Project/snoomp/start-native-windows.ps1) and [`start-native-windows.bat`](file:///d:/Project/snoomp/start-native-windows.bat) to run Snoomp directly on Windows with Python + Node.js without requiring Docker Desktop.

---

## [0.1.1] - 2026-07-26

### Added
- **Multi-Disk & NFS SSH Monitoring:** Updated SSH metric gathering command to `df -h -P -x tmpfs -x devtmpfs -x squashfs -x overlay`. Snoomp now captures all physical, SAN, and NFS mount points (e.g. `/u01`, `/data`, `/mnt/nfs`).
- **Disk Alert Evaluation:** Overall system disk usage percentage is now calculated as the maximum usage percentage across all mounted disks so any full partition triggers alert status.
- **System Versioning:** Added `/api/version` endpoint and `v0.1.1` badge display across frontend UI footer.

### Changed
- **Scheduler Check Interval Synchronization:** Verified that target checks execute precisely according to user-configured `check_interval` (seconds).
- **Diagnostics Isolation:** Isolated live engine diagnostic requests to user manual trigger and initial selection, preventing unneeded polling loop overhead.

---

## [0.1.0-patch1] - 2026-07-26

### Fixed
- **DB Engine Query Storm:** Removed `monitors` from the React `useEffect` dependency array in `App.tsx`. Fixed bug where WebSocket status updates caused 1-second DB engine query loops on target databases.
- **Frontend Syntax & Style Errors:** Resolved missing `TrendingUp` import and corrected `justifyContent` style property in `PublicStatusPage.tsx`.

### Added
- **Executive Command Center:** Added full-bleed widescreen landscape C-Suite Overview Dashboard featuring TCO Savings Index, Global 99.99% Availability SLA Scorecard, MTTR Incident Velocity, and Domain Health Breakdown.

---

## [0.1.0] - 2026-07-25

### Added
- **Snoomp Clean Enterprise SaaS Branding:** Custom `sn[oo]mp` squircle twin-node SVG logo mark, Double-Bezel hardware card enclosures, and refined Light/Dark theme color tokens.
- **Deep Database Engine Monitoring:** PostgreSQL, MongoDB, and Redis live engine status metrics.
- **Public Status Pages:** Collapsible tag-grouped category accordions and responsive grid views.
