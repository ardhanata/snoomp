# Snoomp Windows Launcher (PowerShell)
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "[INFO] Launching Snoomp Enterprise (Windows)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Docker Desktop is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    exit 1
}

Write-Host "[SETUP] Starting Snoomp containers via Docker Compose..." -ForegroundColor Green
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] Snoomp is up and running!" -ForegroundColor Green
    Write-Host "  Frontend Dashboard: http://localhost:5173" -ForegroundColor Yellow
    Write-Host "  Backend API:        http://localhost:8008/api/version" -ForegroundColor Yellow
    Write-Host "=========================================" -ForegroundColor Cyan
} else {
    Write-Host "[ERROR] Container launch failed." -ForegroundColor Red
}
