# Snoomp 🛰️

[![Version](https://img.shields.io/badge/version-0.3.1-blue.svg)](https://github.com/ardhanata/snoomp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12%20%7C%203.13-3776AB.svg?logo=python&logoColor=white)](https://python.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20Server-lightgrey.svg)](https://github.com/ardhanata/snoomp)

> **Enterprise Multi-Protocol Infrastructure Observability & Uptime Monitoring**  
> High-performance, self-hosted monitoring with real-time WebSocket telemetry, Uptime Kuma-style multi-channel alerting, and dual-mode deployment (Docker or Standalone Native Windows).

---

## 🌟 Highlights & Capabilities

### 🌐 Multi-Protocol Target Monitoring
Snoomp continuously probes external and internal fleet services across critical enterprise protocols:
- **HTTP / HTTPS**: Response latency, status code verification, custom headers, and TLS/SSL certificate validation.
- **ICMP Ping**: Real-time packet loss and round-trip latency metrics.
- **TCP Port**: Instant socket connect tests for custom service ports.
- **DNS Query**: Validates DNS resolution for `A`, `AAAA`, `CNAME`, `MX`, and `TXT` records against custom or system resolvers.
- **SSH Host Telemetry**: Secure key-based or password authentication, executing in-depth telemetry (accurate CPU utilization via `%idle` sampling, memory usage, and disk volume capacity).
- **SNMP v2c / v3**: Device hardware polling (CPU, RAM, bandwidth, interface state) via PySNMP.
- **Databases**: Real-time connection and verification query polling for **PostgreSQL / TimescaleDB**, **MongoDB**, and **Redis**.

### 🔔 Uptime Kuma-Style Alerting & Notifications
Full notification management with instant testing, custom titles, default channel auto-assignment, and per-monitor channel selection:
- **Direct Native Channels**: Discord (rich color embeds & on-call role pings), Telegram (HTML markdown alerts), Slack (rich attachments), and Webhooks (custom headers & payloads).
- **Universal Apprise Engine**: Native in-process Python Apprise integration supporting **80+ providers** without external CLI daemons:
  - **Email / SMTP** (with TLS/SSL authentication)
  - **Microsoft Teams**
  - **Gotify** & **Ntfy**
  - **Pushover** & **Twilio**
  - Multi-URI routing (send to multiple notification targets simultaneously)
- **Lifecycle Alerts**: Dispatches `🔴 [DOWN]`, `⚠️ [WARNING]`, and `✅ [RECOVERED]` notifications with duration, response times, and failure reasons.

### 📊 Modern Fleet UI & Executive Dashboards
- **Real-Time WebSockets**: Instant status indicator updates without page reloading.
- **Executive Overview**: High-level radial health gauges, SLA compliance tracking (99.9% / 99.0% / 95.0%), and incident timelines.
- **Fleet Tagging & Batch Editing**: Group targets by environment (`PROD`, `STG`, `DEV`), role, or application; batch-edit intervals and thresholds across hundreds of monitors simultaneously.
- **Public Status Pages**: Share real-time status and incident announcements with external stakeholders.

---

## 🚀 Quick Start

Snoomp supports two official deployment architectures:

### Option A: Standalone Native Windows (No Docker / No Python Needed)
Run Snoomp directly on Windows Server or Windows 10/11 using the interactive one-liner installer:

```powershell
# Run in PowerShell (Administrator recommended for 24/7 background service registration):
irm https://raw.githubusercontent.com/ardhanata/snoomp/main/scripts/install.ps1 | iex
```

**Installer Capabilities:**
1. **Interactive Port Conflict Detection**: Automatically inspects occupying processes and offers custom ports, auto-increment, or conflict termination.
2. **Package Selection**:
   - **Preset 1 (Full Production Package)**: Connects to PostgreSQL / TimescaleDB and Redis with pre-flight TCP verification handshakes.
   - **Preset 2 (Standalone Native)**: Zero-dependency embedded SQLite in WAL mode with in-process task scheduler.
3. **24/7 Windows Service**: Registers a Windows Scheduled Task (`SnoompServer`) running under `NT AUTHORITY\SYSTEM` with automatic failure restarts.
4. **Helper Management Scripts**: Installs `status-snoomp.ps1`, `start-snoomp.ps1`, `stop-snoomp.ps1`, `restart-snoomp.ps1`, and `view-logs.ps1`.

---

### Option B: Docker Compose (Linux / Production Containers)

```bash
# 1. Clone repository
git clone https://github.com/ardhanata/snoomp.git
cd snoomp

# 2. Configure environment
cp .env.example .env
# Edit .env and set JWT_SECRET and database passwords

# 3. Launch the full stack
docker compose up -d

# 4. Open dashboard
# Browser: http://localhost:8008
```

Default administrator credentials on fresh deployment:
- **Username**: `admin`
- **Password**: `admin123` *(Please change immediately in Preferences upon login)*

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, SQLAlchemy, Alembic, Celery, Apprise, AsyncSSH, PySNMP, Psycopg2 |
| **Frontend** | React 18, TypeScript, Vite, Chart.js, Lucide Icons, Vanilla CSS Design System |
| **Data Layer** | PostgreSQL / TimescaleDB (Production) or SQLite 3 WAL (Standalone Native), Redis |
| **Packaging** | PyInstaller (Windows x64 Standalone Executable), Docker & Docker Compose |

---

## 🧪 Development & Testing

```bash
# Backend unit & integration tests:
cd backend
python -m venv venv
venv\Scripts\activate          # or source venv/bin/activate on Linux
pip install -r requirements.txt -r requirements-test.txt
pytest

# Frontend development:
cd frontend
npm install
npm run dev
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).  
Copyright (c) 2026 Ardhanata and Snoomp Contributors.
