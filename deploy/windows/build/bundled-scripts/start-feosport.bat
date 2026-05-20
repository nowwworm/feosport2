@echo off
chcp 65001 > nul
title FeoSport2

:: ── Запустить службу PostgreSQL (если остановлена) ────────────────────────────
powershell -NoProfile -NonInteractive -Command ^
  "$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1; ^
   if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Start-Sleep 4; Write-Host '[pg] PostgreSQL запущен.' } ^
   elseif (-not $svc) { Write-Host '[pg] Служба PostgreSQL не найдена — проверь установку.' }" 2>nul

:: ── Запустить сервер приложения ───────────────────────────────────────────────
set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set LOG_TS=%%I
set LOG_FILE=%LOG_DIR%\server-%LOG_TS%.log

if not exist "%SCRIPT_DIR%feosport2-server.exe" (
    echo [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    echo Убедись что установка прошла успешно.
    pause
    exit /b 1
)

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
