#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Создаёт deploy\.env с паролями и JWT_SECRET для Docker-запуска.
    Запускать ПОСЛЕ перезагрузки и запуска Docker Desktop.
#>

$ErrorActionPreference = "Stop"

function Write-Step { param($n, $text) Write-Host "`n=== [$n] $text ===" -ForegroundColor Cyan }
function Write-Ok   { param($text)     Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn { param($text)     Write-Host "  ! $text" -ForegroundColor Yellow }

# Путь к корню проекта (3 уровня вверх от этого скрипта)
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..\..\").Path
$EnvFile     = Join-Path $ProjectRoot "deploy\.env"

Write-Step 1 "Проверка Docker"
try {
    docker info | Out-Null
    Write-Ok "Docker запущен"
} catch {
    Write-Error "Docker Desktop не запущен! Запусти его и попробуй снова."
}

Write-Step 2 "Создание deploy\.env"

if (Test-Path $EnvFile) {
    Write-Warn "deploy\.env уже существует"
    $overwrite = Read-Host "  Перезаписать? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "  Пропускаем создание .env" -ForegroundColor Yellow
        exit 0
    }
}

# Генерация JWT_SECRET (32 байта в hex)
$jwtBytes  = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
$jwtSecret = -join ($jwtBytes | ForEach-Object { $_.ToString("x2") })

# Ключ шифрования документов AES-256-GCM (32 байта в hex)
$docKeyBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($docKeyBytes)
$docKey = -join ($docKeyBytes | ForEach-Object { $_.ToString("x2") })

# Пароль БД
Write-Host ""
$dbPassword = Read-Host "  Введи пароль для PostgreSQL (или Enter для случайного)"
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    $pwBytes    = New-Object byte[] 12
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($pwBytes)
    $dbPassword = [Convert]::ToBase64String($pwBytes) -replace "[/+=]", "X"
    Write-Ok "Сгенерирован пароль: $dbPassword"
}

@"
# FeoSport2 — Production Environment
# Создано: $(Get-Date -Format "yyyy-MM-dd HH:mm")

POSTGRES_DB=feosport2
POSTGRES_USER=feosport
POSTGRES_PASSWORD=$dbPassword

JWT_SECRET=$jwtSecret
DOCUMENT_ENCRYPTION_KEY=$docKey
DOCUMENT_ENCRYPTION_KEY_ID=local-v1

HTTP_PORT=80
"@ | Set-Content -Encoding UTF8 $EnvFile

Write-Ok "deploy\.env создан"

Write-Step 3 "Firewall — открываем порт 80"
$ruleName = "FeoSport2-HTTP"
$exists   = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $exists) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
        -Protocol TCP -LocalPort 80 -Action Allow | Out-Null
    Write-Ok "Правило firewall создано (TCP 80)"
} else { Write-Ok "Правило firewall уже существует" }

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Готово! Теперь запусти:                 ║" -ForegroundColor Green
Write-Host "║  deploy\windows\docker\start.bat         ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
