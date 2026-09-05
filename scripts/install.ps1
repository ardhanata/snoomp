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
    [switch]$Unattended = $false,
    [switch]$PreflightOnly = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }

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
    
    if (-not $Global:IsAdmin -and -not $Unattended -and -not $PreflightOnly) {
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

# --- 2. Port Collision Detection, Hyper-V Check & Pre-Flight Network Scan ---
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
    # 1. Hyper-V dynamic exclusion range check
    if (Test-PortHyperVExcluded $p) {
        return $false
    }

    # 2. Existing listener check
    try {
        $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        if ($null -ne $conn) {
            return $false
        }
    } catch {}

    # 3. Active socket bind attempt
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
                ProcessName      = if ($proc) { $proc.ProcessName } else { "System / Protected" }
                Path             = if ($proc -and $proc.Path) { $proc.Path } else { "N/A" }
                IsHyperVExcluded = $isExcluded
            }
        }
    } catch {}

    if ($isExcluded) {
        return [PSCustomObject]@{
            Port             = $p
            PID              = 0
            ProcessName      = "Windows Hyper-V / Host Network Reserved Range"
            Path             = "System Kernel"
            IsHyperVExcluded = $true
        }
    }
    return $null
}

function Find-NextAvailablePort([int]$startPort) {
    $p = $startPort
    while (-not (Test-PortAvailable $p)) {
        $p++
        if ($p -gt 65535) {
            throw "No available TCP port found in range $startPort to 65535."
        }
    }
    return $p
}

