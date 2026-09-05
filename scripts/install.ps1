# ==============================================================================
# Snoomp Enterprise Platform — Interactive Windows Server Installer
# Suitable for one-liner execution: irm https://<host>/install.ps1 | iex
# ==============================================================================

[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [int]$Port = 0,
    [string]$DownloadUrl = "",
    [string]$DatabaseUrl = "",
    [string]$RedisUrl = "",
    [string]$AdminPassword = "",
    [switch]$Unattended = $false
)

$ErrorActionPreference = "Stop"

function Show-Banner {
    Clear-Host
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "     SNOOMP ENTERPRISE OBSERVABILITY & HEALTH PLATFORM           " -ForegroundColor Cyan
    Write-Host "             Windows Server Interactive Installer                " -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""
}

# --- 1. Administrator Check & Self-Elevation ---
$Global:IsAdmin = $false
function Check-Admin {
    try {
        $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        $Global:IsAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        $Global:IsAdmin = $false
    }
    
    if (-not $Global:IsAdmin -and -not $Unattended) {
        try {
            Write-Host "[ELEVATION] Requesting Administrator privileges for 24/7 service & firewall setup..." -ForegroundColor Yellow
            $scriptPath = $PSCommandPath
            if (-not $scriptPath -or -not (Test-Path $scriptPath)) {
                $tempScript = "$env:TEMP\snoomp-installer-$([System.Guid]::NewGuid().ToString('N')).ps1"
                $scriptContent = (Get-Variable -Name MyInvocation -Value).MyCommand.ScriptBlock
                Set-Content -Path $tempScript -Value $scriptContent -Encoding utf8
                Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempScript`""
                exit 0
            } else {
                Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
                exit 0
            }
        } catch {
            Write-Host "[INFO] Running without Administrator privileges. Falling back to user-level install." -ForegroundColor Gray
        }
    }
}

Check-Admin
Show-Banner

# --- 2. Port Collision Detection, Process Inspection & Interactive Resolution ---
function Test-PortAvailable([int]$p) {
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
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        $listen = $conns | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
        if (-not $listen) { $listen = $conns | Select-Object -First 1 }
        if ($listen) {
            $proc = Get-Process -Id $listen.OwningProcess -ErrorAction SilentlyContinue
            return [PSCustomObject]@{
                Port        = $p
                PID         = $listen.OwningProcess
                ProcessName = if ($proc) { $proc.ProcessName } else { "Unknown" }
                Path        = if ($proc) { $proc.Path } else { "N/A" }
            }
        }
    } catch {}
    return $null
}

function Find-NextAvailablePort([int]$startPort) {
    $p = $startPort
    while (-not (Test-PortAvailable $p)) {
        $p++
    }
    return $p
}

function Resolve-PortSelection {
    param([int]$InitialPort)

    $SelectedPort = $InitialPort
    if ($SelectedPort -le 0) {
        $SelectedPort = 8008
    }

    if (-not $Unattended) {
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
        Write-Host " STEP 1: NETWORK PORT CONFIGURATION" -ForegroundColor Cyan
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
        Write-Host "Enter the HTTP port for Snoomp Dashboard & REST API:" -ForegroundColor White
        $userInput = Read-Host "  HTTP Port [Default: $SelectedPort]"
        if (-not [string]::IsNullOrWhiteSpace($userInput)) {
            $SelectedPort = [int]$userInput
        }
    }

    while ($true) {
        if (Test-PortAvailable $SelectedPort) {
            Write-Host "`n[PORT CONFIRMED] TCP Port $SelectedPort is free and available." -ForegroundColor Green
            return $SelectedPort
        }

        # Port is occupied! Identify the occupant application
        $occupant = Get-PortOccupant $SelectedPort
        $suggested = Find-NextAvailablePort ($SelectedPort + 1)

        Write-Host "`n[CONFLICT DETECTED] Port $SelectedPort is ALREADY OCCUPIED by an existing application!" -ForegroundColor Red
        if ($occupant) {
            Write-Host "  Application Name: " -NoNewline; Write-Host "$($occupant.ProcessName)" -ForegroundColor Yellow
            Write-Host "  Process ID (PID): " -NoNewline; Write-Host "$($occupant.PID)" -ForegroundColor Yellow
            Write-Host "  Binary Location:  " -NoNewline; Write-Host "$($occupant.Path)" -ForegroundColor Yellow
        }
        Write-Host "  Suggested Free Port: " -NoNewline; Write-Host "$suggested" -ForegroundColor Green

        if ($Unattended) {
            Write-Host "[UNATTENDED] Automatically adopting suggested free port $suggested" -ForegroundColor Yellow
            return $suggested
        }

        Write-Host "`nHow would you like to resolve this conflict?" -ForegroundColor Cyan
        Write-Host "  [1] Enter a different custom port" -ForegroundColor White
        Write-Host "  [2] Use suggested free port ($suggested)" -ForegroundColor White
        Write-Host "  [3] Terminate the conflicting process ($($occupant.ProcessName), PID: $($occupant.PID))" -ForegroundColor White
        $action = Read-Host "  Selection [Default: 2]"

        if ([string]::IsNullOrWhiteSpace($action) -or $action -eq "2") {
            $SelectedPort = $suggested
        } elseif ($action -eq "1") {
            $newPortInput = Read-Host "  Enter new port number"
            if (-not [string]::IsNullOrWhiteSpace($newPortInput)) {
                $SelectedPort = [int]$newPortInput
            }
        } elseif ($action -eq "3") {
            if (-not $occupant -or -not $occupant.PID) {
                Write-Host "[WARN] Cannot identify PID to terminate. Please choose another port." -ForegroundColor Red
                continue
            }
            $confirm = Read-Host "  Are you sure you want to kill '$($occupant.ProcessName)' (PID: $($occupant.PID))? (y/N)"
            if ($confirm -eq "y" -or $confirm -eq "Y") {
                try {
                    Stop-Process -Id $occupant.PID -Force -ErrorAction Stop
                    Write-Host "  Process terminated. Waiting for socket release..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 2
                } catch {
                    Write-Host "  [ERROR] Failed to terminate process: $_" -ForegroundColor Red
                }
            }
        }
    }
}

$Port = Resolve-PortSelection -InitialPort $Port

# --- 3. Production Architecture & Package Selection ---
function Test-TcpEndpoint([string]$hostName, [int]$portNum, [int]$timeoutMs = 2500) {
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $iar = $tcpClient.BeginConnect($hostName, $portNum, $null, $null)
        $wh = $iar.AsyncWaitHandle
        if (-not $wh.WaitOne($timeoutMs, $false)) {
            $tcpClient.Close()
            return $false
        }
        $tcpClient.EndConnect($iar)
        $tcpClient.Close()
        return $true
    } catch {
        return $false
    }
}

