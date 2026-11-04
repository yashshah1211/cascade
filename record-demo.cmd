@echo off
setlocal
cd /d "%~dp0"
echo Launching CASCADE Auto Demo Studio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\demo-studio\run.ps1" %*
if errorlevel 1 (
  echo.
  echo The recorder stopped. Review the error above; no fake evidence was generated.
)
echo.
pause
