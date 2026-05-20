#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Устанавливает Node.js 20 и PostgreSQL 16 через winget.
    Запускать из корня проекта от имени Администратора.
#>

$ErrorActionPreference = "Stop"

function Write-Step { param($n, $text) Write-Host "`n=== [$n] $text ===" -ForegroundColor Cyan }
function Write-Ok   { param($text)     Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn { param($text)     Write-Host "  ! $text" -ForegroundColor Yellow }

# ── winget доступен? ──────────────────────────────────────────────────────────
Write-Step 1 "Проверка winget"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget не найден. Установи App Installer из Microsoft Store."
}
Write-Ok "winget доступен"

# ── Node.js 20 LTS ────────────────────────────────────────────────────────────
Write-Step 2 "Node.js 20 LTS"
$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue
if ($nodeInstalled) {
    $v = node --version
    Write-Ok "Node.js уже установлен: $v"
} else {
    Write-Host "  Установка Node.js 20..." -ForegroundColor White
    winget install -e --id OpenJS.NodeJS.LTS `
        --version "20.*" `
        --accept-source-agreements `
        --accept-package-agreements `
        --silent
    Write-Ok "Node.js установлен"
}

# ── PostgreSQL 16 ─────────────────────────────────────────────────────────────
Write-Step 3 "PostgreSQL 16"
$pgPath = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (Test-Path $pgPath) {
    Write-Ok "PostgreSQL 16 уже установлен"
} else {
    Write-Host "  Установка PostgreSQL 16..." -ForegroundColor White
    winget install -e --id PostgreSQL.PostgreSQL.16 `
        --accept-source-agreements `
        --accept-package-agreements `
        --silent
    Write-Ok "PostgreSQL 16 установлен"
}

# ── Обновление PATH ───────────────────────────────────────────────────────────
Write-Step 4 "Обновление PATH"
$pgBin  = "C:\Program Files\PostgreSQL\16\bin"
$curPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
if ($curPath -notlike "*$pgBin*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$curPath;$pgBin", "Machine")
    Write-Ok "PostgreSQL добавлен в PATH"
} else { Write-Ok "PostgreSQL уже в PATH" }

# Обновить PATH в текущей сессии
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

# ── npm dependencies ──────────────────────────────────────────────────────────
Write-Step 5 "Установка npm-пакетов"
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..\..\").Path

Write-Host "  Backend..." -ForegroundColor White
Push-Location (Join-Path $ProjectRoot "backend")
npm install
Pop-Location
Write-Ok "Backend npm install OK"

Write-Host "  Frontend..." -ForegroundColor White
Push-Location (Join-Path $ProjectRoot "frontend")
npm install
Pop-Location
Write-Ok "Frontend npm install OK"

# ── Итог ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Зависимости установлены!                    ║" -ForegroundColor Green
Write-Host "║  Следующий шаг:                              ║" -ForegroundColor Green
Write-Host "║  deploy\windows\native\02-setup-db.ps1       ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Warn "Если node/psql не найдены — закрой и открой PowerShell заново."
