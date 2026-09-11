@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================
echo   Haji Auto Parts - Standalone Server
echo   No npm install / No Express required
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not in PATH.
  echo Install Node.js, reopen CMD, and run this file again.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -p "process.versions.node"') do set NODEVER=%%V
echo Node.js: %NODEVER%
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22 || (a===22 && b<5)) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22.5+ is required.
  pause
  exit /b 1
)

echo.
echo Starting server...
rem To set custom admin passwords (recommended), remove "rem " from the start
rem of the next two lines and put your own passwords in:
rem set ADMIN1_PASSWORD=your-new-password-for-09191816422
rem set ADMIN2_PASSWORD=your-new-password-for-09105694177
node server.js
set EXITCODE=%ERRORLEVEL%
echo.
echo Server stopped with code %EXITCODE%.
pause
exit /b %EXITCODE%