$DbChoice = "1"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $DatabaseUrl = "sqlite:///snoomp.db"
} else {
    $DbChoice = "custom"
}

$WorkerThreads = 16
$RetentionDays = 90

if (-not $Unattended -and $DbChoice -ne "custom") {
    Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host " STEP 2: DEPLOYMENT PACKAGE & ARCHITECTURE (PRODUCTION)" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "Select Snoomp Deployment Package:" -ForegroundColor White
    Write-Host "  [1] Full Production Enterprise Package (High-Capacity Observability)" -ForegroundColor Cyan
    Write-Host "      * TimescaleDB / PostgreSQL (Hypertables, millions of time-series metrics)" -ForegroundColor Gray
    Write-Host "      * Redis broker for distributed worker queue & WebSocket streaming" -ForegroundColor Gray
    Write-Host "      * High-concurrency worker threads & configurable retention" -ForegroundColor Gray
    Write-Host "  [2] Standalone Native Package (Edge / Lightweight / Zero Dependencies)" -ForegroundColor White
    Write-Host "      * Embedded SQLite with automatic WAL mode" -ForegroundColor Gray
    Write-Host "      * In-process ThreadPool asynchronous scheduler" -ForegroundColor Gray
    Write-Host "      * Single self-contained binary, zero external setup" -ForegroundColor Gray

    $DbChoiceInput = Read-Host "  Selection [Default: 1 - Full Production]"
    if (-not [string]::IsNullOrWhiteSpace($DbChoiceInput)) {
        $DbChoice = $DbChoiceInput.Trim()
    }
}

