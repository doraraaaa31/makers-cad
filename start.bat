@echo off
cd /d "%~dp0app"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Maker's CAD... (close this window to stop)
call npm run dev -- --open --port 5173
pause
