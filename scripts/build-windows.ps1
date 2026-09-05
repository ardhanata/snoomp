# Build Snoomp Standalone Windows Executable Package
[CmdletBinding()]
param(
    [switch]$SkipFrontendBuild = $false
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path "$PSScriptRoot\.."

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  SNOOMP WINDOWS STANDALONE EXECUTABLE BUILDER  " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Build Frontend
if (-not $SkipFrontendBuild) {
    Write-Host "`n[1/4] Building React Frontend SPA..." -ForegroundColor Green
    Push-Location "$RepoRoot\frontend"
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
            npm install
        }
        npm run build
        if (-not (Test-Path "dist\index.html")) {
            throw "Frontend build failed: dist\index.html not found!"
        }
        Write-Host "Frontend build completed successfully." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[1/4] Skipping frontend build (using existing frontend\dist)..." -ForegroundColor Yellow
}

# 2. Verify Python & PyInstaller
Write-Host "`n[2/4] Verifying Python build environment..." -ForegroundColor Green
$PyExe = "$RepoRoot\backend\venv\Scripts\python.exe"
$PyInstaller = "$RepoRoot\backend\venv\Scripts\pyinstaller.exe"

if (-not (Test-Path $PyInstaller)) {
    Write-Host "PyInstaller not found in venv. Installing..." -ForegroundColor Yellow
    & $RepoRoot\backend\venv\Scripts\pip.exe install pyinstaller
}

# 3. Clean and Run PyInstaller
Write-Host "`n[3/4] Compiling standalone Windows executable (snoomp.exe)..." -ForegroundColor Green
Push-Location "$RepoRoot\backend"
try {
    if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

    & $PyInstaller --noconfirm --clean snoomp.spec

    $OutputDist = "$RepoRoot\backend\dist\snoomp-windows-x64"
    if (-not (Test-Path "$OutputDist\snoomp.exe")) {
        throw "Build failed: $OutputDist\snoomp.exe was not created!"
    }
}
finally {
    Pop-Location
}

# 4. Package distribution archive
Write-Host "`n[4/4] Packaging distribution archive..." -ForegroundColor Green
$DistRoot = "$RepoRoot\dist"
if (-not (Test-Path $DistRoot)) {
    New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
}

$FinalPackageDir = "$DistRoot\snoomp-windows-x64"
if (Test-Path $FinalPackageDir) { Remove-Item -Recurse -Force $FinalPackageDir }
Copy-Item -Recurse -Path "$RepoRoot\backend\dist\snoomp-windows-x64" -Destination $FinalPackageDir

# Copy template env file
$TemplateEnv = @"
# Snoomp Production Environment Configuration
PORT=8008
HOST=0.0.0.0
ALLOWED_ORIGINS=*

# Database: Default SQLite (or replace with postgresql://user:pass@host:5432/snoomp_db)
# DATABASE_URL=sqlite:///snoomp.db

# Redis / Celery (Optional - for distributed workers)
# REDIS_URL=redis://localhost:6379/0

# Discord Notifications (Optional)
# DISCORD_ALERTS_ENABLED=1
# DISCORD_WEBHOOK_CRITICAL=https://discord.com/api/webhooks/...
"@
Set-Content -Path "$FinalPackageDir\snoomp.env.example" -Value $TemplateEnv -Encoding utf8

# Copy install.ps1 into the package
Copy-Item -Path "$PSScriptRoot\install.ps1" -Destination "$FinalPackageDir\install.ps1"

# Create start and stop helper scripts
Set-Content -Path "$FinalPackageDir\start-snoomp.bat" -Value "@echo off`r`nstart snoomp.exe" -Encoding ascii
Set-Content -Path "$FinalPackageDir\stop-snoomp.bat" -Value "@echo off`r`ntaskkill /F /IM snoomp.exe" -Encoding ascii

# Create Zip Archive
$ZipPath = "$DistRoot\snoomp-windows-x64.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Write-Host "Compressing to $ZipPath..." -ForegroundColor Yellow
Compress-Archive -Path "$FinalPackageDir\*" -DestinationPath $ZipPath -Force

$ZipSizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)

Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "  BUILD COMPLETE SUCCESSFULLY!                  " -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Output Directory: $FinalPackageDir" -ForegroundColor Yellow
Write-Host "Zip Archive:      $ZipPath ($ZipSizeMb MB)" -ForegroundColor Yellow
Write-Host "Executable:       $FinalPackageDir\snoomp.exe" -ForegroundColor Yellow
Write-Host "=================================================" -ForegroundColor Cyan
