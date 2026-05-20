@echo off
chcp 65001 > nul
title FeoSport2 — Тестовые данные

set ROOT=%~dp0..\..\..

echo.
echo [FeoSport2] Загрузка тестовых данных...
echo.

cd /d "%ROOT%\backend"
node scripts/seed.js

echo.
pause
