@echo off
chcp 65001 > nul
title FeoSport2 — Запуск

cd /d "%~dp0..\..\..\"

echo.
echo [FeoSport2] Запуск через Docker Compose...
echo.

docker info > nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Docker Desktop не запущен!
    echo Запусти Docker Desktop и подожди пока он стартует, затем повтори.
    pause
    exit /b 1
)

if not exist "deploy\.env" (
    echo [ОШИБКА] Файл deploy\.env не найден!
    echo Запусти сначала: deploy\windows\docker\02-setup-env.ps1
    pause
    exit /b 1
)

echo Сборка и запуск контейнеров...
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up --build -d

if errorlevel 1 (
    echo.
    echo [ОШИБКА] Не удалось запустить. Проверь логи:
    echo   deploy\windows\docker\logs.bat
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Приложение запущено!
echo   Открой браузер: http://localhost
echo   Логин: admin@feosport.local
echo   Пароль: admin123
echo ============================================
echo.
echo Для загрузки тестовых данных:
echo   deploy\windows\docker\seed.bat
echo.
pause
