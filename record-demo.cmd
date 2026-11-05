@echo off
setlocal
cd /d "%~dp0"
set "MODE="
if /I "%~1"=="--check-only" set "MODE=-CheckOnly"
if /I "%~1"=="--capture-only" set "MODE=-CaptureOnly"
if /I "%~1"=="--inspect-acp" set "MODE=-InspectAcp"
if not "%~1"=="" if not defined MODE (
  echo Unrecognized argument: %~1
  echo Valid options: --check-only, --inspect-acp or --capture-only
  exit /b 2
)
echo Launching CASCADE Auto Demo Studio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\demo-studio\run.ps1" %MODE%
if errorlevel 1 (
  echo.
  echo The recorder stopped. Review the error above; no fake evidence was generated.
  echo.
  pause
  exit /b 1
)
echo.
pause
