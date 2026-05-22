#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Собирает FeoSport2-Setup.exe из исходников.
    Запускать из корня проекта:
        powershell -ExecutionPolicy Bypass -File deploy\windows\build\build-installer.ps1

.DESCRIPTION
    Этапы:
      1. npm install + pkg → feosport2-server.exe (Node.js не нужен пользователю)
      2. npm install + vite build → frontend-dist/
      3. Скачать PostgreSQL 16 installer (если нет)
      4. Установить Inno Setup 6 (если нет)
      5. ISCC → FeoSport2-Setup.exe
#>

$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Step { param($n, $text)
    Write-Host ""
    Write-Host "┌─── [$n] $text" -ForegroundColor Cyan
}
function Write-Ok   { param($t) Write-Host "│  ✓ $t" -ForegroundColor Green }
function Write-Warn { param($t) Write-Host "│  ! $t" -ForegroundColor Yellow }
function Write-Fail { param($t) Write-Host "│  ✗ $t" -ForegroundColor Red; exit 1 }
function Invoke-CodeSign {
    param([Parameter(Mandatory)][string]$FilePath)

    $certPath = $env:FEOSPORT_SIGN_CERT_PATH
    if ([string]::IsNullOrWhiteSpace($certPath)) {
        Write-Warn "Подпись пропущена для $(Split-Path $FilePath -Leaf): FEOSPORT_SIGN_CERT_PATH не задан"
        return
    }
    if (-not (Test-Path $certPath)) {
        Write-Warn "Подпись пропущена: сертификат не найден $certPath"
        return
    }

    $timestampUrl = if ($env:FEOSPORT_TIMESTAMP_URL) { $env:FEOSPORT_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }
    $signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue)?.Source
    if (-not $signtool) {
        $kits = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        $signtool = $kits?.FullName
    }
    if (-not $signtool) {
        Write-Warn "Подпись пропущена: signtool.exe не найден"
        return
    }

    $args = @("sign", "/fd", "SHA256", "/f", $certPath, "/tr", $timestampUrl, "/td", "SHA256")
    if ($env:FEOSPORT_SIGN_CERT_PASSWORD) {
        $args += @("/p", $env:FEOSPORT_SIGN_CERT_PASSWORD)
    }
    $args += $FilePath

    & $signtool @args
    if ($LASTEXITCODE -ne 0) { Write-Fail "Не удалось подписать $FilePath" }
    Write-Ok "Подписано: $(Split-Path $FilePath -Leaf)"
}

