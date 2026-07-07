@echo off
:: Launch Focus (admin required for DNS blocking)
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

set "APP=%~dp0Focus.exe"
if not exist "%APP%" set "APP=%LocalAppData%\Programs\Focus\Focus.exe"
if not exist "%APP%" set "APP=%ProgramFiles%\Focus\Focus.exe"

if not exist "%APP%" (
  echo Could not find Focus.exe. Reinstall from Focus Setup 0.1.0.exe
  pause
  exit /b 1
)

if /I "%~1"=="--hidden" (
  start "" "%APP%" --hidden
) else (
  start "" "%APP%" --show
)
