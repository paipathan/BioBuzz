@echo off
cd /d "%~dp0"
start "" http://localhost:4141
node server.js
