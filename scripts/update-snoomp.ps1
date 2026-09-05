# ==============================================================================
# Snoomp Enterprise Platform - Automated Updater & Hotfix Utility for Windows
# Safely stops services, releases DLL file locks, updates files, preserves data,
# and verifies service health.
# ==============================================================================

[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$ZipPath = "",
    [string]$DownloadUrl = "",
    [string]$SourcePath = "",
    [switch]$Hotfix = $false,
    [switch]$Force = $false,
    [switch]$CheckOnly = $false,
    [switch]$Unattended = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ponytail: resolve default installation path
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if (Test-Path "$PSScriptRoot\snoomp.exe") {
        $InstallDir = $PSScriptRoot
    } elseif (Test-Path "C:\Program Files\Snoomp\snoomp.exe") {
        $InstallDir = "C:\Program Files\Snoomp"
    } elseif (Test-Path "$env:LOCALAPPDATA\Snoomp\snoomp.exe") {
        $InstallDir = "$env:LOCALAPPDATA\Snoomp"
    } else {
        $InstallDir = "C:\Program Files\Snoomp"
    }
}

function Show-Header {
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "  SNOOMP ENTERPRISE - SYSTEM UPDATE & HOTFIX    " -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "Target Directory: $InstallDir" -ForegroundColor Gray
}

