@echo off
chcp 65001 > nul
title FeoSport2 — Тестовые данные

set APP_DIR=%~dp0
set SEED_SQL=%APP_DIR%database\seed.sql

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

set /p PGPASSWORD=  Введи пароль postgres-суперпользователя:

echo.
"%PSQL%" -U postgres -d feosport2 -f "%SEED_SQL%"

if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось применить seed.sql
    echo  Проверь что база feosport2 существует и пароль верный.
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
