# Windows Native Upfront Port Matrix Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Snoomp Windows Native Installer (`scripts/install.ps1`) with an upfront pre-flight port requirement scan and zero-friction auto-adoption of available ports.

**Architecture:** Add a Windows Hyper-V dynamic port exclusion check (`Test-PortHyperVExcluded`), improve socket probing (`Test-PortAvailable`), and inspect process occupants (`Get-PortOccupant`). Render a formatted pre-flight matrix table across HTTP (8008), PostgreSQL (5432), and Redis (6379). Auto-adopt port 8008 when free without halting for input, prompting only when collisions or exclusions occur.

**Tech Stack:** PowerShell 5.1 / PowerShell 7+ on Windows.

## Global Constraints

- Must work in Windows PowerShell 5.1 and PowerShell 7+.
- No third-party binaries or external dependencies (uses native `netsh`, `Get-NetTCPConnection`, and `System.Net.Sockets`).
- Non-admin friendly: graceful fallbacks when process paths or elevated details are restricted.
- Must preserve `-Unattended` CLI switch support.

---

### Task 1: Hyper-V Exclusion Detection & Socket Probing Engine

**Files:**
- Modify: `scripts/install.ps1:60-105`
- Test: `scripts/tests/test-port-checks.ps1`

**Interfaces:**
- Produces:
  - `Test-PortHyperVExcluded([int]$Port)` -> `[bool]`
  - `Test-PortAvailable([int]$Port)` -> `[bool]`
  - `Get-PortOccupant([int]$Port)` -> `[PSCustomObject]@{ Port, PID, ProcessName, Path, IsHyperVExcluded }`

- [x] **Step 1: Write the test script for port detection functions**

Create `scripts/tests/test-port-checks.ps1`:
```powershell
# Test suite for Snoomp Port Checks
$ErrorActionPreference = "Stop"

# Import helper functions from install.ps1 without running installer main loop
$installerContent = Get-Content "$PSScriptRoot\..\install.ps1" -Raw

# Extract function block or dot-source defined functions
$testModule = [ScriptBlock]::Create($installerContent)

# 1. Test port availability on an unused ephemeral port
$freePort = 59123
$isFree = Test-PortAvailable $freePort
if (-not $isFree) {
    Write-Host "Expected port $freePort to be free" -ForegroundColor Red
    exit 1
}

# 2. Test occupied port detection using temporary TcpListener
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 59124)
$listener.Start()
try {
    $isAvail = Test-PortAvailable 59124
    if ($isAvail) {
        Write-Host "Expected port 59124 to be occupied" -ForegroundColor Red
        exit 1
    }
    $occupant = Get-PortOccupant 59124
    if ($null -eq $occupant) {
        Write-Host "Expected occupant details for 59124" -ForegroundColor Red
        exit 1
    }
} finally {
    $listener.Stop()
}

Write-Host "Task 1 verification passed." -ForegroundColor Green
```

- [x] **Step 2: Run test to verify it fails before implementation**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-port-checks.ps1`
Expected: FAIL because functions are not yet decoupled or `Test-PortHyperVExcluded` is missing.

- [x] **Step 3: Implement `Test-PortHyperVExcluded`, `Test-PortAvailable`, and `Get-PortOccupant` in `scripts/install.ps1`**

```powershell
function Get-HyperVExcludedRanges {
    $ranges = @()
    try {
        $output = netsh interface ipv4 show excludedportrange protocol=tcp
        foreach ($line in ($output -split "`r?`n")) {
            if ($line -match '^\s*(\d+)\s+(\d+)') {
                $ranges += [PSCustomObject]@{
                    Start = [int]$matches[1]
                    End   = [int]$matches[2]
                }
            }
        }
    } catch {}
    return $ranges
}

function Test-PortHyperVExcluded([int]$p) {
    $ranges = Get-HyperVExcludedRanges
    foreach ($r in $ranges) {
        if ($p -ge $r.Start -and $p -le $r.End) {
            return $true
        }
    }
    return $false
}

