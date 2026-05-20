@echo off
chcp 65001 > nul
title FeoSport2 — Остановка

cd /d "%~dp0..\..\..\"

echo.
echo [FeoSport2] Остановка контейнеров...
docker compose -f deploy/docker-compose.prod.yml down
echo.
echo Контейнеры остановлены. Данные БД сохранены.
echo.
pause