function Test-TcpEndpoint([string]$hostName, [int]$portNum, [int]$timeoutMs = 2000) {
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

function Invoke-DownloadWithProgress {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$DestinationPath
    )

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.UserAgent = "SnoompInstaller/1.0.0"
    $req.AllowAutoRedirect = $true
    $resp = $req.GetResponse()
    $totalBytes = $resp.ContentLength
    $stream = $resp.GetResponseStream()
    $targetFile = [System.IO.File]::Create($DestinationPath)

    $buffer = New-Object byte[] 65536
    $bytesRead = 0
    $totalRead = 0
    $lastReportPercent = -1

    try {
        while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $targetFile.Write($buffer, 0, $bytesRead)
            $totalRead += $bytesRead

            if ($totalBytes -gt 0) {
                $percent = [math]::Floor(($totalRead / $totalBytes) * 100)
                if ($percent -ne $lastReportPercent -and ($percent % 10 -eq 0 -or $percent -eq 100)) {
                    $mbRead = [math]::Round($totalRead / 1MB, 1)
                    $mbTotal = [math]::Round($totalBytes / 1MB, 1)
                    $barLength = 20
                    $filled = [math]::Floor(($percent / 100) * $barLength)
                    $empty = $barLength - $filled
                    $bar = ("=" * $filled) + (" " * $empty)
                    Write-Host "  [$bar] $percent% ($mbRead MB / $mbTotal MB)" -ForegroundColor Cyan
                    $lastReportPercent = $percent
                }
            } else {
                $mbRead = [math]::Round($totalRead / 1MB, 1)
                Write-Host "  Downloaded: $mbRead MB..." -ForegroundColor Cyan
            }
        }
        $targetFile.Flush()
        Write-Host "  [OK] Download completed ($([math]::Round($totalRead / 1MB, 1)) MB)." -ForegroundColor Green
    } finally {
        $targetFile.Close()
        $stream.Close()
        $resp.Close()
    }
}

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
        $desc = if ($occ.IsHyperVExcluded) { "Hyper-V Reserved Range" } else { "$($occ.ProcessName) (PID: $($occ.PID))" }
        Write-Host "   $desc" -ForegroundColor Yellow
        $results[8008] = @{ Status = "CONFLICT"; Occupant = $occ }
    }

    # 2. Port 5432 (PostgreSQL)
    $pgListening = Test-TcpEndpoint "127.0.0.1" 5432 1000
    if ($pgListening) {
        $pgOcc = Get-PortOccupant 5432
        $pgName = if ($pgOcc) { "$($pgOcc.ProcessName) (PID: $($pgOcc.PID))" } else { "Active Daemon" }
        Write-Host " 5432   PostgreSQL Database      " -NoNewline
        Write-Host "[ACTIVE]" -ForegroundColor Green -NoNewline
        Write-Host "     Local service detected ($pgName)" -ForegroundColor Gray
        $results[5432] = @{ Status = "ACTIVE"; Occupant = $pgOcc }
    } else {
        Write-Host " 5432   PostgreSQL Database      " -NoNewline
        Write-Host "[FREE/OFF]" -ForegroundColor Gray -NoNewline
        Write-Host "   No local service (remote or SQLite)" -ForegroundColor Gray
        $results[5432] = @{ Status = "INACTIVE"; Occupant = $null }
    }

    # 3. Port 6379 (Redis)
    $redisListening = Test-TcpEndpoint "127.0.0.1" 6379 1000
    if ($redisListening) {
        $rOcc = Get-PortOccupant 6379
        $rName = if ($rOcc) { "$($rOcc.ProcessName) (PID: $($rOcc.PID))" } else { "Active Daemon" }
        Write-Host " 6379   Redis Message Broker     " -NoNewline
        Write-Host "[ACTIVE]" -ForegroundColor Green -NoNewline
        Write-Host "     Local service detected ($rName)" -ForegroundColor Gray
        $results[6379] = @{ Status = "ACTIVE"; Occupant = $rOcc }
    } else {
        Write-Host " 6379   Redis Message Broker     " -NoNewline
        Write-Host "[FREE/OFF]" -ForegroundColor Gray -NoNewline
        Write-Host "   No local service (in-process scheduler)" -ForegroundColor Gray
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

    # Auto-adoption: If default port 8008 is requested (or defaulted) and is FREE, adopt immediately
    if ($SelectedPort -eq 8008 -and $ScanResults -and $ScanResults[8008] -and $ScanResults[8008].Status -eq "FREE") {
        Write-Host "[PORT CONFIRMED] Port 8008 is free -- automatically adopted as default.`n" -ForegroundColor Green
        return 8008
    }

    # If already available on custom requested port
    if (Test-PortAvailable $SelectedPort) {
        Write-Host "[PORT CONFIRMED] Port $SelectedPort is free and available.`n" -ForegroundColor Green
        return $SelectedPort
    }

    # Conflict resolution loop
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
            $procDesc = "$($occupant.ProcessName), PID: $($occupant.PID)"
            Write-Host "  [3] Terminate conflicting process ($procDesc)" -ForegroundColor White
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

# Run Pre-flight network port scan
$ScanResults = Show-PreflightPortScan

if ($PreflightOnly) {
    Write-Host "[PRE-FLIGHT COMPLETED] Network port scan finished." -ForegroundColor Green
    return $ScanResults
}

# Resolve Web Dashboard & API Port
$Port = Resolve-PortSelection -InitialPort $Port -ScanResults $ScanResults -Interactive (-not $Unattended)

# --- 2.5 Automated Dependency Provisioning (PostgreSQL & Redis) ---

function Invoke-PsqlCommand {
    param(
        [Parameter(Mandatory=$true)][string]$PsqlExe,
        [Parameter(Mandatory=$true)][string[]]$ArgumentList,
        [string]$Password = ""
    )
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    if ($Password) {
        $env:PGPASSWORD = $Password
    }
    try {
        # Ensure -w is passed to prevent psql hanging on interactive password prompts
        $psqlArgs = if ($ArgumentList -contains "-w") { $ArgumentList } else { @("-w") + $ArgumentList }
        $res = & $PsqlExe $psqlArgs 2>&1
        $outStr = ($res | Out-String).Trim()
        return [PSCustomObject]@{
            ExitCode = $LASTEXITCODE
            Output   = $outStr
        }
    } finally {
        Remove-Item env:PGPASSWORD -ErrorAction SilentlyContinue
        $ErrorActionPreference = $oldEap
    }
}

function Ensure-PostgresDatabaseAndUser {
    param(
        [string]$HostName = "127.0.0.1",
        [int]$Port = 5432,
        [string]$DatabaseName = "snoomp_db",
        [string]$SnoompUser = "snoomp_admin",
        [string]$SnoompPassword = "",
        [string]$SuperUserPassword = ""
    )

    $resolvedPsql = @()
    try {
        $candidates = Get-ChildItem -Path "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
            Sort-Object {
                $verNum = 0.0
                if ([double]::TryParse($_.Name, [ref]$verNum)) { $verNum } else { 0.0 }
            } -Descending
        foreach ($d in $candidates) {
            $p = Join-Path $d.FullName "bin\psql.exe"
            if (Test-Path $p) {
                $resolvedPsql += $p
            }
        }
    } catch {}

    $psqlExe = $null
    if ($resolvedPsql.Count -gt 0) {
        $psqlExe = $resolvedPsql[0]
    } else {
        $cmdPsql = Get-Command psql.exe -ErrorAction SilentlyContinue
        if ($cmdPsql) { $psqlExe = $cmdPsql.Source }
    }

    if (-not $psqlExe) {
        Write-Host "  [INFO] psql.exe not found in standard paths; proceeding with connection string." -ForegroundColor Gray
        return $true
    }

    Write-Host "  Verifying PostgreSQL authentication for '$SnoompUser'..." -ForegroundColor Yellow
    $testUserConn = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", $SnoompUser, "-d", $DatabaseName, "-c", "SELECT 1;") -Password $SnoompPassword

    if ($testUserConn.ExitCode -eq 0) {
        Write-Host "  [OK] Successfully authenticated to '$DatabaseName' as '$SnoompUser'." -ForegroundColor Green
        return $true
    }

    if ($testUserConn.Output -match 'does not exist') {
        Write-Host "  [INFO] Role '$SnoompUser' or database '$DatabaseName' does not exist -- initiating setup." -ForegroundColor Yellow
    } elseif ($testUserConn.Output -match 'password authentication failed') {
        Write-Host "  [WARN] Role '$SnoompUser' exists but password authentication failed. Re-syncing credentials via superuser..." -ForegroundColor Yellow
    } else {
        Write-Host "  [INFO] Database probe output: $($testUserConn.Output)" -ForegroundColor Gray
    }

    Write-Host "  Attempting automated setup via PostgreSQL 'postgres' superuser..." -ForegroundColor Yellow

    $superCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($SuperUserPassword)) { $superCandidates += $SuperUserPassword }
    if (-not [string]::IsNullOrWhiteSpace($SnoompPassword) -and $SnoompPassword -notin $superCandidates) { $superCandidates += $SnoompPassword }
    foreach ($cand in @("postgres", "root", "admin", "")) {
        if ($cand -notin $superCandidates) { $superCandidates += $cand }
    }

    $authenticatedSuper = $null
    foreach ($cand in $superCandidates) {
        $testSuper = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-c", "SELECT 1;") -Password $cand
        if ($testSuper.ExitCode -eq 0) {
            $authenticatedSuper = $cand
            break
        }
    }

    if ($null -eq $authenticatedSuper) {
        Write-Host "  Connecting as PostgreSQL superuser 'postgres' requires credentials." -ForegroundColor Yellow
        $superInput = Read-Host "  Enter 'postgres' superuser password" -AsSecureString
        $Bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($superInput)
        try {
            $enteredPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($Bstr)
        } finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
        }
        if (-not [string]::IsNullOrWhiteSpace($enteredPass)) {
            $testSuper = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-c", "SELECT 1;") -Password $enteredPass
            if ($testSuper.ExitCode -eq 0) {
                $authenticatedSuper = $enteredPass
            }
        }
    }

    if ($null -ne $authenticatedSuper) {
        Write-Host "  Creating/updating role '$SnoompUser' (least privilege LOGIN role)..." -ForegroundColor Yellow
        $createRoleSql = "DO `$do`$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'u') THEN EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'u', :'p'); ELSE EXECUTE format('ALTER ROLE %I PASSWORD %L', :'u', :'p'); END IF; END `$do`$;"
        $null = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-v", "u=$SnoompUser", "-v", "p=$SnoompPassword", "-c", $createRoleSql) -Password $authenticatedSuper

        Write-Host "  Ensuring database '$DatabaseName' exists with owner '$SnoompUser'..." -ForegroundColor Yellow
        $checkDbSql = "SELECT 1 FROM pg_database WHERE datname = :'d';"
        $resCheck = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-t", "-v", "d=$DatabaseName", "-c", $checkDbSql) -Password $authenticatedSuper

        if ($resCheck.Output -notmatch "1") {
            $null = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-v", "d=$DatabaseName", "-v", "u=$SnoompUser", "-c", "CREATE DATABASE :`"d`" OWNER :`"u`";") -Password $authenticatedSuper
        } else {
            $null = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-v", "d=$DatabaseName", "-v", "u=$SnoompUser", "-c", "ALTER DATABASE :`"d`" OWNER TO :`"u`";") -Password $authenticatedSuper
        }

        # Ensure full grants on the target database
        $null = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", "postgres", "-d", "postgres", "-v", "d=$DatabaseName", "-v", "u=$SnoompUser", "-c", "GRANT ALL PRIVILEGES ON DATABASE :`"d`" TO :`"u`";") -Password $authenticatedSuper

        # Final verification
        $verifyConn = Invoke-PsqlCommand -PsqlExe $psqlExe -ArgumentList @("-h", $HostName, "-p", "$Port", "-U", $SnoompUser, "-d", $DatabaseName, "-c", "SELECT 1;") -Password $SnoompPassword
        if ($verifyConn.ExitCode -eq 0) {
            Write-Host "  [OK] Successfully configured PostgreSQL database '$DatabaseName' and user '$SnoompUser'!" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [WARN] Database created but connection check output: $($verifyConn.Output)" -ForegroundColor Yellow
            return $false
        }
    } else {
        Write-Host "  [WARN] Could not authenticate as 'postgres' superuser to auto-provision." -ForegroundColor Yellow
        Write-Host "         You may need to manually execute:" -ForegroundColor Gray
        Write-Host "         psql -U postgres -c `"CREATE USER $SnoompUser WITH PASSWORD '$SnoompPassword';`"" -ForegroundColor Gray
        Write-Host "         psql -U postgres -c `"CREATE DATABASE $DatabaseName OWNER $SnoompUser;`"" -ForegroundColor Gray
        return $false
    }
}

function Install-PostgreSqlDependency {
    param(
        [int]$Port = 5432,
        [string]$SuperUserPassword = "snoomp_postgres_pass",
        [string]$SnoompUser = "snoomp_admin",
        [string]$SnoompPassword = "snoomp_secure_password",
        [string]$DatabaseName = "snoomp_db"
    )

    Write-Host "`n[DEPENDENCY] Initiating automated PostgreSQL 15 installation..." -ForegroundColor Cyan
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue

    $installed = $false
    if ($wingetCmd) {
        Write-Host "  Using Windows Package Manager (winget) to install PostgreSQL 15..." -ForegroundColor Yellow
        Write-Host "  Executing unattended silent setup..." -ForegroundColor Gray
        try {
            $wingetArgs = @(
                "install",
                "--id", "PostgreSQL.PostgreSQL.15",
                "--exact",
                "--silent",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--override", "--mode unattended --unattendedmodeui none --superpassword `"$SuperUserPassword`" --serverport $Port"
            )
            $p = Start-Process -FilePath "winget" -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -eq 0) {
                Write-Host "  [OK] winget installation command finished successfully." -ForegroundColor Green
                $installed = $true
            } else {
                Write-Host "  [WARN] winget exited with code $($p.ExitCode). Falling back to direct installer download..." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [WARN] winget execution failed: $_. Falling back to direct installer download..." -ForegroundColor Yellow
        }
    }

    if (-not $installed) {
        $installerUrl = "https://get.enterprisedb.com/postgresql/postgresql-15.19-3-windows-x64.exe"
        $installerPath = "$env:TEMP\postgresql-15-installer.exe"
        Write-Host "  Downloading PostgreSQL 15 installer directly from EnterpriseDB..." -ForegroundColor Yellow
        Write-Host "  URL: $installerUrl" -ForegroundColor Gray
        try {
            Invoke-DownloadWithProgress -Url $installerUrl -DestinationPath $installerPath
            Write-Host "  Running silent installer (this may take 1-2 minutes)..." -ForegroundColor Yellow
            $instArgs = "--mode unattended --unattendedmodeui none --superpassword `"$SuperUserPassword`" --serverport $Port"
            $p = Start-Process -FilePath $installerPath -ArgumentList $instArgs -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -eq 0) {
                $installed = $true
            } else {
                Write-Host "  [WARN] Installer exited with code $($p.ExitCode)." -ForegroundColor Yellow
            }
            Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "  [ERROR] Direct download/install failed: $_" -ForegroundColor Red
            return $false
        }
    }

    # Wait for PostgreSQL service to start listening on $Port
    Write-Host "  Waiting for PostgreSQL service to start listening on port $Port..." -ForegroundColor Yellow
    $waited = 0
    while ($waited -lt 60) {
        if (Test-TcpEndpoint "127.0.0.1" $Port 1000) {
            Write-Host "  [OK] PostgreSQL is actively listening on port $Port!" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 2
        $waited += 2
    }

    if (-not (Test-TcpEndpoint "127.0.0.1" $Port 1000)) {
        Write-Host "  [ERROR] PostgreSQL service did not start within 60 seconds." -ForegroundColor Red
        return $false
    }

    return (Ensure-PostgresDatabaseAndUser -HostName "127.0.0.1" -Port $Port -DatabaseName $DatabaseName -SnoompUser $SnoompUser -SnoompPassword $SnoompPassword -SuperUserPassword $SuperUserPassword)
}

function Install-RedisDependency {
    param(
        [int]$Port = 6379,
        [string]$TargetDir = "C:\Program Files\Redis"
    )

    Write-Host "`n[DEPENDENCY] Initiating automated Redis service installation..." -ForegroundColor Cyan

    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    $installed = $false

    if ($wingetCmd) {
        Write-Host "  Attempting package installation via winget..." -ForegroundColor Yellow
        try {
            $p = Start-Process -FilePath "winget" -ArgumentList "install --id taizod1024.redis-windows-fork --exact --silent --accept-source-agreements --accept-package-agreements" -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -eq 0) {
                Write-Host "  [OK] winget installed Redis package successfully." -ForegroundColor Green
                $installed = $true
            }
        } catch {
            Write-Host "  [INFO] winget install attempt skipped: $_" -ForegroundColor Gray
        }
    }

    # Verify if service is already running on $Port after winget
    if (Test-TcpEndpoint "127.0.0.1" $Port 1500) {
        Write-Host "  [OK] Redis is actively listening on port $Port!" -ForegroundColor Green
        return $true
    }

    # Fallback to direct standalone Redis Windows zip binary distribution
    Write-Host "  Deploying standalone native Redis Windows Service..." -ForegroundColor Yellow
    $redisZipUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    $tempZip = "$env:TEMP\Redis-x64-5.0.14.1.zip"

    try {
        if (-not (Test-Path $TargetDir)) {
            New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
        }

        Write-Host "  Downloading Redis binary archive from GitHub ($redisZipUrl)..." -ForegroundColor Gray
        Invoke-DownloadWithProgress -Url $redisZipUrl -DestinationPath $tempZip

        Write-Host "  Extracting Redis binaries to $TargetDir..." -ForegroundColor Gray
        Expand-Archive -Path $tempZip -DestinationPath $TargetDir -Force
        Remove-Item $tempZip -Force -ErrorAction SilentlyContinue

        $redisServerExe = "$TargetDir\redis-server.exe"
        if (Test-Path $redisServerExe) {
            Write-Host "  Registering and starting SnoompRedis Windows Service on port $Port..." -ForegroundColor Yellow
            $confPath = "$TargetDir\redis.windows-service.conf"
            if (-not (Test-Path $confPath)) {
                $confPath = "$TargetDir\redis.windows.conf"
            }
            if (Test-Path $confPath) {
                & "$redisServerExe" --service-install "$confPath" --service-name SnoompRedis --port $Port 2>&1 | Out-Null
            } else {
                & "$redisServerExe" --service-install --service-name SnoompRedis --port $Port 2>&1 | Out-Null
            }
            & "$redisServerExe" --service-start --service-name SnoompRedis 2>&1 | Out-Null
            Start-Service -Name "SnoompRedis" -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Host "  [ERROR] Failed to extract or start Redis service: $_" -ForegroundColor Red
        return $false
    }

    # Poll port to verify
    Write-Host "  Verifying Redis listener on port $Port..." -ForegroundColor Yellow
    $waited = 0
    while ($waited -lt 15) {
        if (Test-TcpEndpoint "127.0.0.1" $Port 1000) {
            Write-Host "  [OK] Redis service is active and listening on port $Port!" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 1
        $waited += 1
    }

    if (Test-TcpEndpoint "127.0.0.1" $Port 1000) {
        return $true
    } else {
        Write-Host "  [WARN] Redis service installation completed but port $Port was not reachable." -ForegroundColor Yellow
        return $false
    }
}

# --- 3. Production Architecture & Package Selection ---

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
    if ($ScanResults -and $ScanResults[5432] -and $ScanResults[5432].Status -eq "ACTIVE") {
        Write-Host "  [DETECTED] Local PostgreSQL service active on port 5432." -ForegroundColor Green
    }
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
        try {
            $PlainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($Bstr)
        } finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
        }

        # Pre-flight TCP verification
        Write-Host "  Verifying TCP connection to ${PgHost}:${PgPort}..." -ForegroundColor Yellow
        $canConnect = Test-TcpEndpoint -hostName $PgHost -portNum ([int]$PgPort)
        if ($canConnect) {
            Write-Host "  [OK] Successfully reached PostgreSQL service at ${PgHost}:${PgPort}" -ForegroundColor Green
            $isLocal = ($PgHost -eq "127.0.0.1" -or $PgHost -eq "localhost")
            if ($isLocal) {
                $isProvisioned = Ensure-PostgresDatabaseAndUser -HostName $PgHost -Port ([int]$PgPort) -DatabaseName $PgDb -SnoompUser $PgUser -SnoompPassword $PlainPass
                if ($isProvisioned) {
                    $encPass = [System.Uri]::EscapeDataString($PlainPass)
                    $DatabaseUrl = "postgresql://${PgUser}:${encPass}@${PgHost}:${PgPort}/${PgDb}"
                    $PgVerified = $true
                } else {
                    Write-Host "  [WARN] PostgreSQL automated provisioning did not succeed." -ForegroundColor Red
                    Write-Host "  [1] Re-enter PostgreSQL connection details" -ForegroundColor White
                    Write-Host "  [2] Proceed anyway (assuming database and user will be configured manually)" -ForegroundColor White
                    Write-Host "  [3] Fallback to Embedded SQLite" -ForegroundColor White
                    $failChoice = Read-Host "  Selection [Default: 1]"
                    if ($failChoice -eq "2") {
                        $encPass = [System.Uri]::EscapeDataString($PlainPass)
                        $DatabaseUrl = "postgresql://${PgUser}:${encPass}@${PgHost}:${PgPort}/${PgDb}"
                        $PgVerified = $true
                    } elseif ($failChoice -eq "3") {
                        $DatabaseUrl = "sqlite:///snoomp.db"
                        Write-Host "  Using Embedded SQLite as requested." -ForegroundColor Yellow
                        $PgVerified = $true
                    }
                }
            } else {
                $encPass = [System.Uri]::EscapeDataString($PlainPass)
                $DatabaseUrl = "postgresql://${PgUser}:${encPass}@${PgHost}:${PgPort}/${PgDb}"
                $PgVerified = $true
            }
        } else {
            Write-Host "  [WARN] Cannot connect to ${PgHost}:${PgPort}! Is PostgreSQL/TimescaleDB running?" -ForegroundColor Red
            $isLocal = ($PgHost -eq "127.0.0.1" -or $PgHost -eq "localhost")
            if ($isLocal) {
                Write-Host "  [1] Automatically install and configure PostgreSQL 15 on this machine (Recommended)" -ForegroundColor Cyan
                Write-Host "  [2] Re-enter PostgreSQL connection details" -ForegroundColor White
                Write-Host "  [3] Proceed anyway (assuming database service will start later)" -ForegroundColor White
                Write-Host "  [4] Fallback to Embedded SQLite" -ForegroundColor White
                $warnChoice = Read-Host "  Selection [Default: 1]"

                if ([string]::IsNullOrWhiteSpace($warnChoice) -or $warnChoice -eq "1") {
                    $installPass = if (-not [string]::IsNullOrWhiteSpace($PlainPass)) { $PlainPass } else { "snoomp_secure_password" }
                    $installed = Install-PostgreSqlDependency -Port ([int]$PgPort) -SuperUserPassword $installPass -SnoompUser $PgUser -SnoompPassword $installPass -DatabaseName $PgDb
                    if ($installed) {
                        $encInstallPass = [System.Uri]::EscapeDataString($installPass)
                        $DatabaseUrl = "postgresql://${PgUser}:${encInstallPass}@${PgHost}:${PgPort}/${PgDb}"
                        $PgVerified = $true
                    } else {
                        Write-Host "  Automated installation could not complete. You may re-enter details or fallback." -ForegroundColor Yellow
                    }
                } elseif ($warnChoice -eq "3") {
                    $encPass = [System.Uri]::EscapeDataString($PlainPass)
                    $DatabaseUrl = "postgresql://${PgUser}:${encPass}@${PgHost}:${PgPort}/${PgDb}"
                    $PgVerified = $true
                } elseif ($warnChoice -eq "4") {
                    $DatabaseUrl = "sqlite:///snoomp.db"
                    Write-Host "  Using Embedded SQLite as requested." -ForegroundColor Yellow
                    $PgVerified = $true
                }
            } else {
                Write-Host "  [1] Re-enter PostgreSQL connection details" -ForegroundColor White
                Write-Host "  [2] Proceed anyway (assuming database service will start later)" -ForegroundColor White
                Write-Host "  [3] Fallback to Embedded SQLite" -ForegroundColor White
                $warnChoice = Read-Host "  Selection [Default: 1]"
                if ($warnChoice -eq "2") {
                    $encPass = [System.Uri]::EscapeDataString($PlainPass)
                    $DatabaseUrl = "postgresql://${PgUser}:${encPass}@${PgHost}:${PgPort}/${PgDb}"
                    $PgVerified = $true
                } elseif ($warnChoice -eq "3") {
                    $DatabaseUrl = "sqlite:///snoomp.db"
                    Write-Host "  Using Embedded SQLite as requested." -ForegroundColor Yellow
                    $PgVerified = $true
                }
            }
        }
    }

    Write-Host "`n--- [2/3] Redis Message Broker Configuration ---" -ForegroundColor Cyan
    if ($ScanResults -and $ScanResults[6379] -and $ScanResults[6379].Status -eq "ACTIVE") {
        Write-Host "  [DETECTED] Local Redis service active on port 6379." -ForegroundColor Green
    }
    $RHost = Read-Host "  Redis Host [Default: 127.0.0.1, or press Enter to skip]"
    if (-not [string]::IsNullOrWhiteSpace($RHost)) {
        $RPort = Read-Host "  Redis Port [Default: 6379]"
        if ([string]::IsNullOrWhiteSpace($RPort)) { $RPort = "6379" }

        Write-Host "  Verifying TCP connection to ${RHost}:${RPort}..." -ForegroundColor Yellow
        if (Test-TcpEndpoint -hostName $RHost -portNum ([int]$RPort)) {
            Write-Host "  [OK] Successfully reached Redis service at ${RHost}:${RPort}" -ForegroundColor Green
            $RedisUrl = "redis://${RHost}:${RPort}/0"
        } else {
            Write-Host "  [WARN] Redis not reachable at ${RHost}:${RPort}." -ForegroundColor Yellow
            $isLocalR = ($RHost -eq "127.0.0.1" -or $RHost -eq "localhost")
            if ($isLocalR) {
                Write-Host "  [1] Automatically install Redis Windows service on this machine (Recommended)" -ForegroundColor Cyan
                Write-Host "  [2] Skip Redis (Use in-process scheduler engine)" -ForegroundColor White
                $rChoice = Read-Host "  Selection [Default: 1]"
                if ([string]::IsNullOrWhiteSpace($rChoice) -or $rChoice -eq "1") {
                    $rInstalled = Install-RedisDependency -Port ([int]$RPort)
                    if ($rInstalled) {
                        $RedisUrl = "redis://${RHost}:${RPort}/0"
                    } else {
                        Write-Host "  Redis installation failed; falling back to in-process scheduler engine." -ForegroundColor Yellow
                    }
                } else {
                    Write-Host "  Skipping Redis. In-process high-performance thread pool scheduler will be used." -ForegroundColor Gray
                }
            } else {
                Write-Host "  Falling back to in-process scheduler engine." -ForegroundColor Yellow
            }
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

$ScriptDir = $null
if ($MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
    try {
        $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
    } catch {}
} elseif ($PSScriptRoot) {
    $ScriptDir = $PSScriptRoot
}

# Search candidate local directories and archives
$LocalDir = $null
$LocalZip = $null

$CandidateDirs = @()
if ($ScriptDir) {
    $CandidateDirs += "$ScriptDir\..\dist\snoomp-windows-x64"
    $CandidateDirs += "$ScriptDir\dist\snoomp-windows-x64"
}
$CandidateDirs += "$PWD\dist\snoomp-windows-x64"
$CandidateDirs += "$PWD\snoomp-windows-x64"
$CandidateDirs += "D:\Project\snoomp\dist\snoomp-windows-x64"

foreach ($cDir in $CandidateDirs) {
    if ($cDir -and (Test-Path $cDir) -and (Test-Path "$cDir\snoomp.exe")) {
        $LocalDir = (Resolve-Path $cDir).Path
        break
    }
}

if (-not $LocalDir) {
    $CandidateZips = @()
    if ($ScriptDir) {
        $CandidateZips += "$ScriptDir\..\dist\snoomp-windows-x64.zip"
        $CandidateZips += "$ScriptDir\dist\snoomp-windows-x64.zip"
    }
    $CandidateZips += "$PWD\dist\snoomp-windows-x64.zip"
    $CandidateZips += "$PWD\snoomp-windows-x64.zip"
    $CandidateZips += "D:\Project\snoomp\dist\snoomp-windows-x64.zip"

    foreach ($cZip in $CandidateZips) {
        if ($cZip -and (Test-Path $cZip)) {
            $LocalZip = (Resolve-Path $cZip).Path
            break
        }
    }
}

if ($LocalDir) {
    Write-Host "Installing from local build folder: $LocalDir..." -ForegroundColor Yellow
    Copy-Item -Recurse -Force "$LocalDir\*" -Destination $InstallDir
} elseif ($LocalZip) {
    Write-Host "Unpacking local archive: $LocalZip..." -ForegroundColor Yellow
    Expand-Archive -Path $LocalZip -DestinationPath $InstallDir -Force
} else {
    if (-not $DownloadUrl) {
        $DownloadUrl = "https://github.com/ardhanata/snoomp/releases/latest/download/snoomp-windows-x64.zip"
    }
    Write-Host "Downloading Snoomp package from: $DownloadUrl..." -ForegroundColor Yellow
    $TempZip = "$env:TEMP\snoomp-windows-x64.zip"
    $downloadSuccess = $false
    try {
        Invoke-DownloadWithProgress -Url $DownloadUrl -DestinationPath $TempZip
        $downloadSuccess = $true
    } catch {
        Write-Host "  [WARN] Failed to download package from $DownloadUrl : $_" -ForegroundColor Yellow
    }

    if ($downloadSuccess -and (Test-Path $TempZip)) {
        Write-Host "Extracting to $InstallDir..." -ForegroundColor Yellow
        Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force
        Remove-Item -Force $TempZip -ErrorAction SilentlyContinue
    } else {
        $CandidateBuildScripts = @()
        if ($ScriptDir) { $CandidateBuildScripts += "$ScriptDir\build-windows.ps1" }
        $CandidateBuildScripts += "$PWD\scripts\build-windows.ps1"
        $CandidateBuildScripts += "D:\Project\snoomp\scripts\build-windows.ps1"
        
        $buildRan = $false
        foreach ($bScript in $CandidateBuildScripts) {
            if ($bScript -and (Test-Path $bScript)) {
                Write-Host "Compiling standalone Windows binary from local repository: $bScript..." -ForegroundColor Cyan
                & powershell -NoProfile -ExecutionPolicy Bypass -File $bScript
                $buildRan = $true
                break
            }
        }
        
        foreach ($cDir in $CandidateDirs) {
            if ($cDir -and (Test-Path $cDir) -and (Test-Path "$cDir\snoomp.exe")) {
                $LocalDir = (Resolve-Path $cDir).Path
                break
            }
        }
        if ($LocalDir) {
            Write-Host "Installing from newly compiled local build folder: $LocalDir..." -ForegroundColor Yellow
            Copy-Item -Recurse -Force "$LocalDir\*" -Destination $InstallDir
        } else {
            throw "Unable to deploy Snoomp binaries: No local build found and remote package download failed."
        }
    }
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
$oldEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$testDbOutput = & "$InstallDir\snoomp.exe" --test-db 2>&1
$testDbExit = $LASTEXITCODE
$ErrorActionPreference = $oldEap

if ($testDbExit -eq 0) {
    Write-Host $testDbOutput -ForegroundColor Gray
    Write-Host "[OK] Database connection verified and schema initialized." -ForegroundColor Green
} else {
    Write-Host $testDbOutput -ForegroundColor Red
    Write-Host "[WARN] Database connection failed (Exit code: $testDbExit)." -ForegroundColor Yellow
    if ($DatabaseUrl -like "postgresql*") {
        Write-Host "       The PostgreSQL user, password, or database entered is incorrect or uninitialized." -ForegroundColor Yellow
        $fallbackChoice = "1"
        if (-not $Unattended) {
            Write-Host "`nHow would you like to resolve this database issue?" -ForegroundColor Cyan
            Write-Host "  [1] Switch to Embedded SQLite (Guaranteed to start immediately with zero dependencies)" -ForegroundColor White
            Write-Host "  [2] Leave configuration as-is (I will fix PostgreSQL credentials manually in snoomp.env)" -ForegroundColor White
            $fallbackChoice = Read-Host "  Selection [Default: 1]"
        }
        if ([string]::IsNullOrWhiteSpace($fallbackChoice) -or $fallbackChoice -eq "1") {
            $DatabaseUrl = "sqlite:///snoomp.db"
            $envContent = Get-Content "$InstallDir\snoomp.env"
            $newEnvContent = $envContent | ForEach-Object {
                if ($_ -match "^DATABASE_URL=") { "DATABASE_URL=sqlite:///snoomp.db" } else { $_ }
            }
            Set-Content -Path "$InstallDir\snoomp.env" -Value ($newEnvContent -join "`r`n") -Encoding utf8
            Write-Host "  Switching configuration to Embedded SQLite..." -ForegroundColor Yellow
            $oldEap = $ErrorActionPreference
            $ErrorActionPreference = "SilentlyContinue"
            $testDbOutput = & "$InstallDir\snoomp.exe" --test-db 2>&1
            $testDbExit = $LASTEXITCODE
            $ErrorActionPreference = $oldEap
            if ($testDbExit -eq 0) {
                Write-Host "[OK] Embedded SQLite schema initialized successfully!" -ForegroundColor Green
            }
        }
    }
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

if (-not $Healthy) {
    Write-Host "`n[ALERT] Snoomp server has not responded on http://127.0.0.1:$Port within ${MaxWaitSec}s." -ForegroundColor Red
    $logFile = "$InstallDir\logs\snoomp.log"
    if (Test-Path $logFile) {
        Write-Host "--- Recent Log Output ($logFile) ---" -ForegroundColor Yellow
        Get-Content -Path $logFile -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Red
    }
}

# --- 14. Installation Summary Presentation ---
$LocalIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1).IPAddress

Write-Host "`n=================================================================" -ForegroundColor Green
if ($Healthy) {
    Write-Host "   SNOOMP ENTERPRISE INSTALLED & RUNNING SUCCESSFULLY!           " -ForegroundColor Green
} else {
    Write-Host "   SNOOMP ENTERPRISE INSTALLED WITH WARNINGS (SERVICE STOPPED)   " -ForegroundColor Yellow
}
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
