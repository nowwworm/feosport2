#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Создаёт БД feosport2 и пользователя, запускает init.sql.
    Запускать после 01-install-deps.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Step { param($n, $text) Write-Host "`n=== [$n] $text ===" -ForegroundColor Cyan }
function Write-Ok   { param($text)     Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn { param($text)     Write-Host "  ! $text" -ForegroundColor Yellow }

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..\..\").Path
$PgBin       = "C:\Program Files\PostgreSQL\16\bin"
$psql        = Join-Path $PgBin "psql.exe"
$InitSql     = Join-Path $ProjectRoot "database\init.sql"

if (-not (Test-Path $psql)) {
    Write-Error "psql не найден в $PgBin`nУстанови PostgreSQL: deploy\windows\native\01-install-deps.ps1"
}

# ── Запуск службы PostgreSQL ──────────────────────────────────────────────────
Write-Step 1 "Запуск службы PostgreSQL"
$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $svc) {
    Write-Error "Служба PostgreSQL не найдена. Убедись что PostgreSQL 16 установлен."
}
if ($svc.Status -ne "Running") {
    Start-Service $svc.Name
    Start-Sleep 3
}
Write-Ok "PostgreSQL запущен ($($svc.Name))"

# ── Пароль postgres ───────────────────────────────────────────────────────────
Write-Step 2 "Пароль суперпользователя postgres"
Write-Warn "Нужен пароль, который ты задал при установке PostgreSQL"
$pgPassword = Read-Host "  Пароль postgres" -AsSecureString
$pgPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword)
)
$env:PGPASSWORD = $pgPasswordPlain

# ── Проверка подключения ──────────────────────────────────────────────────────
Write-Step 3 "Проверка подключения"
try {
    & $psql -U postgres -c "SELECT 1" | Out-Null
    Write-Ok "Подключение к PostgreSQL успешно"
} catch {
    Write-Error "Не удалось подключиться. Проверь пароль postgres."
}

# ── Создание пользователя и БД ────────────────────────────────────────────────
Write-Step 4 "Создание пользователя feosport и БД feosport2"

Write-Host "  Введи пароль для пользователя feosport:" -ForegroundColor White
$dbPassword = Read-Host "  Пароль feosport"

# Создать пользователя (игнорируем ошибку "уже существует")
& $psql -U postgres -c "CREATE USER feosport WITH PASSWORD '$dbPassword';" 2>$null
& $psql -U postgres -c "ALTER USER feosport CREATEDB;" 2>$null

# Создать БД
$dbExists = & $psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='feosport2'"
if ($dbExists -ne "1") {
    & $psql -U postgres -c "CREATE DATABASE feosport2 OWNER feosport ENCODING 'UTF8';"
    Write-Ok "База данных feosport2 создана"
} else {
    Write-Warn "База данных feosport2 уже существует"
}

# Привилегии
& $psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE feosport2 TO feosport;"

# ── Инициализация схемы ───────────────────────────────────────────────────────
Write-Step 5 "Применение init.sql"
if (-not (Test-Path $InitSql)) {
    Write-Error "Файл $InitSql не найден!"
}

# Проверяем, инициализирована ли БД уже
$env:PGPASSWORD = $dbPasswordPlain = ""  # не нужен для feosport
$env:PGPASSWORD = $pgPasswordPlain
$tablesExist = & $psql -U postgres -d feosport2 -tAc `
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"
if ([int]$tablesExist -gt 0) {
    Write-Warn "Таблицы уже существуют, пропускаем init.sql"
} else {
    & $psql -U postgres -d feosport2 -f $InitSql
    Write-Ok "Схема применена"
}

# ── Сохраняем пароль в .env ───────────────────────────────────────────────────
Write-Step 6 "Сохранение конфигурации"
$EnvFile = Join-Path $ProjectRoot "backend\.env"

$jwtBytes  = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
$jwtSecret = -join ($jwtBytes | ForEach-Object { $_.ToString("x2") })

$docKeyBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($docKeyBytes)
$docKey = -join ($docKeyBytes | ForEach-Object { $_.ToString("x2") })

@"
PORT=8090
DB_HOST=localhost
DB_PORT=5432
DB_NAME=feosport2
DB_USER=feosport
DB_PASSWORD=$dbPassword
JWT_SECRET=$jwtSecret
DOCUMENT_ENCRYPTION_KEY=$docKey
DOCUMENT_ENCRYPTION_KEY_ID=local-v1
NODE_ENV=development
"@ | Set-Content -Encoding UTF8 $EnvFile

Write-Ok "backend\.env создан"

# Очищаем пароль из памяти
$env:PGPASSWORD = ""

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  База данных готова!                          ║" -ForegroundColor Green
Write-Host "║  Следующий шаг:                               ║" -ForegroundColor Green
Write-Host "║  deploy\windows\native\start.bat              ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
