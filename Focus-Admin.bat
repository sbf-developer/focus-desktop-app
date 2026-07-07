@echo off
:: Launch Focus with administrator rights (required for DNS blocking)
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "APP=%~dp0Focus.exe"
if not exist "%APP%" set "APP=%LocalAppData%\Programs\focus\Focus.exe"
if not exist "%APP%" set "APP=%ProgramFiles%\Focus\Focus.exe"

if exist "%APP%" (
  start "" "%APP%"
) else (
  echo Could not find Focus.exe. Reinstall from Focus Setup 0.1.0.exe
  pause
)
