# Snoomp Standalone Native Windows Launcher (NO DOCKER REQUIRED)
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "[INFO] Launching Snoomp Enterprise (Native Windows)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python 3 is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Python 3.10+: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# 2. Check Node
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js/npm is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 3. Setup Python virtual environment
Write-Host "[SETUP] Checking Python dependencies..." -ForegroundColor Green
Set-Location "$PSScriptRoot\backend"

if (-not (Test-Path "venv")) {
    Write-Host "[SETUP] Creating Python virtual environment (venv)..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate venv
$venvPython = "$PSScriptRoot\backend\venv\Scripts\python.exe"
$venvPip = "$PSScriptRoot\backend\venv\Scripts\pip.exe"

& $venvPip install -q -r requirements.txt

# 4. Set Environment Variables for Standalone Native Execution
$env:DATABASE_URL = "sqlite:///$PSScriptRoot\backend\snoomp.db"
# F1: Generate a per-session JWT secret if not already set
if (-not $env:JWT_SECRET) {
    $env:JWT_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    Write-Host "[SECURITY] JWT_SECRET auto-generated for this session." -ForegroundColor Yellow
    Write-Host "[SECURITY] Set JWT_SECRET env var for persistent sessions." -ForegroundColor Yellow
}
$env:ACCESS_TOKEN_EXPIRE_MINUTES = "1440"
$env:ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:8000"
if (-not $env:REDIS_URL) {
    $env:USE_CELERY = "false"
    $env:REDIS_URL = ""
}

Write-Host "[DATABASE] SQLite ($PSScriptRoot\backend\snoomp.db)" -ForegroundColor Green

# 5. Start Backend API in background
Write-Host "[BACKEND] Starting Snoomp Backend API (Port 8000)..." -ForegroundColor Green
$backendProcess = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000" -PassThru -WindowStyle Hidden

# 6. Start Frontend Dev Server
Write-Host "[FRONTEND] Starting Snoomp Frontend Web Server (Port 5173)..." -ForegroundColor Green
Set-Location "$PSScriptRoot\frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "[SETUP] Installing frontend npm dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Snoomp is running natively on Windows!" -ForegroundColor Green
Write-Host "  Dashboard UI: http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Backend API:   http://localhost:8000/api/version" -ForegroundColor Yellow
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C or close window to stop..." -ForegroundColor Gray

npm run dev
