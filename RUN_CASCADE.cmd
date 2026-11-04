@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22, then try again.
  pause
  exit /b 1
)
echo CASCADE — offline read-only dashboard
node dist\src\dashboard\server.js
if errorlevel 1 pause
