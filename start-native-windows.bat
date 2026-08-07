@echo off
echo =================================================
echo Launching Snoomp Enterprise (Native Windows - NO DOCKER)
echo =================================================

cd /d "%~dp0backend"
if not exist "venv" (
    echo [SETUP] Creating Python virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat
pip install -q -r requirements.txt

set DATABASE_URL=sqlite:///%~dp0backend\snoomp.db
set JWT_SECRET=snoomp_native_windows_standalone_key_2026

echo [BACKEND] Starting Backend API on http://localhost:8000...
start /b python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo [SETUP] Installing npm dependencies...
    call npm install
)

echo.
echo =================================================
echo [SUCCESS] Snoomp is running natively on Windows!
echo   Dashboard UI: http://localhost:5173
echo   Backend API:   http://localhost:8000/api/version
echo =================================================
call npm run dev
