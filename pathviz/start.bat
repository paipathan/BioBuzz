@echo off
cd /d "%~dp0"
title Path Editor
rem Already running? Just open the page.
netstat -ano | findstr /R /C:":4141 .*LISTENING" >nul && (start "" http://localhost:4141 & exit /b)
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:4141"
node server.js
pause