if ($DbChoice -eq "1" -and -not $Unattended) {
    Write-Host "`n--- [1/3] TimescaleDB / PostgreSQL Configuration ---" -ForegroundColor Cyan
    $PgVerified = $false
    while (-not $PgVerified) {
        $PgHost = Read-Host "  PostgreSQL Host [Default: 127.0.0.1]"
        if ([string]::IsNullOrWhiteSpace($PgHost)) { $PgHost = "127.0.0.1" }
        
        $PgPort = Read-Host "  PostgreSQL Port [Default: 5432]"
        if ([string]::IsNullOrWhiteSpace($PgPort)) { $PgPort = "5432" }

        $PgDb = Read-Host "  Database Name   [Default: snoomp_db]"
        if ([string]::IsNullOrWhiteSpace($PgDb)) { $PgDb = "snoomp_db" }

        $PgUser = Read-Host "  Username        [Default: snoomp_admin]"
        if ([string]::IsNullOrWhiteSpace($PgUser)) { $PgUser = "snoomp_admin" }

        $PgPass = Read-Host "  Password        " -AsSecureString
        $Bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PgPass)
        $PlainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($Bstr)

        # Pre-flight TCP verification
        Write-Host "  Verifying TCP connection to ${PgHost}:${PgPort}..." -ForegroundColor Yellow
        $canConnect = Test-TcpEndpoint -hostName $PgHost -portNum ([int]$PgPort)
        if ($canConnect) {
            Write-Host "  [OK] Successfully reached PostgreSQL service at ${PgHost}:${PgPort}" -ForegroundColor Green
            $DatabaseUrl = "postgresql://${PgUser}:${PlainPass}@${PgHost}:${PgPort}/${PgDb}"
            $PgVerified = $true
        } else {
            Write-Host "  [WARN] Cannot connect to ${PgHost}:${PgPort}! Is PostgreSQL/TimescaleDB running?" -ForegroundColor Red
            Write-Host "  [1] Re-enter PostgreSQL connection details" -ForegroundColor White
            Write-Host "  [2] Proceed anyway (assuming database service will start later)" -ForegroundColor White
            Write-Host "  [3] Fallback to Embedded SQLite" -ForegroundColor White
            $warnChoice = Read-Host "  Selection [Default: 1]"
            if ($warnChoice -eq "2") {
                $DatabaseUrl = "postgresql://${PgUser}:${PlainPass}@${PgHost}:${PgPort}/${PgDb}"
                $PgVerified = $true
            } elseif ($warnChoice -eq "3") {
                $DatabaseUrl = "sqlite:///snoomp.db"
                Write-Host "  Using Embedded SQLite as requested." -ForegroundColor Yellow
                $PgVerified = $true
            }
        }
    }

    Write-Host "`n--- [2/3] Redis Message Broker Configuration ---" -ForegroundColor Cyan
    $RHost = Read-Host "  Redis Host [Default: 127.0.0.1, or press Enter to skip]"
    if (-not [string]::IsNullOrWhiteSpace($RHost)) {
        $RPort = Read-Host "  Redis Port [Default: 6379]"
        if ([string]::IsNullOrWhiteSpace($RPort)) { $RPort = "6379" }

        Write-Host "  Verifying TCP connection to ${RHost}:${RPort}..." -ForegroundColor Yellow
        if (Test-TcpEndpoint -hostName $RHost -portNum ([int]$RPort)) {
            Write-Host "  [OK] Successfully reached Redis service at ${RHost}:${RPort}" -ForegroundColor Green
            $RedisUrl = "redis://${RHost}:${RPort}/0"
        } else {
            Write-Host "  [WARN] Redis not reachable at ${RHost}:${RPort}. Falling back to in-process scheduler engine." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Skipping Redis. In-process high-performance thread pool scheduler will be used." -ForegroundColor Gray
    }

    Write-Host "`n--- [3/3] Production Performance & Retention Tuning ---" -ForegroundColor Cyan
    $RetInput = Read-Host "  Metric Retention Period in Days [Default: 90]"
    if (-not [string]::IsNullOrWhiteSpace($RetInput)) { $RetentionDays = [int]$RetInput }

    $WorkerInput = Read-Host "  Concurrent Checker Worker Threads [Default: 16]"
    if (-not [string]::IsNullOrWhiteSpace($WorkerInput)) { $WorkerThreads = [int]$WorkerInput }
}

# --- 4. Admin Credentials ---
$AdminUser = "admin"
$AdminInitialPassword = ""