# ── Пути ─────────────────────────────────────────────────────────────────────
$ScriptDir   = $PSScriptRoot
$ProjectRoot = (Resolve-Path "$ScriptDir\..\..\..\").Path
$BuildDir    = $ScriptDir
$StagingDir  = Join-Path $BuildDir "staging"
$DepsDir     = Join-Path $BuildDir "deps"
$OutputDir   = Join-Path $BuildDir "..\output"
$IsccExe     = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

# Создать директории
foreach ($d in @($StagingDir, $DepsDir, $OutputDir,
                 "$StagingDir\app\scripts",
                 "$StagingDir\frontend-dist",
                 "$StagingDir\database")) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ── Шаг 1: Backend → feosport2-server.exe ────────────────────────────────────
Write-Step 1 "Компиляция backend → feosport2-server.exe (pkg)"

$backendDir = Join-Path $ProjectRoot "backend"
Push-Location $backendDir
try {
    Write-Host "│  npm install..." -ForegroundColor White
    npm install --silent

    Write-Host "│  Установка pkg глобально..." -ForegroundColor White
    npm install -g @vercel/pkg --silent 2>$null

    $pkgTarget = "node20-win-x64"
    $pkgOutput = Join-Path $StagingDir "app\feosport2-server.exe"

    Write-Host "│  pkg compile (может занять 1-2 мин)..." -ForegroundColor White
    pkg src/server-bundled.js `
        --target $pkgTarget `
        --output $pkgOutput `
        --compress GZip

    if (-not (Test-Path $pkgOutput)) { Write-Fail "pkg не создал exe" }
    Invoke-CodeSign $pkgOutput
    $sizeMb = [Math]::Round((Get-Item $pkgOutput).Length / 1MB, 1)
    Write-Ok "feosport2-server.exe ($sizeMb MB)"

    # Копировать seed скрипт
    Copy-Item "scripts\seed.js" "$StagingDir\app\scripts\seed.js" -Force
    Write-Ok "seed.js скопирован"
} finally {
    Pop-Location
}

# ── Шаг 2: Frontend → vite build ─────────────────────────────────────────────
Write-Step 2 "Сборка frontend (vite build)"

$frontendDir = Join-Path $ProjectRoot "frontend"
Push-Location $frontendDir
try {
    Write-Host "│  npm ci (dev dependencies)..." -ForegroundColor White
    npm ci --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm ci завершился с кодом $LASTEXITCODE" }
    if (-not (Test-Path "node_modules\.bin\vite.cmd")) {
        npm ls vite
        Write-Fail "frontend install не создал node_modules\.bin\vite.cmd"
    }

    Write-Host "│  vite build..." -ForegroundColor White
    # VITE_API_URL пустой → axios будет слать на /api (сервер сам раздаёт)
    $env:VITE_API_URL = ""
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm run build завершился с кодом $LASTEXITCODE" }

    $distDir = Join-Path $frontendDir "dist"
    if (-not (Test-Path $distDir)) { Write-Fail "vite build не создал dist/" }

    Copy-Item "$distDir\*" "$StagingDir\frontend-dist\" -Recurse -Force
    $fileCount = (Get-ChildItem "$StagingDir\frontend-dist" -Recurse -File).Count
    Write-Ok "frontend-dist/ ($fileCount файлов)"
} finally {
    Pop-Location
}

# ── Шаг 2b: TMX → vite build ─────────────────────────────────────────────────
Write-Step "2b" "Сборка TMX (feoTEST/TMX, vite build)"

$tmxDir     = Join-Path $ProjectRoot "feoTEST\TMX"
$tmxDist    = Join-Path $tmxDir "dist"
$tmxStaging = Join-Path $StagingDir "tmx-dist"

New-Item -ItemType Directory -Force -Path $tmxStaging | Out-Null

if (-not (Test-Path $tmxDir)) {
    Write-Warn "Папка feoTEST\TMX не найдена — пропускаем TMX"
} else {
    Push-Location $tmxDir
    try {
        if (-not (Test-Path (Join-Path $tmxDir "node_modules"))) {
            Write-Host "│  pnpm install (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)..." -ForegroundColor White
            $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
            $env:ELECTRON_SKIP_BINARY_DOWNLOAD    = "1"
            $env:CI = "true"
            pnpm install --config.confirmModulesPurge=false
        }

        Write-Host "│  vite build (BASE_URL=tmx)..." -ForegroundColor White
        $env:BASE_URL = "tmx"
        pnpm exec rimraf dist
        pnpm exec vite build

        if (-not (Test-Path $tmxDist)) { Write-Fail "TMX: vite build не создал dist/" }

        Copy-Item "$tmxDist\*" "$tmxStaging\" -Recurse -Force
        $fileCount = (Get-ChildItem $tmxStaging -Recurse -File).Count
        Write-Ok "tmx-dist/ ($fileCount файлов)"
    } finally {
        Pop-Location
    }
}

# ── Шаг 3: init.sql + миграции ───────────────────────────────────────────────
Write-Step 3 "Копирование database/"
Copy-Item (Join-Path $ProjectRoot "database\init.sql") "$StagingDir\database\init.sql" -Force
Copy-Item (Join-Path $ProjectRoot "database\seed-users.sql") "$StagingDir\database\seed-users.sql" -Force
Copy-Item (Join-Path $ProjectRoot "database\seed.sql") "$StagingDir\database\seed.sql" -Force

$migrationsSrc = Join-Path $ProjectRoot "database\migrations"
$migrationsDst = Join-Path $StagingDir "database\migrations"
New-Item -ItemType Directory -Force -Path $migrationsDst | Out-Null
if (Test-Path $migrationsSrc) {
    Copy-Item "$migrationsSrc\*" $migrationsDst -Force
    $migCount = (Get-ChildItem $migrationsDst -Filter *.sql).Count
    Write-Ok "init.sql + seed.sql + seed-users.sql + $migCount миграций скопировано"
} else {
    Write-Warn "database\migrations\ не найден — миграции не будут включены"
}

# ── Шаг 4: PostgreSQL installer ───────────────────────────────────────────────
Write-Step 4 "PostgreSQL 16 installer"
$pgInstaller = Join-Path $DepsDir "postgresql-16-win-x64.exe"

if (Test-Path $pgInstaller) {
    $sizeMb = [Math]::Round((Get-Item $pgInstaller).Length / 1MB, 0)
    Write-Ok "Уже есть ($sizeMb MB)"
} else {
    Write-Host "│  Скачиваем PostgreSQL 16 (~300 MB)..." -ForegroundColor White
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64.exe"
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($pgUrl, $pgInstaller)
        Write-Ok "PostgreSQL installer скачан"
    } catch {
        Write-Warn "Не удалось скачать PostgreSQL: $_"
        Write-Warn "Скачай вручную с https://www.postgresql.org/download/windows/"
        Write-Warn "и положи в: $pgInstaller"
        Write-Warn "Затем запусти build-installer.ps1 снова."
        # Не прерываем — Inno Setup скомпилирует, но компонент postgres не будет работать
    }
}

# ── Шаг 5: Inno Setup ────────────────────────────────────────────────────────
Write-Step 5 "Inno Setup 6"
if (-not (Test-Path $IsccExe)) {
    Write-Host "│  Устанавливаем Inno Setup 6 через winget..." -ForegroundColor White
    winget install -e --id JRSoftware.InnoSetup `
        --accept-source-agreements --accept-package-agreements --silent
    if (-not (Test-Path $IsccExe)) {
        # winget мог установить в другое место
        $IsccExe = (Get-Command ISCC.exe -ErrorAction SilentlyContinue)?.Source
        if (-not $IsccExe) { Write-Fail "Inno Setup не найден. Установи вручную: https://jrsoftware.org/isdl.php" }
    }
}
Write-Ok "Inno Setup найден: $IsccExe"

# ── Шаг 6: Компиляция .iss → .exe ────────────────────────────────────────────
Write-Step 6 "Компиляция installer.iss → FeoSport2-Setup.exe"

$issFile = Join-Path $BuildDir "feosport2.iss"
Push-Location $BuildDir
try {
    & $IsccExe $issFile
    if ($LASTEXITCODE -ne 0) { Write-Fail "ISCC.exe завершился с ошибкой $LASTEXITCODE" }
} finally {
    Pop-Location
}

$outputExe = Join-Path $OutputDir "FeoSport2-Setup.exe"
if (-not (Test-Path $outputExe)) { Write-Fail "Installer не создан" }

$sizeMb = [Math]::Round((Get-Item $outputExe).Length / 1MB, 0)
Invoke-CodeSign $outputExe

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✅ FeoSport2-Setup.exe готов!                           ║" -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Green
Write-Host "║  Файл: deploy\windows\output\FeoSport2-Setup.exe         ║" -ForegroundColor Green
Write-Host ("║  Размер: {0,3} MB{1,43}║" -f $sizeMb, " ") -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Green
Write-Host "║  Запусти от имени Администратора на целевой машине.      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
