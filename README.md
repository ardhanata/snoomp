# Snoomp 🛰️

[![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)](https://github.com/ardhanata/snoomp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12%20%7C%203.13-3776AB.svg?logo=python&logoColor=white)](https://python.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Docker-lightgrey.svg)](https://github.com/ardhanata/snoomp)

> **Enterprise Multi-Protocol Infrastructure Observability & Uptime Monitoring**  
> High-performance, self-hosted monitoring with real-time WebSocket telemetry, Apprise multi-channel alerting (80+ providers), and single-command Docker deployment.

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

### 🔔 Apprise Alerting & Multi-Channel Notifications
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

Snoomp runs as a Docker Compose stack on Linux. The frontend is compiled into
the backend image and served same-origin, so the image tag is the entire
artifact — the UI and API cannot drift apart, and the host needs no Node.

**Requirements:** Linux host with Docker Engine 24+ and the Compose plugin.

### Method 1: One-Liner Install (Curl & Bash from GitHub)

On any clean Linux server with Docker installed:
```bash
curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash
```

Or non-interactively for automated deployments:
```bash
curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash -s -- --unattended --domain monitor.yourdomain.com
```

### Method 2: Git Clone

```bash
git clone https://github.com/ardhanata/snoomp.git /opt/snoomp
cd /opt/snoomp
sudo ./install.sh
```

`install.sh` validates host prerequisites, auto-generates 48-byte cryptographic keys (`JWT_SECRET`, `POSTGRES_PASSWORD`), configures ports/origins, builds and launches the containers, and outputs your initial administrator credentials.

> 📖 **Deploying to a remote server, setting up SSL with Nginx/Caddy, or migrating data?**  
> See the complete [**Production Deployment Guide**](docs/DEPLOYMENT.md).

### Remote Push (from Workstation to Server)

```bash
./scripts/deploy-remote.sh user@your-server-ip /opt/snoomp --install
```

### Manual Docker Compose Start

```bash
cp .env.example .env
# Set JWT_SECRET and POSTGRES_PASSWORD in .env
#   openssl rand -base64 48   # JWT_SECRET
#   openssl rand -base64 32   # POSTGRES_PASSWORD

docker compose up -d --build
```

Open `http://<host>:8008`. On first run the admin password is generated and
printed once:

```bash
docker compose logs api | grep -A5 FIRST-RUN
```

Set `SNOOMP_ADMIN_PASSWORD` in `.env` beforehand to choose it yourself.

### Updating

```bash
git pull
docker compose up -d --build
```

Both containers are replaced together. To roll back, check out the previous
tag and rebuild — `db_data` and `redis_data` are named volumes and survive.

### Configuration

All settings live in `.env`; see `.env.example` for the annotated list. The
two required values are `JWT_SECRET` and `POSTGRES_PASSWORD`. Set
`ALLOWED_ORIGINS` to the URL users actually visit, e.g.
`http://10.100.244.3:8008`.

### Notes on the container setup

- **`NET_RAW`** is granted to `api` and `worker` for ICMP. Containers still run
  as a non-root user; this grants one capability rather than the root set.
- **Postgres is not published** to the host — only the app containers reach it.
  Uncomment the `ports` block in `docker-compose.yml` to attach a SQL client.
- **TimescaleDB** provides the `system_metrics` hypertable. The image includes
  the extension and the privileges to create it.
- **Outbound monitoring** (ping, SNMP, SSH, TCP, DNS) works over the default
  bridge network. `network_mode: host` is only needed if targets must reach
  Snoomp inbound on arbitrary ports.

### Migrating from a previous Windows install

The Windows executable, installer and in-app updater have been removed;
Compose is the only supported deployment. To carry existing data across:

```bash
# On the old Windows host, with its PostgreSQL running:
pg_dump -U snoomp_admin -d snoomp_db -Fc -f snoomp.dump

# On the new Linux host, after `docker compose up -d`:
docker compose cp snoomp.dump db:/tmp/snoomp.dump
docker compose exec db pg_restore -U snoomp_admin -d snoomp_db --clean --if-exists /tmp/snoomp.dump
docker compose restart api worker
```

SQLite is no longer supported — the app refuses to start on a `sqlite://` URL
rather than running with a schema that cannot host the metrics hypertable. A
standalone SQLite deployment must be exported to PostgreSQL first.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, SQLAlchemy, Alembic, Celery, Apprise, AsyncSSH, PySNMP, Psycopg2 |
| **Frontend** | React 18, TypeScript, Vite, Chart.js, Lucide Icons, Vanilla CSS Design System |
| **Data Layer** | PostgreSQL 16 / TimescaleDB, Redis 7 |
| **Packaging** | Multi-stage Docker image (frontend baked in), Docker Compose |

---

## 🧪 Development & Testing

```bash
# Backend unit & integration tests:
cd backend
python -m venv venv
source venv/bin/activate
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
