@echo off
chcp 65001 > nul
title FeoSport2 — Остановка

echo.
echo [FeoSport2] Остановка процессов Node.js...
taskkill /F /FI "WINDOWTITLE eq FeoSport2 Backend*"  > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq FeoSport2 Frontend*" > nul 2>&1
echo Остановлено.
echo.
pause
