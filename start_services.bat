@echo off
title SolarWatch AI - Backend & Tunnel Launcher
color 0A
echo ========================================================
echo   SolarWatch AI — Automated Backend & Tunnel Starter
echo ========================================================
echo.

:: 1. Start Python Backend on Port 8000
echo [1/3] Starting FastAPI backend on http://localhost:8000 ...
start "SolarWatch Backend" cmd /k "python scripts/server.py"
timeout /t 3 /nobreak >nul

:: 2. Start Localtunnel to expose port 8000
echo [2/3] Starting Public Tunnel for Wokwi ESP32 ...
start "SolarWatch Public Tunnel" cmd /k "npx -y localtunnel --port 8000 --subdomain solarwatch-ai"
timeout /t 5 /nobreak >nul

:: 3. Start Frontend (if not already running)
echo [3/3] Checking Frontend Dashboard ...
netstat -ano | findstr ":3000" >nul
if %errorlevel% neq 0 (
    echo Starting Next.js frontend on http://localhost:3000 ...
    start "SolarWatch Dashboard" cmd /k "cd frontend && npm run dev"
) else (
    echo Frontend already running on http://localhost:3000
)

echo.
echo ========================================================
echo   All services launched!
echo   1. Check the 'SolarWatch Public Tunnel' window for your URL.
echo   2. If using 'solarwatch-ai', your URL is:
echo      http://solarwatch-ai.loca.lt/api/esp32/data
echo   3. Paste that into sketch.ino in Wokwi and press Play!
echo ========================================================
pause