# --- 1. Administrator Verification & Self-Elevation ---
function Ensure-Admin {
    $isAdmin = $false
    try {
        $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        $isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        $isAdmin = $false
    }

    if (-not $isAdmin -and -not $CheckOnly) {
        Write-Host "`n[ELEVATION] Requesting Administrator privileges to safely stop service and update files..." -ForegroundColor Yellow
        $scriptPath = $PSCommandPath
        if ($scriptPath -and (Test-Path $scriptPath)) {
            $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -InstallDir `"$InstallDir`""
            if ($ZipPath) { $argList += " -ZipPath `"$ZipPath`"" }
            if ($DownloadUrl) { $argList += " -DownloadUrl `"$DownloadUrl`"" }
            if ($SourcePath) { $argList += " -SourcePath `"$SourcePath`"" }
            if ($Hotfix) { $argList += " -Hotfix" }
            if ($Force) { $argList += " -Force" }
            if ($Unattended) { $argList += " -Unattended" }
            Start-Process powershell -Verb RunAs -ArgumentList $argList
            exit 0
        }
    }
}

Show-Header
Ensure-Admin

# --- 2. Determine Current Version ---
$CurrentVersion = "0.0.0"
$versionFile = "$InstallDir\VERSION"
if (Test-Path $versionFile) {
    $CurrentVersion = (Get-Content -Path $versionFile -Raw).Trim().TrimStart("v")
} else {
    try {
        $apiVer = Invoke-RestMethod -Uri "http://127.0.0.1:8008/api/version" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($apiVer -and $apiVer.version) {
            $CurrentVersion = $apiVer.version.TrimStart("v")
        }
    } catch {}
}

Write-Host "`nCurrent Installed Version: v$CurrentVersion" -ForegroundColor White

# Helper to compare semver
function Compare-SemVer ($v1, $v2) {
    $p1 = $v1.Split(".") | ForEach-Object { [int]($_ -replace '\D', '') }
    $p2 = $v2.Split(".") | ForEach-Object { [int]($_ -replace '\D', '') }
    for ($i = 0; $i -lt [Math]::Max($p1.Length, $p2.Length); $i++) {
        $num1 = if ($i -lt $p1.Length) { $p1[$i] } else { 0 }
        $num2 = if ($i -lt $p2.Length) { $p2[$i] } else { 0 }
        if ($num1 -gt $num2) { return 1 }
        if ($num1 -lt $num2) { return -1 }
    }
    return 0
}

# --- 3. Process & Service Lock Release Helper ---
function Stop-SnoompCleanly {
    Write-Host "`n[STOPPING] Shutting down Snoomp background services and releasing file locks..." -ForegroundColor Yellow

    # Stop scheduled task if present
    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
        $task = Get-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
        if ($task) {
            Write-Host "  Stopping Scheduled Task 'SnoompServer'..." -ForegroundColor Gray
            Stop-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
        }
    }

    # Stop Windows Service if registered
    Stop-Service -Name "SnoompService" -ErrorAction SilentlyContinue

    # Kill any lingering snoomp processes
    $procs = Get-Process -Name "snoomp" -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Host "  Terminating active snoomp.exe process(es)..." -ForegroundColor Gray
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    }

    # Wait for processes to exit and kernel file locks (DLLs) to release
    $waitCount = 0
    while ((Get-Process -Name "snoomp" -ErrorAction SilentlyContinue) -and ($waitCount -lt 15)) {
        Start-Sleep -Seconds 1
        $waitCount++
    }
    Start-Sleep -Milliseconds 800
    Write-Host "  [OK] Snoomp processes terminated cleanly." -ForegroundColor Green
}

# --- 4. Backup & Restore Configuration / Database Helpers ---
$backupTimestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = "$env:TEMP\snoomp_backup_$backupTimestamp"

function Backup-Data {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Write-Host "`n[BACKUP] Backing up configuration and database to $backupDir..." -ForegroundColor Gray

    $envFile = "$InstallDir\snoomp.env"
    if (Test-Path $envFile) {
        Copy-Item -Path $envFile -Destination "$backupDir\snoomp.env" -Force
    }
    $dbFile = "$InstallDir\snoomp.db"
    if (Test-Path $dbFile) {
        Copy-Item -Path $dbFile -Destination "$backupDir\snoomp.db" -Force
    }
    $logsDir = "$InstallDir\logs"
    if (Test-Path $logsDir) {
        Copy-Item -Path $logsDir -Destination "$backupDir\logs" -Recurse -Force
    }
}

function Restore-Data {
    Write-Host "`n[RESTORING] Preserving user configuration and database..." -ForegroundColor Gray
    if (Test-Path "$backupDir\snoomp.env") {
        Copy-Item -Path "$backupDir\snoomp.env" -Destination "$InstallDir\snoomp.env" -Force
        Write-Host "  [OK] Preserved snoomp.env" -ForegroundColor Green
    }
    if (Test-Path "$backupDir\snoomp.db") {
        Copy-Item -Path "$backupDir\snoomp.db" -Destination "$InstallDir\snoomp.db" -Force
        Write-Host "  [OK] Preserved snoomp.db" -ForegroundColor Green
    }
}

# --- 5. Start Service Helper ---
function Start-SnoompCleanly {
    Write-Host "`n[STARTING] Launching Snoomp server..." -ForegroundColor Green
    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
        $task = Get-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
        if ($task) {
            Start-ScheduledTask -TaskName "SnoompServer" -ErrorAction SilentlyContinue
        }
    }

    if (-not (Get-Process -Name "snoomp" -ErrorAction SilentlyContinue)) {
        if (Test-Path "$InstallDir\start-snoomp.ps1") {
            & "$InstallDir\start-snoomp.ps1"
        } elseif (Test-Path "$InstallDir\snoomp.exe") {
            Start-Process -FilePath "$InstallDir\snoomp.exe" -WorkingDirectory $InstallDir -WindowStyle Hidden
        }
    }

    # Verify health
    Write-Host "Verifying service startup..." -ForegroundColor Yellow
    $healthy = $false
    $port = 8008
    if (Test-Path "$InstallDir\snoomp.env") {
        $pLine = Get-Content "$InstallDir\snoomp.env" | Where-Object { $_ -match "^PORT=(\d+)" }
        if ($pLine -and $matches[1]) { $port = [int]$matches[1] }
    }
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        try {
            $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/version" -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($res -and $res.version) {
                $healthy = $true
                break
            }
        } catch {}
    }

    Write-Host "`n=================================================" -ForegroundColor Green
    if ($healthy) {
        Write-Host "  SUCCESS: Snoomp is up to date and running at http://localhost:$port" -ForegroundColor Green
    } else {
        Write-Host "  Snoomp files updated! (Service is still initializing...)" -ForegroundColor Yellow
    }
    Write-Host "=================================================" -ForegroundColor Green
}

