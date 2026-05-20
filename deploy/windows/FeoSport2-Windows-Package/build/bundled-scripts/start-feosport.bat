@echo off
chcp 65001 > nul

:: Start PostgreSQL service if stopped
sc query postgresql* > nul 2>&1
for /f "tokens=3" %%s in ('sc query postgresql* ^| findstr "STATE"') do (
    if "%%s" == "STOPPED" (
        net start postgresql* > nul 2>&1
        timeout /t 3 /nobreak > nul
    )
)

:: Start the server (hidden window via start /b)
set SCRIPT_DIR=%~dp0
if exist "%SCRIPT_DIR%feosport2-server.exe" (
    start "FeoSport2-Server" /b "%SCRIPT_DIR%feosport2-server.exe"
) else (
    echo [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    pause
    exit /b 1
)

:: Wait a moment then open browser
timeout /t 2 /nobreak > nul
start "" "http://localhost:8090"
