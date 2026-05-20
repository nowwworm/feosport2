@echo off
chcp 65001 > nul
title FeoSport2 — Логи

cd /d "%~dp0..\..\..\"

echo Логи всех сервисов (Ctrl+C для выхода):
echo.
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f --tail=100