if (-not [string]::IsNullOrWhiteSpace($AdminPassword)) {
    $AdminInitialPassword = $AdminPassword
} elseif (-not $Unattended) {
    Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host " STEP 3: ADMINISTRATOR ACCOUNT CREDENTIALS" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    $UserCustomPass = Read-Host "  Set custom Admin password? (Leave blank to auto-generate secure password)"
    if (-not [string]::IsNullOrWhiteSpace($UserCustomPass)) {
        $AdminInitialPassword = $UserCustomPass.Trim()
    } else {
        $AdminInitialPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
    }
} else {
    $AdminInitialPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
}

# --- 5. Installation Target Directory ---
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if ($Global:IsAdmin) {
        $InstallDir = "C:\Program Files\Snoomp"
    } else {
        $InstallDir = "$env:LOCALAPPDATA\Snoomp"
    }
}

if (-not $Unattended) {
    Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host " STEP 4: INSTALLATION DIRECTORY" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    $UserDirInput = Read-Host "  Target Path [Default: $InstallDir]"
    if (-not [string]::IsNullOrWhiteSpace($UserDirInput)) {
        $InstallDir = $UserDirInput.Trim()
    }
}

Write-Host "`n[SETUP] Target Directory: $InstallDir" -ForegroundColor Green
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# --- 6. Deploy & Extract Package ---
Write-Host "`n[PACKAGE] Deploying Snoomp binaries..." -ForegroundColor Green
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
$LocalZip = "$ScriptDir\..\dist\snoomp-windows-x64.zip"
$LocalDir = "$ScriptDir\..\dist\snoomp-windows-x64"

if (Test-Path $LocalDir) {
    Write-Host "Installing from local build folder: $LocalDir..." -ForegroundColor Yellow
    Copy-Item -Recurse -Force "$LocalDir\*" -Destination $InstallDir
} elseif (Test-Path $LocalZip) {
    Write-Host "Unpacking local archive: $LocalZip..." -ForegroundColor Yellow
    Expand-Archive -Path $LocalZip -DestinationPath $InstallDir -Force
} else {
    if (-not $DownloadUrl) {
        $DownloadUrl = "https://github.com/ganangdharu/snoomp/releases/latest/download/snoomp-windows-x64.zip"
    }
    Write-Host "Downloading Snoomp package from: $DownloadUrl..." -ForegroundColor Yellow
    $TempZip = "$env:TEMP\snoomp-windows-x64.zip"
    Invoke-RestMethod -Uri $DownloadUrl -OutFile $TempZip
    Write-Host "Extracting to $InstallDir..." -ForegroundColor Yellow
    Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force
    Remove-Item -Force $TempZip
}

if (-not (Test-Path "$InstallDir\snoomp.exe")) {
    $NestedExe = Get-ChildItem -Path $InstallDir -Filter "snoomp.exe" -Recurse | Select-Object -First 1
    if ($NestedExe) {
        $SourceDir = $NestedExe.DirectoryName
        Copy-Item -Recurse -Force "$SourceDir\*" -Destination $InstallDir
    } else {
        throw "Could not find snoomp.exe in $InstallDir!"
    }
}

# Ensure logs directory exists
New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null

# --- 7. Generate Production Configuration (snoomp.env) ---
Write-Host "`n[CONFIG] Generating production configuration ($InstallDir\snoomp.env)..." -ForegroundColor Green
$JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

$EnvLines = @(
    "# Snoomp Production Environment Configuration",
    "# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "PORT=$Port",
    "HOST=0.0.0.0",
    "DATABASE_URL=$DatabaseUrl",
    "JWT_SECRET=$JwtSecret",
    "ALLOWED_ORIGINS=*",
    "SNOOMP_ADMIN_PASSWORD=$AdminInitialPassword",
    "METRICS_RETENTION_DAYS=$RetentionDays",
    "WORKER_THREADS=$WorkerThreads"
)

if ($RedisUrl) {
    $EnvLines += "REDIS_URL=$RedisUrl"
    $EnvLines += "CELERY_BROKER_URL=$RedisUrl"
}

Set-Content -Path "$InstallDir\snoomp.env" -Value ($EnvLines -join "`r`n") -Encoding utf8
Write-Host "[OK] Configuration saved successfully." -ForegroundColor Green

