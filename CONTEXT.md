# Snoomp — Enterprise Infrastructure Health & Status Platform

> **Version:** `v1.1.1`  
> **Repository Root:** `d:/Project/snoomp`

---

## 🎯 1. Executive Summary & Core Mission
**Snoomp** is an enterprise-grade, lightweight, multi-protocol infrastructure health and status monitoring platform. Built as a high-performance, self-hostable alternative to commercial SaaS monitoring solutions (e.g. Datadog, UptimeRobot), Snoomp provides real-time health checks, deep database engine diagnostics, multi-disk POSIX volume analysis, and executive SLA reporting for enterprise IT environments, SOA middleware (`SOA OSB Server 1`), and hybrid Linux/Windows server fleets.

---

## 🏗️ 2. Architectural Overview & Domain Components

```
                    ┌─────────────────────────────────────────────────────────┐
                    │     Snoomp React Vite SPA (Baked in Image)             │
                    │   Double-Bezel UI / Same-Origin Static Delivery         │
                    └────────────────────────────┬────────────────────────────┘
                                                 │ Internal / HTTP & WebSockets
                                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │     FastAPI Core Backend Engine (8000 -> 8008)          │
                    │  - REST API & JWT Auth (routes)                         │
                    │  - Dashboard & Static SPA Delivery (app/main.py)        │
                    │  - Realtime WebSockets & Pub/Sub (websockets)           │
                    │  - APScheduler Job Dispatch to Celery Broker            │
                    └────────────────────────────┬────────────────────────────┘
                                                 │
                                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │     Core Infrastructure Services (Docker Compose)       │
                    │  - TimescaleDB / PostgreSQL 16 (timescaledb:2.17.2-pg16)│
                    │  - Redis 7 Alpine (Queue & Pub/Sub Broker)              │
                    │  - Celery Worker Pool (NET_RAW capability for ICMP)     │
                    └────────────────────────────┬────────────────────────────┘
                                                 │ Probes
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Multi-Protocol Checkers                              │
│  - HTTP / HTTPS (Status, SSL, latency, text match)                               │
│  - ICMP Ping (RTT & packet loss via raw sockets / iputils fallback)              │
│  - TCP & DNS (Port availability & domain resolution)                             │
│  - SSH Infrastructure (Linux POSIX df/loadavg + Windows OpenSSH PowerShell CIM)  │
│  - Database Engines (PostgreSQL pg_stat, MongoDB serverStatus, Redis info)       │
│  - SNMP (Network switch & router interface metrics)                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 3. Supported Checker Protocols (`backend/app/checkers/`)

| Protocol / Target | Metric Capabilities & Logic | Target Use Case |
|---|---|---|
| **HTTP / HTTPS** | Response time (ms), HTTP status code, SSL expiry date, keyword body assertions. | Web apps, microservices, REST APIs. |
| **ICMP Ping** | RTT latency (ms), packet loss percentage, ICMP socket privilege fallback. | Network routers, gateway hosts, firewalls. |
| **TCP / DNS** | Socket handshake time, DNS resolution A/AAAA record lookup timing. | Specific port availability, DNS servers. |
| **SSH Infrastructure** | Linux POSIX (`df -h -P`, `/proc/loadavg`, `nproc`, `free -m`) & Windows OpenSSH (PowerShell CIM `Win32_OperatingSystem`, `Win32_Processor`, `Win32_LogicalDisk`). Multi-disk & NFS volume breakdown (`/`, `/u01`, `/data`, `/mnt/nfs`). | Linux/Windows OS hosts, SAN/NFS storage arrays. |
| **PostgreSQL** | Connection handshake, active backend count (`pg_stat_activity`), total DB size, cache hit ratio, slow query log. | PostgreSQL & TimescaleDB database instances. |
| **MongoDB** | Connection handshake, opcounters (inserts/queries/updates/deletes), memory footprint, connected clients. | MongoDB clusters & replica sets. |
| **Redis** | Ping latency, memory usage (MB), connected clients, instantaneous ops/sec, keyspace count. | Redis caches & message brokers. |
| **SNMP** | Interface uptime, packet throughput, error rates. | Managed switches & enterprise routers. |

---

## ⚙️ 4. Deployment Architecture

### Production Docker Containerized (Unified)
- **Launch Command:** `docker compose up -d --build`
- **Stack:**
  - Multi-stage build image (`snoomp:local`) packaging compiled React SPA and FastAPI backend into a non-root runtime container.
  - TimescaleDB PostgreSQL 16 (`timescale/timescaledb:2.17.2-pg16`) for relational schemas and hypertable metrics.
  - Redis 7 (`redis:7-alpine`) for Celery broker queues and real-time WebSocket pub/sub message distribution.
  - Celery Worker (`snoomp-worker`) equipped with `NET_RAW` capabilities for native ICMP probing.
- **Environment & Security:**
  - Mandatory environment variables enforced with `:?` bash parameter substitution (`JWT_SECRET`, `POSTGRES_PASSWORD`).
  - Database port unpublished from host for internal network isolation.

---

## 📏 5. Metric Accuracy & Code Conventions

1. **CPU Utilization Percentage:**
   - **Rule:** Never multiply raw 1-minute load average directly by 100 for CPU percentage without normalizing by `cpu_cores` count (`(load_1min / cpu_cores) * 100`) or sampling `100 - %idle` from `/proc/stat` / `vmstat`. Multi-core servers (e.g. 32 cores) will otherwise report false high CPU utilization.
2. **Sub-Second Responsiveness & Timeout Caps:**
   - Database and SSH checker connection timeouts must remain capped at **3–4 seconds** to maintain responsive UI updates and prevent background worker thread starvation.
3. **Multi-Disk Storage Alerting:**
   - Overall system disk usage percentage is calculated as the maximum percentage across all physical and mounted volumes (`max_disk_pct`) so full sub-partitions (e.g. `/u01`, `/data`, `/mnt/nfs`) trigger warning/down status.
4. **UI Design Invariants:**
   - **Double-Bezel Enclosures:** Hardware-inspired dual-bordered card surfaces (`.double-bezel-outer`).
   - **Tabular Figures:** Apply `font-variant-numeric: tabular-nums` to numerical metric counters to prevent layout shifts during WebSocket updates.
   - **Zero Emoji In Source Code:** Clean Lucide SVG icons and professional text tags in UI and CLI scripts.
   - **Universal Accessibility:** AAA contrast in both Light Mode (`#F4F6F8`) and Dark Mode (`#0c0d12`).

---

## 📝 6. Changelog & Versioning Rules (For Agents)

- **Always update the Changelog and Version:** When completing tasks that modify behavior, features, or architecture, agents MUST update `CHANGELOG.md` and the `VERSION` file.
- **Versioning Schema (SemVer):** 
  - **Major (`X.0.0`):** Breaking architectural changes, major platform graduation (e.g., `0.3.1` -> `1.0.0`).
  - **Minor (`1.X.0`):** New features, checkers, or installers in a backward-compatible manner (e.g., `1.0.0` -> `1.1.0`).
  - **Patch (`1.0.X`):** Backward-compatible bug fixes and small tweaks (e.g., `1.0.0` -> `1.0.1`).
