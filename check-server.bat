@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>nul || (echo Node.js not found.& pause& exit /b 1)
echo Node.js version:
node -v
echo.
echo Checking server syntax...
node --check server.js
if errorlevel 1 (echo Syntax check failed.& pause& exit /b 1)
echo Syntax OK.
echo.
echo Starting server. Keep this window open.
node server.js
pause