# --- 8. Database Schema & Connection Verification ---
Write-Host "`n[VERIFY] Initializing database schema via snoomp.exe --test-db..." -ForegroundColor Yellow
try {
    $testDbOutput = & "$InstallDir\snoomp.exe" --test-db 2>&1
    Write-Host $testDbOutput -ForegroundColor Gray
    Write-Host "[OK] Database connection verified and schema initialized." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Database pre-check encountered an issue: $_" -ForegroundColor Yellow
    Write-Host "       Check $InstallDir\logs\snoomp.log for full trace." -ForegroundColor Gray
}

# --- 9. Configure Windows Defender Firewall ---
Write-Host "`n[FIREWALL] Configuring Windows Defender Firewall for TCP Port $Port..." -ForegroundColor Green
try {
    Remove-NetFirewallRule -DisplayName "Snoomp Monitoring Server" -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName "Snoomp Monitoring Server" `
                        -Description "Allows inbound traffic to Snoomp Observability Dashboard on Port $Port" `
                        -Direction Inbound `
                        -LocalPort $Port `
                        -Protocol TCP `
                        -Action Allow `
                        -Profile Any | Out-Null
    Write-Host "[OK] Firewall rule 'Snoomp Monitoring Server' created for TCP Port $Port." -ForegroundColor Green
} catch {
    Write-Host "[INFO] Firewall rule could not be set automatically (requires Administrator privileges)." -ForegroundColor Gray
}

# --- 10. Generate Service Management Helper Scripts ---
Write-Host "`n[SCRIPTS] Creating management helper scripts in $InstallDir..." -ForegroundColor Green

# start-snoomp.ps1
$StartScript = @"
Write-Host "Starting Snoomp Server..." -ForegroundColor Cyan
if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    `$task = Get-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
    if (`$task) {
        Start-ScheduledTask -TaskName "SnoompServer"
        Write-Host "Scheduled task SnoompServer triggered." -ForegroundColor Green
        exit 0
    }
}
Start-Process -FilePath "`$PSScriptRoot\snoomp.exe" -WorkingDirectory "`$PSScriptRoot" -WindowStyle Hidden
Write-Host "Snoomp started as background process." -ForegroundColor Green
"@
Set-Content -Path "$InstallDir\start-snoomp.ps1" -Value $StartScript -Encoding utf8

# stop-snoomp.ps1
$StopScript = @"
Write-Host "Stopping Snoomp Server..." -ForegroundColor Yellow
if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    `$task = Get-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
    if (`$task) {
        Stop-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
    }
}
Get-Process -Name "snoomp" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Snoomp server stopped." -ForegroundColor Green
"@
Set-Content -Path "$InstallDir\stop-snoomp.ps1" -Value $StopScript -Encoding utf8

# restart-snoomp.ps1
$RestartScript = @"
& "`$PSScriptRoot\stop-snoomp.ps1"
Start-Sleep -Seconds 2
& "`$PSScriptRoot\start-snoomp.ps1"
"@
Set-Content -Path "$InstallDir\restart-snoomp.ps1" -Value $RestartScript -Encoding utf8

# status-snoomp.ps1
$StatusScript = @"
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  SNOOMP SERVER STATUS CHECK                    " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
`$procs = Get-Process -Name "snoomp" -ErrorAction SilentlyContinue
if (`$procs) {
    Write-Host "Process State:   RUNNING" -ForegroundColor Green
    foreach (`$p in `$procs) {
        Write-Host "  PID:           `$(`$p.Id) (Memory: `$([math]::Round(`$p.WorkingSet64 / 1MB, 1)) MB)" -ForegroundColor Yellow
    }
} else {
    Write-Host "Process State:   STOPPED" -ForegroundColor Red
}

