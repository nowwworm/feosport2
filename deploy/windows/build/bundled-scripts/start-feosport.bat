@echo off
chcp 65001 > nul
title FeoSport2

:: ── Запустить службу PostgreSQL (если остановлена) ────────────────────────────
:: ВАЖНО: одна строка. CMD line-continuation '^' после chcp 65001 ломает PowerShell.
powershell -NoProfile -NonInteractive -Command "$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Start-Sleep 4; Write-Host '[pg] PostgreSQL запущен.' } elseif (-not $svc) { Write-Host '[pg] Служба PostgreSQL не найдена — проверь установку.' }" 2>nul

:: ── Запустить сервер приложения ───────────────────────────────────────────────
set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set ENV_FILE=%SCRIPT_DIR%.env
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set LOG_TS=%%I
set LOG_FILE=%LOG_DIR%\server-%LOG_TS%.log

if not exist "%SCRIPT_DIR%feosport2-server.exe" (
    echo [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    echo Убедись что установка прошла успешно.
    pause
    exit /b 1
)

if not exist "%ENV_FILE%" (
    echo [setup] .env не найден. Запускаю первичную настройку PostgreSQL...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-db.ps1"
    if errorlevel 1 (
        echo [ОШИБКА] Первичная настройка PostgreSQL не завершена.
        echo Проверьте logs\setup-db.log и запустите ярлык "FeoSport2 — PostgreSQL" повторно.
        pause
        exit /b 1
    )
)

set PSQL=
if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not defined PSQL if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\16\bin\psql.exe"
if not defined PSQL if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\15\bin\psql.exe"
if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        if /I "%%A"=="DB_HOST" set "DB_HOST=%%B"
        if /I "%%A"=="DB_PORT" set "DB_PORT=%%B"
        if /I "%%A"=="DB_NAME" set "DB_NAME=%%B"
        if /I "%%A"=="DB_USER" set "DB_USER=%%B"
        if /I "%%A"=="DB_PASSWORD" set "PGPASSWORD=%%B"
    )
)
if not defined DB_HOST set "DB_HOST=localhost"
if not defined DB_PORT set "DB_PORT=5432"
if not defined DB_NAME set "DB_NAME=feosport2"
if not defined DB_USER set "DB_USER=feosport"

if defined PSQL (
    echo [pg] Проверка подключения к PostgreSQL...
    for /l %%I in (1,1,15) do (
        "%PSQL%" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%DB_NAME%" -tAc "SELECT 1" > nul 2>&1
        if not errorlevel 1 goto pg_ready
        timeout /t 1 /nobreak > nul
    )
    echo [ОШИБКА] PostgreSQL не отвечает или пароль в .env неверный.
    echo Проверьте "%ENV_FILE%" и logs\setup-db.log.
    pause
    exit /b 1
)
:pg_ready

echo [%date% %time%] Starting FeoSport2 from %SCRIPT_DIR% > "%LOG_FILE%"
echo [%date% %time%] Server log: %LOG_FILE% >> "%LOG_FILE%"

:: Запускаем в отдельном окне и пишем stdout/stderr в logs\server-*.log
start "FeoSport2 Server" cmd /c ""%SCRIPT_DIR%feosport2-server.exe" >> "%LOG_FILE%" 2>&1"

:: Подождать инициализации и открыть браузер
timeout /t 3 /nobreak > nul
start "" "http://localhost:8090"

echo.
echo  FeoSport2 запущен: http://localhost:8090
echo  Лог сервера: %LOG_FILE%
echo  Чтобы остановить — запустите stop-feosport.bat
echo.
