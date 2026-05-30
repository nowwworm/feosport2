@echo off
chcp 65001 > nul
title FeoSport2 — запуск

set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set ENV_FILE=%SCRIPT_DIR%.env

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: ── Ротация старых логов (>30 дней) ──────────────────────────────────────────
:: server-*.log создаётся при каждом запуске — за месяц активного использования
:: может набраться 200+ файлов. setup-db*.log дозаписывается каждым setup-запуском.
:: Чистим всё что старше 30 дней. Тихо если нечего чистить.
powershell -NoProfile -Command "$cut = (Get-Date).AddDays(-30); $old = @(Get-ChildItem -Path '%LOG_DIR%\server-*.log','%LOG_DIR%\setup-db*.log' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cut }); if ($old.Count -gt 0) { $old | Remove-Item -Force -ErrorAction SilentlyContinue; Write-Host ('[logs] подчищено ' + $old.Count + ' старых файлов (>30 дней)') }" 2>nul

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set LOG_TS=%%I
set LOG_FILE=%LOG_DIR%\server-%LOG_TS%.log

:: ── Pre-flight: exe на месте ─────────────────────────────────────────────────
if not exist "%SCRIPT_DIR%feosport2-server.exe" (
    echo.
    echo  [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    echo  Возможно, установка прошла не полностью. Переустановите FeoSport2.
    echo.
    pause
    exit /b 1
)

:: ── Pre-flight: порт 8090 свободен? ──────────────────────────────────────────
echo [pre-flight] Проверка порта 8090...
set PORT_PID=
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8090" ^| findstr LISTENING') do (
    set PORT_PID=%%P
    goto :port_busy
)
goto :port_free

:port_busy
set PORT_PROC=unknown
for /f "tokens=1 delims=, " %%I in ('tasklist /FI "PID eq %PORT_PID%" /FO CSV /NH 2^>nul') do set PORT_PROC=%%~I
echo.
echo  [info] Порт 8090 занят процессом PID=%PORT_PID% (%PORT_PROC%)
if /I "%PORT_PROC%"=="feosport2-server.exe" (
    echo  Это старый зависший FeoSport2. Останавливаю...
    taskkill /F /PID %PORT_PID% > nul 2>&1
    timeout /t 2 /nobreak > nul
    echo  Зомби остановлен. Продолжаю запуск.
    goto :port_free
)
echo.
echo  [ОШИБКА] Порт 8090 занят посторонним процессом — FeoSport2 не запустится.
echo  Что можно сделать:
echo    1. Остановить процесс %PORT_PROC% (если ваш) — Task Manager -^> Details -^> PID %PORT_PID%
echo    2. Или сменить порт в "%ENV_FILE%" — поле PORT (после правки нужно перезапустить).
echo.
echo  Запускаю автосбор логов для диагностики...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%collect-logs.ps1"
exit /b 1

:port_free

:: ── PostgreSQL service ───────────────────────────────────────────────────────
:: ВАЖНО: одна строка. CMD line-continuation '^' после chcp 65001 ломает PowerShell.
powershell -NoProfile -NonInteractive -Command "$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Start-Sleep 4; Write-Host '[pg] PostgreSQL запущен.' } elseif (-not $svc) { Write-Host '[pg] Служба PostgreSQL не найдена — проверь установку.' }" 2>nul

:: ── Первичная настройка БД если .env ещё не создан ───────────────────────────
if not exist "%ENV_FILE%" (
    echo [setup] .env не найден. Запускаю первичную настройку PostgreSQL...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-db.ps1"
    if errorlevel 1 (
        echo.
        echo  [ОШИБКА] Первичная настройка PostgreSQL не завершена.
        echo  Запускаю автосбор логов для диагностики...
        echo.
        powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%collect-logs.ps1"
        exit /b 1
    )
)

:: ── PostgreSQL connectivity check ────────────────────────────────────────────
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
    echo [pg] Проверка подключения к %DB_HOST%:%DB_PORT%/%DB_NAME%...
    for /l %%I in (1,1,15) do (
        "%PSQL%" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%DB_NAME%" -tAc "SELECT 1" > nul 2>&1
        if not errorlevel 1 goto pg_ready
        timeout /t 1 /nobreak > nul
    )
    echo.
    echo  [ОШИБКА] PostgreSQL не отвечает по %DB_HOST%:%DB_PORT% или неверный пароль в .env.
    echo  Возможно, на 5432 висит другой PostgreSQL (старый instance).
    echo  Проверьте: netstat -ano ^| findstr :%DB_PORT%
    echo.
    echo  Запускаю автосбор логов для диагностики...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%collect-logs.ps1"
    exit /b 1
)
:pg_ready

:: ── Запустить сервер ─────────────────────────────────────────────────────────
echo [%date% %time%] Starting FeoSport2 from %SCRIPT_DIR% > "%LOG_FILE%"
echo [%date% %time%] Server log: %LOG_FILE% >> "%LOG_FILE%"

start "FeoSport2 Server" cmd /c ""%SCRIPT_DIR%feosport2-server.exe" >> "%LOG_FILE%" 2>&1"

:: ── Post-launch health check: ждём 200 от /healthz ───────────────────────────
echo [server] Жду ответа сервера на http://localhost:8090/healthz...
for /l %%I in (1,1,20) do (
    timeout /t 1 /nobreak > nul
    curl -s -o nul -w "%%{http_code}" http://localhost:8090/healthz 2>nul | findstr /B "200" > nul
    if not errorlevel 1 goto :healthy
)
goto :unhealthy

:healthy
echo.
echo  ✓ FeoSport2 запущен: http://localhost:8090
echo  ✓ Лог сервера: %LOG_FILE%
echo  ✓ Остановка — ярлык "FeoSport2 — остановка".
echo.
start "" "http://localhost:8090"
timeout /t 4 /nobreak > nul
exit /b 0

:unhealthy
echo.
echo  [ОШИБКА] feosport2-server.exe не отвечает на /healthz после 20 сек.
echo  Возможные причины:
echo    - exe упал при старте (см. логи ниже)
echo    - PostgreSQL не отвечает на запросы
echo    - конфликт версий / повреждённая установка
echo.
echo  Лог сервера: %LOG_FILE%
echo.
echo  Запускаю автосбор полных логов для диагностики...
echo  (соберёт zip на рабочий стол: FeoSport2-logs-^<COMPUTER^>-^<TIMESTAMP^>.zip)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%collect-logs.ps1"
pause
exit /b 1