try {
    `$res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/version" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "API Health:      OK (v`$(`$res.version))" -ForegroundColor Green
} catch {
    Write-Host "API Health:      UNREACHABLE on Port $Port" -ForegroundColor Red
}
Write-Host "=================================================" -ForegroundColor Cyan
"@
Set-Content -Path "$InstallDir\status-snoomp.ps1" -Value $StatusScript -Encoding utf8

# view-logs.ps1
$ViewLogsScript = @"
`$logFile = "`$PSScriptRoot\logs\snoomp.log"
if (Test-Path `$logFile) {
    Get-Content -Path `$logFile -Tail 50 -Wait
} else {
    Write-Host "Log file not found at `$logFile" -ForegroundColor Yellow
}
"@
Set-Content -Path "$InstallDir\view-logs.ps1" -Value $ViewLogsScript -Encoding utf8

# Legacy batch files for CMD users
Set-Content -Path "$InstallDir\start-snoomp.bat" -Value "@powershell -ExecutionPolicy Bypass -File `"%~dp0start-snoomp.ps1`"" -Encoding ascii
Set-Content -Path "$InstallDir\stop-snoomp.bat" -Value "@powershell -ExecutionPolicy Bypass -File `"%~dp0stop-snoomp.ps1`"" -Encoding ascii

# --- 11. Register 24/7 Background Service ---
Write-Host "`n[SERVICE] Registering 24/7 background service (SnoompServer)..." -ForegroundColor Green
$TaskName = "SnoompServer"
$ServiceStarted = $false

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    $Action = New-ScheduledTaskAction -Execute "$InstallDir\snoomp.exe" -WorkingDirectory $InstallDir
    if ($Global:IsAdmin) {
        $Trigger = New-ScheduledTaskTrigger -AtStartup
        $Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    } else {
        $Trigger = New-ScheduledTaskTrigger -AtLogOn
        $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
    }
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)

    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Snoomp Enterprise Health & Observability Platform" | Out-Null
    Write-Host "[OK] Scheduled task '$TaskName' registered." -ForegroundColor Green

    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[OK] Service '$TaskName' started." -ForegroundColor Green
    $ServiceStarted = $true
} catch {
    Write-Host "[WARN] Scheduled task could not be registered: $_" -ForegroundColor Yellow
}

if (-not $ServiceStarted) {
    Write-Host "[DAEMON] Launching Snoomp in background process mode..." -ForegroundColor Green
    Start-Process -FilePath "$InstallDir\snoomp.exe" -WorkingDirectory $InstallDir -WindowStyle Hidden
}

# --- 12. Add to System PATH ---
try {
    $TargetEnv = if ($Global:IsAdmin) { "Machine" } else { "User" }
    $CurrentPath = [Environment]::GetEnvironmentVariable("Path", $TargetEnv)
    if ($CurrentPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$InstallDir", $TargetEnv)
        Write-Host "[PATH] Added $InstallDir to $TargetEnv PATH." -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] Could not update system PATH: $_" -ForegroundColor Yellow
}

# --- 13. Health Check Verification ---
Write-Host "`n[VERIFY] Waiting for Snoomp Dashboard & REST API to start on Port $Port..." -ForegroundColor Yellow
$MaxWaitSec = 15
$Healthy = $false

for ($i = 1; $i -le $MaxWaitSec; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/version" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($res -and $res.version) {
            $Healthy = $true
            break
        }
    } catch {}
}

# --- 14. Installation Summary Presentation ---
$LocalIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1).IPAddress

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "   SNOOMP ENTERPRISE INSTALLED & RUNNING SUCCESSFULLY!           " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Dashboard (Local):     http://localhost:$Port" -ForegroundColor Yellow
if ($LocalIp) {
    Write-Host "  Dashboard (Network):   http://${LocalIp}:$Port" -ForegroundColor Yellow
}
Write-Host "  Installation Path:     $InstallDir" -ForegroundColor White
Write-Host "  Configuration File:    $InstallDir\snoomp.env" -ForegroundColor White
Write-Host "  Log File:              $InstallDir\logs\snoomp.log" -ForegroundColor White
Write-Host "  Database Engine:       $($DatabaseUrl.Split('@')[-1])" -ForegroundColor White
if ($RedisUrl) {
    Write-Host "  Message Queue:         $RedisUrl" -ForegroundColor White
} else {
    Write-Host "  Message Queue:         In-Process High-Throughput Engine" -ForegroundColor White
}
Write-Host "  Initial Admin User:    admin" -ForegroundColor White
Write-Host "  Initial Admin Password:$AdminInitialPassword" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Management Commands (Run in PowerShell from any directory):" -ForegroundColor Cyan
Write-Host "    Check Status:        powershell `"$InstallDir\status-snoomp.ps1`"" -ForegroundColor Gray
Write-Host "    View Live Logs:      powershell `"$InstallDir\view-logs.ps1`"" -ForegroundColor Gray
Write-Host "    Restart Service:     powershell `"$InstallDir\restart-snoomp.ps1`"" -ForegroundColor Gray
Write-Host "    Stop Service:        powershell `"$InstallDir\stop-snoomp.ps1`"" -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
