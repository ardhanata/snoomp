# Design Specification: Upfront Pre-Flight Port Matrix for Snoomp Windows Installer

- **Date:** 2026-09-05
- **Status:** Approved
- **Target File:** [`scripts/install.ps1`](file:///d:/Project/snoomp/scripts/install.ps1)

---

## 1. Objective
Enhance the Snoomp Windows Native Installer (`scripts/install.ps1`) with an upfront pre-flight port requirement scan. The installer evaluates all required and optional network ports (HTTP Web/API, PostgreSQL, Redis) before installation begins. If the default HTTP port (`8008`) is free and available, it is automatically adopted with zero user friction; if occupied or reserved by Windows Hyper-V port exclusions, the installer detects the conflict and interactively guides the user to resolve or remap it.

---

## 2. Port Architecture & Requirements Matrix

| Port | Service Component | Default Role | Verification Method |
|---|---|---|---|
| **8008** | Snoomp Web UI & REST API Engine | Inbound Listener (Host) | Active `TcpListener` probe on `0.0.0.0` + Hyper-V exclusion check |
| **5432** | PostgreSQL / TimescaleDB Service | Outbound Client / Inbound Daemon | `Get-NetTCPConnection` / `TcpClient` connect probe |
| **6379** | Redis Message Broker & Celery Queue | Outbound Client / Inbound Daemon | `Get-NetTCPConnection` / `TcpClient` connect probe |

---

## 3. Network Detection & Pre-Flight Engine

### 3.1 Detection Capabilities
1. **TCP Socket Availability (`Test-PortAvailable`):**
   Attempts an explicit bind and listen using `[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)`.
2. **Windows Hyper-V Exclusion Check (`Test-PortHyperVExcluded`):**
   Parses `netsh interface ipv4 show excludedportrange protocol=tcp` output to catch ports in reserved Windows ranges (e.g. `5141-5240`) before socket bind failures (`WSAEACCES 10013`).
3. **Occupant Inspection (`Get-PortOccupant`):**
   If a port is occupied (`State -eq 'Listen'`), retrieves the process ID, process name, and executable path via `Get-NetTCPConnection` and `Get-Process`.
4. **Next Available Port Finder (`Find-NextAvailablePort`):**
   Sequentially scans `$Port + 1` until finding a port that is neither occupied nor Hyper-V excluded.

### 3.2 Pre-Flight Port Status Table
Immediately following the banner and administrator check, the installer prints:

```text
=================================================================
 STEP 1: PRE-FLIGHT NETWORK & PORT SCAN
=================================================================
 PORT   SERVICE                  STATUS       DETAILS / OCCUPANT
 ----------------------------------------------------------------
 8008   Snoomp Web & API Engine  [FREE]       Auto-adopting default
 5432   PostgreSQL Database      [LISTENING]  Local service active (PID: 3412, postgres.exe)
 6379   Redis Message Broker     [FREE]       Available (or optional in-process scheduler)
=================================================================
```

---

## 4. Decision & Interactive Logic

### 4.1 Web Dashboard / API Port (`8008`)
- **If Port 8008 is `[FREE]`:**
  - Automatically adopt `$Port = 8008`.
  - Display: `✓ Default Web Port 8008 is free — automatically adopted.`
  - Proceed immediately without waiting for user input.
- **If Port 8008 is `[OCCUPIED]` or `[HYPER-V EXCLUDED]`:**
  - Alert the user with colorized diagnostics:
    - Display process name, PID, binary location, or Hyper-V exclusion details.
    - Propose the next available free port (e.g., `8009`).
  - Provide interactive menu:
    - `[1] Enter a custom port`
    - `[2] Use suggested free port (e.g., 8009)`
    - `[3] Terminate conflicting process (if process identified)`
- **If `-Unattended` is specified:**
  - If 8008 is free, adopt 8008. If occupied, adopt the suggested free port automatically.

### 4.2 Database & Redis Pre-Configuration Integration (Step 2)
- **PostgreSQL (`5432`):**
  - If `5432` is already `[LISTENING]`: Pre-fill default host as `127.0.0.1` and port `5432`, prompting only for credentials.
  - If `5432` is not listening: Notify user and allow entering remote host/port or selecting embedded SQLite.
- **Redis (`6379`):**
  - If `6379` is `[LISTENING]`: Pre-fill `redis://127.0.0.1:6379/0`.
  - If `6379` is not listening: In-process scheduler is defaulted with optional remote configuration.

---

## 5. Error Handling & Edge Cases
- **Non-Admin Execution:** `Get-NetTCPConnection` works in standard user context; if `Get-Process` lacks permission to query process path of a system-owned process, gracefully falls back to displaying the PID and "System / Protected".
- **Dynamic Port Exclusion Ranges:** Hyper-V range parser handles multiple start-port / end-port ranges cleanly.
- **Socket Tear-Down Delay:** When terminating a conflicting process, add a 2-second sleep to ensure the Windows TCP stack releases the TIME_WAIT / LISTEN state before re-probing.

---

## 6. Verification Plan
1. **Automated / Scripted Verification:**
   - Execute `powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Unattended` in dry-run/preview mode to verify automatic adoption of port 8008 when free.
   - Run simulated collision by listening on port 8008 with a temporary PowerShell socket listener and running port resolution to verify conflict detection and suggested alternative.
2. **Hyper-V Exclusion Range Test:**
   - Verify `Test-PortHyperVExcluded` properly identifies ports in the dynamic exclusion range.
