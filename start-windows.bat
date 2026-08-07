@echo off
echo =========================================
echo Launching Snoomp Enterprise (Windows)
echo =========================================
docker compose up -d
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Snoomp is running!
    echo   Frontend Dashboard: http://localhost:5173
    echo   Backend API:        http://localhost:8008/api/version
    echo =========================================
) else (
    echo [ERROR] Container launch failed. Please ensure Docker Desktop for Windows is running.
)
