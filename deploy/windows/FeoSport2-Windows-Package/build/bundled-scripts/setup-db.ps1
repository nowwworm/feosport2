<#
.SYNOPSIS
    Создаёт БД feosport2 во время установки Inno Setup.
    Вызывается из [Run] секции installer.iss
#>
param(
    [string]$PgPassword,   # postgres superuser password
    [string]$DbPassword,   # feosport user password
    [string]$DbPort = "5432",  # PostgreSQL port (default 5432, может быть переопределён инсталлятором)
    [AllowEmptyString()][string]$JwtSecret,    # JWT secret
    [string]$InstallDir,   # C:\FeoSport2
    [string]$InitSql,      # path to init.sql
    [string]$SeedUsersSql, # path to seed-users.sql
    [string]$SeedSql       # path to seed.sql
)

# Нормализация порта — пустая строка → 5432
if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort = "5432" }
$env:PGPORT = $DbPort

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($InitSql)) { $InitSql = Join-Path $InstallDir "database\init.sql" }
if ([string]::IsNullOrWhiteSpace($SeedUsersSql)) { $SeedUsersSql = Join-Path $InstallDir "database\seed-users.sql" }
if ([string]::IsNullOrWhiteSpace($SeedSql)) { $SeedSql = Join-Path $InstallDir "database\seed.sql" }

if ([string]::IsNullOrWhiteSpace($PgPassword)) {
    $PgPassword = Read-Host "Введите пароль суперпользователя postgres"
}
if ([string]::IsNullOrWhiteSpace($DbPassword)) {
    $DbPassword = Read-Host "Введите пароль пользователя feosport"
}

$LogDir = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "setup-db.log"
$TranscriptFile = Join-Path $LogDir "setup-db-transcript.log"

function Log { param($msg) Add-Content -Path $LogFile -Value "$(Get-Date -f 'HH:mm:ss') $msg" }

function Escape-SqlLiteral {
    param([string]$Value)
    return $Value.Replace("'", "''")
}

function New-HexSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

Start-Transcript -Path $TranscriptFile -Append | Out-Null

try {
if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
    $JwtSecret = New-HexSecret
}
$DocumentEncryptionKey = New-HexSecret

Log "=== FeoSport2 DB Setup START ==="
Log "InstallDir: $InstallDir"
Log "InitSql: $InitSql"
Log "SeedUsersSql: $SeedUsersSql"
Log "SeedSql: $SeedSql"

# Ищем psql
$pgPaths = @(
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "${env:ProgramFiles}\PostgreSQL\16\bin\psql.exe"
)
$psql = $pgPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $psql) { Log "ERROR: psql not found"; exit 1 }
Log "psql: $psql"

$env:PGPASSWORD = $PgPassword

# ── Port 5432 pre-flight check ───────────────────────────────────────────────
# Если что-то слушает на 5432 ДО того как наша PG service запустилась, это
# либо чужой PostgreSQL (другая версия), либо посторонний процесс. В обоих
# случаях наш Start-Service не освободит порт, а psql connect упадёт с
# неинформативным "Check PostgreSQL password". Скажем сразу в чём дело.
$listen = @(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)
if ($listen.Count -gt 0) {
    $listenPid  = $listen[0].OwningProcess
    $listenProc = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
    $listenName = if ($listenProc) { $listenProc.ProcessName } else { 'unknown' }
    Log "Port 5432 in use by PID $listenPid ($listenName)"

    if ($listenName -notlike 'postgres*') {
        Log "ERROR: Порт 5432 занят процессом, который НЕ PostgreSQL: $listenName (PID $listenPid)."
        Log ""
        Log "  FeoSport2 не может настроить базу, пока порт занят чужим процессом."
        Log "  Варианты:"
        Log "    1. Остановить процесс: Task Manager -> Details -> найти PID $listenPid -> End task"
        Log "    2. Если это другой PostgreSQL — остановить службу:"
        Log "         Get-Service postgresql* | Stop-Service -Force"
        Log "    3. Перезапустить ярлык 'FeoSport2 -- настройка PostgreSQL'"
        exit 1
    }
    # postgres* — может быть наш или сосуществующий инстанс; проверка пароля
    # ниже даст понятный verdict.
}

# ── Запустить службу PostgreSQL ──────────────────────────────────────────────
$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc -and $svc.Status -ne "Running") {
    try {
        Start-Service $svc.Name -ErrorAction Stop
        Start-Sleep 4
        Log "PostgreSQL service started: $($svc.Name)"
    } catch {
        Log "ERROR: Не удалось запустить службу $($svc.Name): $($_.Exception.Message)"
        Log "  Возможно, не хватает прав — запустите 'FeoSport2 -- настройка PostgreSQL'"
        Log "  правым кликом -> 'Запуск от имени администратора'."
        exit 1
    }
}

if (-not $svc -and $listen.Count -eq 0) {
    Log "ERROR: Служба PostgreSQL не найдена И никто не слушает на 5432."
    Log "  Вероятно, bundled-инсталлятор PostgreSQL 16 не завершился при установке FeoSport2."
    Log "  Логи Inno Setup лежат в %TEMP%\Setup Log*.txt — посмотрите там."
    Log "  Либо переустановите FeoSport2 с включённым компонентом 'PostgreSQL 16'."
    exit 1
}

& $psql -U postgres -tAc "SELECT version();" 2>&1 | ForEach-Object { Log "postgres connection: $_" }
if ($LASTEXITCODE -ne 0) {
    Log "ERROR: Не удалось подключиться как postgres."
    if ($listen.Count -gt 0 -and $listenName -like 'postgres*') {
        Log "  На 5432 слушает postgres ($listenName, PID $listenPid), но пароль не подошёл."
        Log "  Возможно, это другой PostgreSQL с другим паролем. Введите правильный пароль"
        Log "  суперпользователя того PostgreSQL, либо остановите его и переустановите FeoSport2."
    } else {
        Log "  Проверьте пароль postgres."
    }
    exit 1
}

