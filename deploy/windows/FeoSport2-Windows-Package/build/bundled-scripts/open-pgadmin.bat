@echo off
chcp 65001 > nul
title FeoSport2 — pgAdmin 4

set PGADMIN=
if exist "C:\Program Files\pgAdmin 4\runtime\pgAdmin4.exe" set "PGADMIN=C:\Program Files\pgAdmin 4\runtime\pgAdmin4.exe"
if not defined PGADMIN if exist "C:\Program Files (x86)\pgAdmin 4\runtime\pgAdmin4.exe" set "PGADMIN=C:\Program Files (x86)\pgAdmin 4\runtime\pgAdmin4.exe"
if not defined PGADMIN if exist "C:\Program Files\PostgreSQL\17\pgAdmin 4\runtime\pgAdmin4.exe" set "PGADMIN=C:\Program Files\PostgreSQL\17\pgAdmin 4\runtime\pgAdmin4.exe"
if not defined PGADMIN if exist "C:\Program Files\PostgreSQL\16\pgAdmin 4\runtime\pgAdmin4.exe" set "PGADMIN=C:\Program Files\PostgreSQL\16\pgAdmin 4\runtime\pgAdmin4.exe"
if not defined PGADMIN if exist "C:\Program Files\PostgreSQL\15\pgAdmin 4\runtime\pgAdmin4.exe" set "PGADMIN=C:\Program Files\PostgreSQL\15\pgAdmin 4\runtime\pgAdmin4.exe"

if not defined PGADMIN (
    echo.
    echo  [ОШИБКА] pgAdmin 4 не найден.
    echo  Установите pgAdmin 4 или PostgreSQL с компонентом pgAdmin.
    echo.
    pause
    exit /b 1
)

start "" "%PGADMIN%"
