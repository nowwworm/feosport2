@echo off
chcp 65001 > nul
title FeoSport2 — остановка

:: ── Проверить, запущен ли процесс ─────────────────────────────────────────────
tasklist /FI "IMAGENAME eq feosport2-server.exe" 2>nul | find /I "feosport2-server.exe" >nul
if errorlevel 1 (
    echo.
    echo  [info] FeoSport2 уже остановлен (feosport2-server.exe не активен).
    echo.
    echo  Если по адресу http://localhost:8090 что-то отвечает —
    echo  возможно, занят другим приложением. Проверить можно командой:
    echo      netstat -ano ^| findstr :8090
    echo.
    pause
    exit /b 0
)

:: ── Остановить ───────────────────────────────────────────────────────────────
echo.
echo  Останавливаю FeoSport2...
taskkill /F /IM feosport2-server.exe > nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось завершить процесс feosport2-server.exe.
    echo  Возможно, нужны права администратора.
    echo  Попробуйте: ПКМ по ярлыку "FeoSport2 — остановка" -^> "Запуск от имени администратора".
    echo.
    pause
    exit /b 1
)

:: Дать ОС секунду на освобождение порта.
timeout /t 1 /nobreak > nul

:: ── Сообщение об успехе ──────────────────────────────────────────────────────
echo.
echo  ✓ FeoSport2 остановлен.
echo  ✓ Порт 8090 освобождён.
echo.
echo  Чтобы снова запустить — ярлык "FeoSport2 — запуск".
echo  Окно можно закрыть.
echo.
pause