# Создать пользователя и БД
$dbPasswordSql = Escape-SqlLiteral $DbPassword
& $psql -U postgres -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='feosport') THEN CREATE USER feosport LOGIN; END IF; END `$`$;" 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERROR: could not create role feosport"; exit 1 }

& $psql -U postgres -c "ALTER ROLE feosport WITH LOGIN PASSWORD '$dbPasswordSql';" 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERROR: could not set password for role feosport"; exit 1 }
Log "Role feosport is ready"

$dbExists = & $psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='feosport2'" 2>&1
if ($dbExists.Trim() -ne "1") {
    & $psql -U postgres -c "CREATE DATABASE feosport2 OWNER feosport ENCODING 'UTF8';" 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Log "ERROR: could not create database feosport2"; exit 1 }
    Log "Database feosport2 created"

    & $psql -U postgres -d feosport2 -f $InitSql 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Log "ERROR: init.sql failed"; exit 1 }
    Log "init.sql applied"
} else {
    Log "Database feosport2 already exists — keeping schema"
}

& $psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE feosport2 TO feosport;" 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERROR: could not grant database privileges"; exit 1 }
# Гранты на таблицы и sequences (нужны после создания схемы через init.sql)
& $psql -U postgres -d feosport2 -c "GRANT USAGE, CREATE ON SCHEMA public TO feosport;" 2>&1 | ForEach-Object { Log $_ }
& $psql -U postgres -d feosport2 -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO feosport;" 2>&1 | ForEach-Object { Log $_ }
& $psql -U postgres -d feosport2 -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO feosport;" 2>&1 | ForEach-Object { Log $_ }
& $psql -U postgres -d feosport2 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO feosport;" 2>&1 | ForEach-Object { Log $_ }
& $psql -U postgres -d feosport2 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO feosport;" 2>&1 | ForEach-Object { Log $_ }
Log "Grants on tables and sequences applied to feosport"

& $psql -U postgres -d feosport2 -f $SeedUsersSql 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERROR: seed-users.sql failed"; exit 1 }
Log "seed-users.sql applied"

# Тестовые данные: пилоты + соревнования. Скрипт сам пропускает повторный запуск.
& $psql -U postgres -d feosport2 -f $SeedSql 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "ERROR: seed.sql failed"; exit 1 }
Log "seed.sql applied"

$env:PGPASSWORD = ""

$env:PGPASSWORD = $DbPassword
$appUser = & $psql -U feosport -d feosport2 -tAc "SELECT current_user;" 2>&1
if ($LASTEXITCODE -ne 0 -or $appUser.Trim() -ne "feosport") {
    Log "ERROR: app user connection check failed: $appUser"
    exit 1
}
Log "App DB connection check passed as feosport"

$userCount = & $psql -U feosport -d feosport2 -tAc "SELECT COUNT(*) FROM users WHERE email IN ('admin@feosport.local','chief@feosport.local','judge@feosport.local','pilot@feosport.local');" 2>&1
Log "Baseline users available: $($userCount.Trim())/4"
$env:PGPASSWORD = ""

# Папка для загружаемых документов (раздел 2.2.3 правил, локальное оффлайн-хранение).
# Фаза 3.5: Windows installer хранит upload-файлы в профиле пользователя,
# чтобы обновления приложения не трогали документы.
$DocumentsRoot = Join-Path $env:APPDATA "FeoSport2\uploads"
New-Item -ItemType Directory -Force -Path $DocumentsRoot | Out-Null
# Оставляем ACL best-effort: при %APPDATA% владелец обычно уже имеет запись,
# но явное правило помогает при установке/запуске из разных контекстов.
try {
    $acl = Get-Acl $DocumentsRoot
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "BUILTIN\Users",
        "Modify",
        "ContainerInherit,ObjectInherit",
        "None",
        "Allow")
    $acl.AddAccessRule($rule)
    Set-Acl -Path $DocumentsRoot -AclObject $acl
    Log "Uploads ACL: BUILTIN\Users granted Modify on $DocumentsRoot"
} catch {
    Log "WARN: could not adjust ACL on $DocumentsRoot — $($_.Exception.Message)"
}

# Записать .env рядом с exe
$envPath = Join-Path $InstallDir ".env"
@"
PORT=8090
DB_HOST=localhost
DB_PORT=$DbPort
DB_NAME=feosport2
DB_USER=feosport
DB_PASSWORD=$DbPassword
JWT_SECRET=$JwtSecret
DOCUMENT_ENCRYPTION_KEY=$DocumentEncryptionKey
DOCUMENT_ENCRYPTION_KEY_ID=local-v1
NODE_ENV=production
DOCUMENTS_ROOT=$DocumentsRoot
"@ | Set-Content -Encoding UTF8 $envPath
Log ".env written to $envPath"
Log ".env settings: PORT=8090 DB_HOST=localhost DB_PORT=$DbPort DB_NAME=feosport2 DB_USER=feosport NODE_ENV=production"
Log "Documents root: $DocumentsRoot"

# Открыть порт 8090 в firewall
$ruleName = "FeoSport2"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
        -Protocol TCP -LocalPort 8090 -Action Allow | Out-Null
    Log "Firewall rule created for TCP 8090"
}

Log "=== FeoSport2 DB Setup COMPLETE ==="
exit 0
} catch {
    Log "ERROR: $($_.Exception.Message)"
    Log "ERROR DETAIL: $($_ | Out-String)"
    exit 1
} finally {
    try { Stop-Transcript | Out-Null } catch {}
}
