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
set LOG_DIR=%SCRIPT_DIR%logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set LOG_TS=%%I
set LOG_FILE=%LOG_DIR%\server-%LOG_TS%.log
if exist "%SCRIPT_DIR%feosport2-server.exe" (
    echo [%date% %time%] Starting FeoSport2 from %SCRIPT_DIR% > "%LOG_FILE%"
    echo [%date% %time%] Server log: %LOG_FILE% >> "%LOG_FILE%"
    start "FeoSport2-Server" /b cmd /c ""%SCRIPT_DIR%feosport2-server.exe" >> "%LOG_FILE%" 2>&1"
) else (
    echo [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    pause
    exit /b 1
)

:: Wait a moment then open browser
timeout /t 2 /nobreak > nul
start "" "http://localhost:8090"