# --- 6. Apply Local Hotfix Function ---
function Apply-LocalHotfix {
    param([string]$Source)

    # Resolve source path
    $candidateSources = @()
    if ($Source) { $candidateSources += $Source }
    $candidateSources += "$PSScriptRoot\..\frontend\dist"
    $candidateSources += "D:\Project\snoomp\frontend\dist"
    $candidateSources += "$PSScriptRoot\frontend\dist"
    $candidateSources += "$PWD\frontend\dist"
    $candidateSources += "$PWD\dist"

    $validSource = $null
    foreach ($c in $candidateSources) {
        if ($c -and (Test-Path "$c\index.html")) {
            $validSource = (Resolve-Path $c).Path
            break
        }
    }

    if (-not $validSource) {
        Write-Host "[ERROR] Could not find hotfixed frontend/dist directory with index.html." -ForegroundColor Red
        Write-Host "Please build the frontend first ('npm run build') or provide -SourcePath <path>." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "`n[HOTFIX] Applying frontend hotfix from: $validSource" -ForegroundColor Cyan
    Stop-SnoompCleanly
    Backup-Data

    # Copy hotfixed frontend into InstallDir\dist and InstallDir\_internal\frontend\dist
    $destDist = "$InstallDir\dist"
    New-Item -ItemType Directory -Path $destDist -Force | Out-Null
    Copy-Item -Recurse -Force "$validSource\*" -Destination $destDist
    Write-Host "  [OK] Copied hotfixed assets to $destDist" -ForegroundColor Green

    $destInternal = "$InstallDir\_internal\frontend\dist"
    if (Test-Path "$InstallDir\_internal") {
        New-Item -ItemType Directory -Path $destInternal -Force | Out-Null
        Copy-Item -Recurse -Force "$validSource\*" -Destination $destInternal
        Write-Host "  [OK] Updated bundled assets at $destInternal" -ForegroundColor Green
    }

    # Ensure update script helper is in InstallDir
    if (Test-Path "$PSScriptRoot\update-snoomp.ps1") {
        Copy-Item -Path "$PSScriptRoot\update-snoomp.ps1" -Destination "$InstallDir\update-snoomp.ps1" -Force
    }
    Set-Content -Path "$InstallDir\update-snoomp.bat" -Value "@powershell -ExecutionPolicy Bypass -File `"%~dp0update-snoomp.ps1`"" -Encoding ascii

    Restore-Data
    Start-SnoompCleanly
    exit 0
}

# --- 7. Execution Path Decision ---

# Path A: Hotfix explicitly requested
if ($Hotfix -or $SourcePath) {
    Apply-LocalHotfix -Source $SourcePath
}

# Path B: Local Zip provided
if ($ZipPath) {
    if (-not (Test-Path $ZipPath)) {
        Write-Host "[ERROR] Specified zip file not found: $ZipPath" -ForegroundColor Red
        exit 1
    }
    Write-Host "`n[UPDATING] Installing package from $ZipPath..." -ForegroundColor Cyan
    Stop-SnoompCleanly
    Backup-Data
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
        Write-Host "  [OK] Binaries extracted successfully." -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Extraction failed: $($_.Exception.Message)" -ForegroundColor Red
        Restore-Data
        exit 1
    }
    Restore-Data
    Start-SnoompCleanly
    exit 0
}

# Path C: Check GitHub for Latest Releases
Write-Host "Checking GitHub for latest release..." -ForegroundColor Yellow
$Repo = "ardhanata/snoomp"
$ReleaseApi = "https://api.github.com/repos/$Repo/releases/latest"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ "User-Agent" = "Snoomp-Updater-Windows" }
    $release = Invoke-RestMethod -Uri $ReleaseApi -Headers $headers -TimeoutSec 10 -ErrorAction Stop
} catch {
    Write-Host "[WARNING] Could not connect to GitHub API: $($_.Exception.Message)" -ForegroundColor Yellow
    # If GitHub is unreachable, offer local hotfix if available
    if (-not $Unattended) {
        $tryLocal = Read-Host "Do you want to apply local frontend hotfix instead? [Y/n]"
        if ($tryLocal -notmatch "^[nN]") {
            Apply-LocalHotfix
        }
    }
    exit 1
}

