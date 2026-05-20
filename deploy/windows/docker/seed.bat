@echo off
chcp 65001 > nul
title FeoSport2 — Тестовые данные

cd /d "%~dp0..\..\..\"

echo.
echo [FeoSport2] Загрузка тестовых данных (2 команды, 2 соревнования)...
echo.

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec backend node scripts/seed.js

echo.
pause
