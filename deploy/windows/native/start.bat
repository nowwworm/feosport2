@echo off
chcp 65001 > nul
title FeoSport2 — Нативный запуск

set ROOT=%~dp0..\..\..

echo.
echo [FeoSport2] Проверка Node.js...
node --version > nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден! Запусти 01-install-deps.ps1
    pause & exit /b 1
)

echo [FeoSport2] Проверка backend\.env...
if not exist "%ROOT%\backend\.env" (
    echo [ОШИБКА] backend\.env не найден! Запусти 02-setup-db.ps1
    pause & exit /b 1
)

echo.
echo Запуск backend (порт 8090)...
start "FeoSport2 Backend" cmd /k "cd /d %ROOT%\backend && npm start"

echo Ожидание старта backend...
timeout /t 3 /nobreak > nul

echo Запуск frontend (порт 8080)...
start "FeoSport2 Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev -- --host 0.0.0.0"

echo.
echo ============================================
echo   Оба сервиса запущены в отдельных окнах.
echo   Открой браузер: http://localhost:8080
echo   API:            http://localhost:8090
echo.
echo   Для загрузки тестовых данных:
echo     deploy\windows\native\seed.bat
echo ============================================
echo.
pause
