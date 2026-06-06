@echo off
setlocal

echo.
echo =^> Clearing ports...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
    echo   [!] Killing PID %%a on port 8000
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    echo   [!] Killing PID %%a on port 3000
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo =^> Starting backend...
cd /d "%~dp0backend"
if not exist ".venv" (
    echo   [+] Creating Python venv...
    python -m venv .venv
    .venv\Scripts\pip install --upgrade pip
    .venv\Scripts\pip install -r requirements.txt
)
start "Backend" .venv\Scripts\uvicorn main:app --reload --port 8000

echo.
echo =^> Starting frontend...
cd /d "%~dp0frontend"
start "Frontend" cmd /c npm run dev

echo.
echo   Backend  -^> http://localhost:8000
echo   Frontend -^> http://localhost:3000
echo.
echo   Close the Backend and Frontend windows to stop.
echo.
pause
