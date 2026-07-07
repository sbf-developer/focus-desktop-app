@echo off
title Focus
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies - this requires ~200MB free disk space...
  call npm install
)
call npm run build
start "" "node_modules\electron\dist\electron.exe" .
echo Focus is running. Check your system tray.
