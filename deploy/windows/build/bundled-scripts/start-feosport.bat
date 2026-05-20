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

if not exist "%SCRIPT_DIR%feosport2-server.exe" (
    echo [ОШИБКА] feosport2-server.exe не найден в %SCRIPT_DIR%
    echo Убедись что установка прошла успешно.
    pause
    exit /b 1
)

:: Запускаем в отдельном окне (чтобы bat не завис)
start "FeoSport2 Server" "%SCRIPT_DIR%feosport2-server.exe"

:: Подождать инициализации и открыть браузер
timeout /t 3 /nobreak > nul
start "" "http://localhost:8090"

echo.
echo  FeoSport2 запущен: http://localhost:8090
echo  Чтобы остановить — запустите stop-feosport.bat
echo.
