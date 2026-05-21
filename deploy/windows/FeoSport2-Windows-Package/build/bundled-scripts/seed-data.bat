@echo off
chcp 65001 > nul
title FeoSport2 — Тестовые данные

set APP_DIR=%~dp0
set SEED_SQL=%APP_DIR%database\seed.sql
set SEED_USERS_SQL=%APP_DIR%database\seed-users.sql
set ENV_FILE=%APP_DIR%.env

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   FeoSport2 — Загрузка тестовых данных              ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Будут созданы:
echo    - 4 тестовых пользователя (все роли)
echo    - 16 пилотов (2 команды)
echo    - 2 соревнования с результатами и плей-офф сеткой
echo.

:: Ищем psql
set PSQL=
if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\16\bin\psql.exe"
if not defined PSQL if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\15\bin\psql.exe"
if not defined PSQL if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\17\bin\psql.exe"
if not defined PSQL (
    where psql > nul 2>&1 && set "PSQL=psql"
)
if not defined PSQL (
    echo  [ОШИБКА] psql не найден.
    echo  Убедись что PostgreSQL установлен корректно.
    pause & exit /b 1
)

if not exist "%SEED_SQL%" (
    echo  [ОШИБКА] seed.sql не найден: %SEED_SQL%
    pause & exit /b 1
)

if not exist "%SEED_USERS_SQL%" (
    echo  [ОШИБКА] seed-users.sql не найден: %SEED_USERS_SQL%
    pause & exit /b 1
)

if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        if /I "%%A"=="DB_HOST" set "DB_HOST=%%B"
        if /I "%%A"=="DB_PORT" set "DB_PORT=%%B"
        if /I "%%A"=="DB_NAME" set "DB_NAME=%%B"
        if /I "%%A"=="DB_USER" set "DB_USER=%%B"
        if /I "%%A"=="DB_PASSWORD" set "PGPASSWORD=%%B"
    )
) else (
    echo  [ПРЕДУПРЕЖДЕНИЕ] .env не найден: %ENV_FILE%
)

if not defined DB_HOST set "DB_HOST=localhost"
if not defined DB_PORT set "DB_PORT=5432"
if not defined DB_NAME set "DB_NAME=feosport2"
if not defined DB_USER set "DB_USER=feosport"
if not defined PGPASSWORD set /p PGPASSWORD=  Введи пароль пользователя %DB_USER%:

echo.
"%PSQL%" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%DB_NAME%" -f "%SEED_USERS_SQL%"
if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось применить seed-users.sql
    echo  Проверь .env, пароль пользователя БД и наличие схемы.
    pause & exit /b 1
)

"%PSQL%" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%DB_NAME%" -f "%SEED_SQL%"

if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось применить seed.sql
    echo  Проверь что база %DB_NAME% существует и пароль верный.
) else (
    echo.
    echo  ✓ Тестовые данные загружены успешно!
    echo.
    echo  ┌──────────────────────────────────────────────────────┐
    echo  │  Тестовые учётные записи                             │
    echo  ├──────────────────────┬───────────┬───────────────────┤
    echo  │  Email               │ Пароль    │ Роль              │
    echo  ├──────────────────────┼───────────┼───────────────────┤
    echo  │  admin@feosport.local│ admin123  │ Администратор     │
    echo  │  chief@feosport.local│ judge123  │ Главный судья     │
    echo  │  judge@feosport.local│ judge123  │ Судья             │
    echo  │  pilot@feosport.local│ judge123  │ Пилот             │
    echo  └──────────────────────┴───────────┴───────────────────┘
    echo.
    echo  Откройте http://localhost:8090 для входа в систему.
)
echo.
pause
