param(
    [string]$InstallDir = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$bundleRoot = Join-Path $env:TEMP "FeoSport2-logbundle-$stamp"
$zipPath = Join-Path $desktop "FeoSport2-logs-$stamp.zip"

New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null

function Write-Info {
    param([string]$Message)
    Write-Host "[FeoSport2 logs] $Message"
}

function Copy-ItemSafe {
    param(
        [string]$Path,
        [string]$Destination
    )
    if (Test-Path $Path) {
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        Copy-Item -Path $Path -Destination $Destination -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-CommandOutput {
    param(
        [string]$FileName,
        [scriptblock]$Command
    )
    $path = Join-Path $bundleRoot $FileName
    try {
        & $Command | Out-File -FilePath $path -Encoding UTF8 -Width 240
    } catch {
        "ERROR: $($_.Exception.Message)" | Out-File -FilePath $path -Encoding UTF8
    }
}

Write-Info "Collecting from $InstallDir"

Copy-ItemSafe -Path (Join-Path $InstallDir "logs") -Destination (Join-Path $bundleRoot "app")
Copy-ItemSafe -Path (Join-Path $InstallDir "install.log") -Destination (Join-Path $bundleRoot "legacy")
Copy-ItemSafe -Path (Join-Path $InstallDir "database") -Destination (Join-Path $bundleRoot "database")

$envFile = Join-Path $InstallDir ".env"
if (Test-Path $envFile) {
    $sanitizedEnv = Join-Path $bundleRoot "env.sanitized.txt"
    Get-Content $envFile |
        ForEach-Object { $_ -replace "^(DB_PASSWORD|JWT_SECRET)=.*$", '$1=<redacted>' } |
        Set-Content -Path $sanitizedEnv -Encoding UTF8
}

$setupLogDir = Join-Path $bundleRoot "inno-setup"
New-Item -ItemType Directory -Force -Path $setupLogDir | Out-Null
Get-ChildItem -Path $env:TEMP -Filter "Setup Log*.txt" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 20 |
    ForEach-Object { Copy-Item $_.FullName -Destination $setupLogDir -Force -ErrorAction SilentlyContinue }

Write-CommandOutput "diagnostics.txt" {
    "Timestamp: $(Get-Date -Format o)"
    "InstallDir: $InstallDir"
    "User: $env:USERNAME"
    "Computer: $env:COMPUTERNAME"
    "OS:"
    Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture
    ""
    "FeoSport2 files:"
    Get-ChildItem -Path $InstallDir -Force -ErrorAction SilentlyContinue | Select-Object Mode, Length, LastWriteTime, Name
    ""
    "PostgreSQL services:"
    Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
    ""
    "FeoSport2/PostgreSQL processes:"
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match "feosport|postgres|node" } |
        Select-Object ProcessName, Id, CPU, StartTime, Path
}

Write-CommandOutput "ports.txt" {
    "Listening/active ports 8090 and 5432:"
    netstat -ano | Select-String ":8090|:5432"
}

$since = (Get-Date).AddHours(-6)
Write-CommandOutput "eventlog-application.txt" {
    Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = $since } -MaxEvents 300 |
        Format-List TimeCreated, ProviderName, Id, LevelDisplayName, Message
}
Write-CommandOutput "eventlog-system.txt" {
    Get-WinEvent -FilterHashtable @{ LogName = "System"; StartTime = $since } -MaxEvents 300 |
        Format-List TimeCreated, ProviderName, Id, LevelDisplayName, Message
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Path $bundleRoot "*") -DestinationPath $zipPath -Force

Write-Info "Done: $zipPath"
Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`"" -ErrorAction SilentlyContinue
