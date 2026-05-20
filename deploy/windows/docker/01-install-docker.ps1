#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Устанавливает Docker Desktop на Windows 11.
    Запускать из корня проекта:
    powershell -ExecutionPolicy Bypass -File deploy\windows\docker\01-install-docker.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Step { param($n, $text) Write-Host "`n=== [$n] $text ===" -ForegroundColor Cyan }
function Write-Ok   { param($text)     Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn { param($text)     Write-Host "  ! $text" -ForegroundColor Yellow }

# ── Проверка Windows версии ───────────────────────────────────────────────────
Write-Step 1 "Проверка совместимости"
$build = [System.Environment]::OSVersion.Version.Build
if ($build -lt 19041) {
    Write-Error "Требуется Windows 10 версии 2004 (build 19041) или выше."
}
Write-Ok "Windows build $build — OK"

# ── WSL 2 ─────────────────────────────────────────────────────────────────────
Write-Step 2 "Включение WSL 2 и Virtual Machine Platform"

$wslFeature = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).State
if ($wslFeature -ne "Enabled") {
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
    Write-Ok "WSL включён"
} else { Write-Ok "WSL уже включён" }

$vmpFeature = (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State
if ($vmpFeature -ne "Enabled") {
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
    Write-Ok "Virtual Machine Platform включён"
} else { Write-Ok "Virtual Machine Platform уже включён" }

# Обновление ядра WSL 2
wsl --update 2>$null
wsl --set-default-version 2 2>$null
Write-Ok "WSL 2 установлен как версия по умолчанию"

# ── Docker Desktop ────────────────────────────────────────────────────────────
Write-Step 3 "Установка Docker Desktop"

$dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerInstalled) {
    $v = (docker --version) 2>$null
    Write-Ok "Docker уже установлен: $v"
} else {
    Write-Host "  Загрузка Docker Desktop через winget..." -ForegroundColor White
    winget install -e --id Docker.DockerDesktop `
        --accept-source-agreements `
        --accept-package-agreements `
        --silent
    Write-Ok "Docker Desktop установлен"
}

# ── Добавление пользователя в группу docker-users ─────────────────────────────
Write-Step 4 "Настройка прав пользователя"
$currentUser = $env:USERNAME
$dockerGroup  = "docker-users"
try {
    $group = [ADSI]"WinNT://./$dockerGroup,group"
    $member = [ADSI]"WinNT://./$currentUser,user"
    $group.Add($member.Path)
    Write-Ok "Пользователь $currentUser добавлен в $dockerGroup"
} catch {
    Write-Warn "Не удалось добавить в группу (возможно уже добавлен): $_"
}

# ── Итог ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Установка завершена! Следующие шаги:              ║" -ForegroundColor Green
Write-Host "║  1. ПЕРЕЗАГРУЗИ компьютер                          ║" -ForegroundColor Green
Write-Host "║  2. Дождись запуска Docker Desktop (иконка в трее) ║" -ForegroundColor Green
Write-Host "║  3. Запусти: deploy\windows\docker\02-setup-env.ps1║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

$restart = Read-Host "Перезагрузить сейчас? (y/N)"
if ($restart -eq "y" -or $restart -eq "Y") {
    Restart-Computer -Force
}