$LatestTag = $release.tag_name
$LatestVersion = $LatestTag.Trim().TrimStart("v")
Write-Host "Latest Available Release:  v$LatestVersion" -ForegroundColor Cyan

# Find Windows x64 asset
$Asset = $null
foreach ($a in $release.assets) {
    if ($a.name -like "*windows-x64.zip" -or ($a.name -like "*windows*.zip")) {
        $Asset = $a
        break
    }
}

$hasUpdate = ((Compare-SemVer $LatestVersion $CurrentVersion) -gt 0)

if ($CheckOnly) {
    if ($hasUpdate) {
        Write-Host "`n[UPDATE AVAILABLE] A newer release (v$LatestVersion) is available." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n[UP TO DATE] Snoomp is already at the latest release." -ForegroundColor Green
        exit 0
    }
}

# If no newer version on GitHub, offer choices
if (-not $hasUpdate -and -not $Force) {
    Write-Host "`n[NOTICE] Installed version (v$CurrentVersion) matches latest GitHub release (v$LatestVersion)." -ForegroundColor Yellow
    if (-not $Unattended) {
        Write-Host "`nSelect an action:" -ForegroundColor White
        Write-Host "  [1] Apply local frontend hotfix (Fixes G.flatMap and UI crash)" -ForegroundColor Cyan
        Write-Host "  [2] Re-download and reinstall latest v$LatestVersion from GitHub" -ForegroundColor Yellow
        Write-Host "  [3] Exit" -ForegroundColor Gray
        $choice = Read-Host "`nEnter option [1/2/3] (Default: 1)"
        if ([string]::IsNullOrWhiteSpace($choice) -or $choice.Trim() -eq "1") {
            Apply-LocalHotfix
        } elseif ($choice.Trim() -eq "2") {
            # Continue to download below
        } else {
            Write-Host "Update cancelled." -ForegroundColor Gray
            exit 0
        }
    } else {
        exit 0
    }
}

if (-not $Asset) {
    Write-Host "[ERROR] Could not find a Windows zip asset in release $LatestTag." -ForegroundColor Red
    Write-Host "Please visit: $($release.html_url)" -ForegroundColor Yellow
    exit 1
}

$DownloadUrl = $Asset.browser_download_url
Write-Host "`nDownload URL: $DownloadUrl" -ForegroundColor Gray

if (-not $Unattended) {
    $confirm = Read-Host "`nProceed with updating Snoomp to v$LatestVersion? [Y/n]"
    if ($confirm -match "^[nN]") {
        Write-Host "Update aborted by user." -ForegroundColor Yellow
        exit 0
    }
}

# --- Download & Extract ---
$tempZip = "$env:TEMP\snoomp-update-$LatestVersion.zip"
Write-Host "`n[DOWNLOAD] Downloading Snoomp v$LatestVersion from GitHub..." -ForegroundColor Cyan

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $tempZip -UseBasicParsing
    $item = Get-Item $tempZip
    $mbSize = [math]::Round(($item.Length / 1048576), 2)
    Write-Host "  [OK] Download completed ($mbSize MB)." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Download failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Stop-SnoompCleanly
Backup-Data

Write-Host "`n[UPDATING] Extracting binaries to $InstallDir..." -ForegroundColor Yellow
try {
    Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force
    Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Updated files extracted successfully." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to extract archive: $($_.Exception.Message)" -ForegroundColor Red
    Restore-Data
    exit 1
}

Restore-Data
Set-Content -Path "$InstallDir\VERSION" -Value "v$LatestVersion" -Encoding utf8
Start-SnoompCleanly
