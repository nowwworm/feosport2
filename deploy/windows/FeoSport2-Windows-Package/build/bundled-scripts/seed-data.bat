@echo off
chcp 65001 > nul
title FeoSport2 — Тестовые данные

set APP_DIR=%~dp0
set SEED_SQL=%APP_DIR%database\seed.sql

echo.
echo [FeoSport2] Загрузка тестовых данных через psql...
echo   Потребуется пароль суперпользователя postgres.
echo.

:: Ищем psql
set PSQL=
if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set PSQL=C:\Program Files\PostgreSQL\16\bin\psql.exe
if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set PSQL=C:\Program Files\PostgreSQL\15\bin\psql.exe
if "%PSQL%"=="" (
    where psql > nul 2>&1 && set PSQL=psql
)
if "%PSQL%"=="" (
    echo [ОШИБКА] psql не найден. Убедись что PostgreSQL установлен.
    pause & exit /b 1
)

if not exist "%SEED_SQL%" (
    echo [ОШИБКА] seed.sql не найден: %SEED_SQL%
    pause & exit /b 1
)

set /p PGPASSWORD=Введи пароль postgres:
"%PSQL%" -U postgres -d feosport2 -f "%SEED_SQL%"

if errorlevel 1 (
    echo [ОШИБКА] Не удалось применить seed.sql
) else (
    echo.
    echo Готово! Тестовые данные загружены.
    echo   Логин: admin@feosport.local / admin123
    echo   Логин: chief@feosport.local / judge123
)
echo.
pause
