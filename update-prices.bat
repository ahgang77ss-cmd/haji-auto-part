@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================
echo   Haji Auto Parts - Price Update
echo   This checks a few auto-parts store websites
echo   and updates price-data.json if it finds matches.
echo   It can take a few minutes. Do not close this window.
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not in PATH.
  pause
  exit /b 1
)

node price-updater-v13.js
set EXITCODE=%ERRORLEVEL%
echo.
echo Finished with code %EXITCODE%.
echo If it says "0 matched", open price-data.json by hand instead - see the chat for how.
pause
exit /b %EXITCODE%
