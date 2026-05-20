<#
.SYNOPSIS
    Создаёт БД feosport2 во время установки Inno Setup.
    Вызывается из [Run] секции installer.iss
#>
param(
    [Parameter(Mandatory)][string]$PgPassword,   # postgres superuser password
    [Parameter(Mandatory)][string]$DbPassword,   # feosport user password
    [Parameter(Mandatory)][string]$JwtSecret,    # JWT secret
    [Parameter(Mandatory)][string]$InstallDir,   # C:\FeoSport2
    [Parameter(Mandatory)][string]$InitSql,      # path to init.sql
    [Parameter(Mandatory)][string]$SeedSql       # path to seed.sql
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $InstallDir "install.log"

function Log { param($msg) Add-Content -Path $LogFile -Value "$(Get-Date -f 'HH:mm:ss') $msg" }

Log "=== FeoSport2 DB Setup START ==="

# Ищем psql
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "${env:ProgramFiles}\PostgreSQL\16\bin\psql.exe"
)
$psql = $pgPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $psql) { Log "ERROR: psql not found"; exit 1 }
Log "psql: $psql"

$env:PGPASSWORD = $PgPassword

# Запустить службу PostgreSQL
$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc -and $svc.Status -ne "Running") {
    Start-Service $svc.Name
    Start-Sleep 4
    Log "PostgreSQL service started: $($svc.Name)"
}

# Создать пользователя и БД
& $psql -U postgres -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='feosport') THEN CREATE USER feosport WITH PASSWORD '$DbPassword'; END IF; END `$`$;" 2>&1 | ForEach-Object { Log $_ }

$dbExists = & $psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='feosport2'" 2>&1
if ($dbExists.Trim() -ne "1") {
    & $psql -U postgres -c "CREATE DATABASE feosport2 OWNER feosport ENCODING 'UTF8';" 2>&1 | ForEach-Object { Log $_ }
    Log "Database feosport2 created"

    & $psql -U postgres -d feosport2 -f $InitSql 2>&1 | ForEach-Object { Log $_ }
    Log "init.sql applied"

    # Тестовые данные: admin + 2 команды + 2 соревнования
    & $psql -U postgres -d feosport2 -f $SeedSql 2>&1 | ForEach-Object { Log $_ }
    Log "seed.sql applied"
} else {
    Log "Database feosport2 already exists — skipping schema and seed"
}

& $psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE feosport2 TO feosport;" 2>&1 | ForEach-Object { Log $_ }

$env:PGPASSWORD = ""

# Записать .env рядом с exe
$envPath = Join-Path $InstallDir ".env"
@"
PORT=8090
DB_HOST=localhost
DB_PORT=5432
DB_NAME=feosport2
DB_USER=feosport
DB_PASSWORD=$DbPassword
JWT_SECRET=$JwtSecret
NODE_ENV=production
"@ | Set-Content -Encoding UTF8 $envPath
Log ".env written to $envPath"

# Открыть порт 8090 в firewall
$ruleName = "FeoSport2"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
        -Protocol TCP -LocalPort 8090 -Action Allow | Out-Null
    Log "Firewall rule created for TCP 8090"
}

Log "=== FeoSport2 DB Setup COMPLETE ==="
exit 0