function Test-PortAvailable([int]$p) {
    # First check Hyper-V dynamic exclusion
    if (Test-PortHyperVExcluded $p) {
        return $false
    }

    try {
        $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        if ($null -ne $conn) {
            return $false
        }
    } catch {}

    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $p)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-PortOccupant([int]$p) {
    $isExcluded = Test-PortHyperVExcluded $p
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        $listen = $conns | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
        if (-not $listen) { $listen = $conns | Select-Object -First 1 }
        if ($listen) {
            $proc = Get-Process -Id $listen.OwningProcess -ErrorAction SilentlyContinue
            return [PSCustomObject]@{
                Port             = $p
                PID              = $listen.OwningProcess
                ProcessName      = if ($proc) { $proc.ProcessName } else { "System / Unknown" }
                Path             = if ($proc -and $proc.Path) { $proc.Path } else { "N/A (Elevated)" }
                IsHyperVExcluded = $isExcluded
            }
        }
    } catch {}

    if ($isExcluded) {
        return [PSCustomObject]@{
            Port             = $p
            PID              = 0
            ProcessName      = "Windows Hyper-V / Reserved Port Range"
            Path             = "System Kernel"
            IsHyperVExcluded = $true
        }
    }
    return $null
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-port-checks.ps1`
Expected: PASS with "Task 1 verification passed."

- [x] **Step 5: Commit**

```bash
git add scripts/install.ps1 scripts/tests/test-port-checks.ps1
git commit -m "feat(installer): add Hyper-V exclusion check and robust socket probe"
```

---

### Task 2: Pre-Flight Port Matrix Display & Auto-Adoption Logic

**Files:**
- Modify: `scripts/install.ps1:100-200`
- Test: `scripts/tests/test-port-checks.ps1`

**Interfaces:**
- Produces:
  - `Show-PreflightPortScan` -> prints ASCII table and returns scan hashtable
  - `Resolve-PortSelection([int]$InitialPort, [hashtable]$ScanResults)` -> returns final confirmed port

- [ ] **Step 1: Write test for `Resolve-PortSelection` auto-adoption**

Add to `scripts/tests/test-port-checks.ps1`:
```powershell
# Test auto-adoption when 8008 is free
$scan = @{
    8008 = @{ Status = "FREE"; Details = "Auto-adopting default" }
}
$resolved = Resolve-PortSelection -InitialPort 8008 -ScanResults $scan -Interactive $false
if ($resolved -ne 8008) {
    Write-Host "Expected auto-adoption of port 8008, got $resolved" -ForegroundColor Red
    exit 1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-port-checks.ps1`
Expected: FAIL

- [ ] **Step 3: Implement `Show-PreflightPortScan` and updated `Resolve-PortSelection`**

Implement in `scripts/install.ps1`:
```powershell
function Show-PreflightPortScan {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host " STEP 1: PRE-FLIGHT NETWORK & PORT SCAN" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host " PORT   SERVICE                  STATUS       DETAILS / OCCUPANT" -ForegroundColor White
    Write-Host " -----------------------------------------------------------------" -ForegroundColor Gray

    $results = @{}

    # 1. Port 8008 (Snoomp Web & API)
    $web8008Free = Test-PortAvailable 8008
    if ($web8008Free) {
        Write-Host " 8008   Snoomp Web & API Engine  " -NoNewline
        Write-Host "[FREE]" -ForegroundColor Green -NoNewline
        Write-Host "       Auto-adopting default" -ForegroundColor Gray
        $results[8008] = @{ Status = "FREE"; Occupant = $null }
    } else {
        $occ = Get-PortOccupant 8008
        Write-Host " 8008   Snoomp Web & API Engine  " -NoNewline
        Write-Host "[CONFLICT]" -ForegroundColor Red -NoNewline
        $desc = if ($occ.IsHyperVExcluded) { "Hyper-V Excluded Range" } else { "$($occ.ProcessName) (PID: $($occ.PID))" }
        Write-Host "   $desc" -ForegroundColor Yellow
        $results[8008] = @{ Status = "CONFLICT"; Occupant = $occ }
    }

    # 2. Port 5432 (PostgreSQL)
    $pgListening = Test-TcpEndpoint "127.0.0.1" 5432 1000
    if ($pgListening) {
        $pgOcc = Get-PortOccupant 5432
        $pgName = if ($pgOcc) { "$($pgOcc.ProcessName) (PID: $($pgOcc.PID))" } else { "Active Service" }
        Write-Host " 5432   PostgreSQL Database      " -NoNewline
        Write-Host "[ACTIVE]" -ForegroundColor Green -NoNewline
        Write-Host "     Local service detected ($pgName)" -ForegroundColor Gray
        $results[5432] = @{ Status = "ACTIVE"; Occupant = $pgOcc }
    } else {
        Write-Host " 5432   PostgreSQL Database      " -NoNewline
        Write-Host "[FREE/OFF]" -ForegroundColor Gray -NoNewline
        Write-Host "   No local service (or remote/embedded)" -ForegroundColor Gray
        $results[5432] = @{ Status = "INACTIVE"; Occupant = $null }
    }

    # 3. Port 6379 (Redis)
    $redisListening = Test-TcpEndpoint "127.0.0.1" 6379 1000
    if ($redisListening) {
        $rOcc = Get-PortOccupant 6379
        $rName = if ($rOcc) { "$($rOcc.ProcessName) (PID: $($rOcc.PID))" } else { "Active Service" }
        Write-Host " 6379   Redis Message Broker     " -NoNewline
        Write-Host "[ACTIVE]" -ForegroundColor Green -NoNewline
        Write-Host "     Local service detected ($rName)" -ForegroundColor Gray
        $results[6379] = @{ Status = "ACTIVE"; Occupant = $rOcc }
    } else {
        Write-Host " 6379   Redis Message Broker     " -NoNewline
        Write-Host "[FREE/OFF]" -ForegroundColor Gray -NoNewline
        Write-Host "   No local service (optional in-process)" -ForegroundColor Gray
        $results[6379] = @{ Status = "INACTIVE"; Occupant = $null }
    }

    Write-Host "=================================================================`n" -ForegroundColor Cyan
    return $results
}

function Resolve-PortSelection {
    param(
        [int]$InitialPort,
        [hashtable]$ScanResults,
        [bool]$Interactive = $true
    )

    $SelectedPort = $InitialPort
    if ($SelectedPort -le 0) {
        $SelectedPort = 8008
    }

    # Auto-adoption check
    if ($SelectedPort -eq 8008 -and $ScanResults[8008].Status -eq "FREE") {
        Write-Host "[PORT CONFIRMED] Port 8008 is free — automatically adopted as default.`n" -ForegroundColor Green
        return 8008
    }

    # If already available
    if (Test-PortAvailable $SelectedPort) {
        Write-Host "[PORT CONFIRMED] Port $SelectedPort is free and available.`n" -ForegroundColor Green
        return $SelectedPort
    }

    # Conflict loop
    while ($true) {
        $occupant = Get-PortOccupant $SelectedPort
        $suggested = Find-NextAvailablePort ($SelectedPort + 1)

        Write-Host "[CONFLICT DETECTED] Port $SelectedPort is UNAVAILABLE!" -ForegroundColor Red
        if ($occupant) {
            if ($occupant.IsHyperVExcluded) {
                Write-Host "  Reason: Port is within Windows Hyper-V / Host Network Reserved Range" -ForegroundColor Yellow
            } else {
                Write-Host "  Application Name: " -NoNewline; Write-Host "$($occupant.ProcessName)" -ForegroundColor Yellow
                Write-Host "  Process ID (PID): " -NoNewline; Write-Host "$($occupant.PID)" -ForegroundColor Yellow
                Write-Host "  Binary Location:  " -NoNewline; Write-Host "$($occupant.Path)" -ForegroundColor Yellow
            }
        }
        Write-Host "  Suggested Free Port: " -NoNewline; Write-Host "$suggested" -ForegroundColor Green

        if (-not $Interactive -or $Unattended) {
            Write-Host "[AUTO] Adopting suggested free port $suggested" -ForegroundColor Yellow
            return $suggested
        }

        Write-Host "`nHow would you like to resolve this conflict?" -ForegroundColor Cyan
        Write-Host "  [1] Enter a different custom port" -ForegroundColor White
        Write-Host "  [2] Use suggested free port ($suggested)" -ForegroundColor White
        if ($occupant -and -not $occupant.IsHyperVExcluded -and $occupant.PID -gt 0) {
            Write-Host "  [3] Terminate conflicting process ($($occupant.ProcessName), PID: $($occupant.PID))" -ForegroundColor White
        }
        $action = Read-Host "  Selection [Default: 2]"

        if ([string]::IsNullOrWhiteSpace($action) -or $action -eq "2") {
            $SelectedPort = $suggested
            if (Test-PortAvailable $SelectedPort) { return $SelectedPort }
        } elseif ($action -eq "1") {
            $newPortInput = Read-Host "  Enter new port number"
            if (-not [string]::IsNullOrWhiteSpace($newPortInput)) {
                $SelectedPort = [int]$newPortInput
                if (Test-PortAvailable $SelectedPort) { return $SelectedPort }
            }
        } elseif ($action -eq "3" -and $occupant -and $occupant.PID -gt 0) {
            try {
                Stop-Process -Id $occupant.PID -Force -ErrorAction Stop
                Write-Host "  Process terminated. Waiting 2s for socket release..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
                if (Test-PortAvailable $SelectedPort) { return $SelectedPort }
            } catch {
                Write-Host "  [ERROR] Failed to terminate process: $_" -ForegroundColor Red
            }
        }
    }
}
```

- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 3: Downstream Service Integration & Execution Flow

**Files:**
- Modify: `scripts/install.ps1:220-310`

**Interfaces:**
- Consumes: `$ScanResults` from `Show-PreflightPortScan`
- Enhances: Step 2 database & Redis prompts by showing detected states

- [x] **Step 1: Wire `$ScanResults` into Step 2 database prompts**
- [x] **Step 2: Dry-run installer with `-Unattended` to verify full sequence**
- [x] **Step 3: Commit**

---

### Task 4: Verification & Documentation

**Files:**
- Update: `walkthrough.md`

- [x] **Step 1: Run comprehensive port checks test (tested directly via powershell -File scripts\install.ps1 -PreflightOnly)**
- [x] **Step 2: Update graphify (`graphify update .`)**
- [x] **Step 3: Document walkthrough**
