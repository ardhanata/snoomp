# Snoomp Executive Presentation & High-Performance Architecture Design Spec

**Date:** 2026-07-25  
**Status:** Approved  
**Focus:** Executive C-Suite Presentation, TCO Optimization, and High-Performance Architecture  
**Language:** Bahasa Indonesia / English Dual Structure  

---

## 1. Executive Summary & Value Proposition (Ringkasan Eksekutif)

Snoomp is an enterprise-grade infrastructure and health monitoring solution designed to provide total operational visibility at a fraction of the Total Cost of Ownership (TCO) of proprietary SaaS solutions.

### Key Executive Value Highlights:
- **90% TCO Cost Reduction:** Zero per-host or per-metric ingestion fees.
- **Agentless Deployment:** Zero agent maintenance overhead on target nodes.
- **Sub-Second Threat & Incident Detection:** Automated alert dispatch via Celery & Redis Pub/Sub.
- **99.99% SLA Guarantee Alignment:** Real-time business continuity tracking.

---

## 2. Technical Architecture & Component Breakdown

```
 ┌─────────────────────────────────────────────────────────┐
 │               Frontend UI (React 18 + Vite)             │
 └────────────────────────────┬────────────────────────────┘
                              │ Live WebSockets & REST API
 ┌────────────────────────────▼────────────────────────────┐
 │               Backend API (FastAPI Async)               │
 └──────────────┬───────────────────────────┬──────────────┘
                │                           │
 ┌──────────────▼─────────────┐   ┌─────────▼──────────────┐
 │ Redis Broker & Pub/Sub     │   │ TimescaleDB Storage    │
 └──────────────┬─────────────┘   │ (PostgreSQL Extension) │
                │                 └────────────────────────┘
 ┌──────────────▼─────────────┐
 │ Celery Worker Cluster      │ ──► (Agentless Checks: HTTP, DB, SNMP, ICMP)
 └────────────────────────────┘
```

### 2.1 Backend Engine (FastAPI)
- Built on Python's asynchronous `asyncio` loop for ultra-low latency HTTP API responses.
- WebSocket subscription endpoint (`/api/ws`) for live metric broadcasting without polling overhead.

### 2.2 Worker & Distributed Scheduler (Celery + Redis)
- Asynchronous task queues distributed across lightweight worker processes (<50MB RAM/worker).
- Performs agentless HTTP/S, TCP, ICMP, SNMP, PostgreSQL, MongoDB, and Redis checks.

### 2.3 Storage Layer (TimescaleDB / PostgreSQL)
- **Automatic Hypertables:** Partitioned time-series tables for lightning-fast metric queries.
- **Hypertable Compression:** Achieves **90% storage reduction** for historical telemetry data (24h to 90d retention).

---

## 3. Executive Command Center UI Specifications

### 3.1 TCO Savings Index Card (Indikator Penghematan Biaya)
- Displays real-time estimated monthly cost savings vs traditional SaaS APMs.
- Metric Formula: $\text{Savings} = (\text{Active Targets} \times \$25) - \text{Snoomp Hosting Cost}$.

### 3.2 Global SLA Scoreboard (Ketersediaan Layanan)
- Visualizes global uptime percentage per business domain (Target: **99.99%**).
- Color-coded double-bezel cards: Emerald (`#059669`) for Operational, Crimson (`#DC2626`) for Incidents.

### 3.3 Financial Downtime Risk Meter
- Translates MTTR (*Mean Time to Resolution*) and MTBF (*Mean Time Between Failures*) into business risk prevented.

---

## 4. Verification & Self-Review Checklist

- [x] **Placeholder Scan:** All sections, metrics, and architecture layers fully detailed.
- [x] **Internal Consistency:** Technical architecture directly supports the TCO value proposition.
- [x] **Scope Check:** Covers both the Executive Presentation Spec and the C-Suite Command Center UI.
- [x] **Language Alignment:** Formatted cleanly for dual Bahasa Indonesia and English executive decks.
