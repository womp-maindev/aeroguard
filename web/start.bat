@echo off
rem double-click me. opens the dashboard, nothing to install
cd /d "%~dp0"
if not exist "%~dp0index.html" (
  echo Unzip first: right-click the ZIP, "Extract All", then open the web folder and run start.bat there.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 pause
