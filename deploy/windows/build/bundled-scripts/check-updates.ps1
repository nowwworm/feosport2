param(
    [string]$Repository = $env:FEOSPORT2_GITHUB_REPO,
    [string]$InstallDir = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$AssetName = "FeoSport2-Setup.exe"
)

$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[FeoSport2 updates] $Message"
}

if ([string]::IsNullOrWhiteSpace($Repository)) {
    Write-Info "GitHub repository is not configured."
    Write-Info "Set FEOSPORT2_GITHUB_REPO=owner/repo or run:"
    Write-Info "powershell -ExecutionPolicy Bypass -File check-updates.ps1 -Repository owner/repo"
    exit 2
}

$versionFile = Join-Path $InstallDir "support\version.txt"
$currentVersion = if (Test-Path $versionFile) {
    (Get-Content $versionFile -Raw).Trim()
} else {
    "unknown"
}

$apiUrl = "https://api.github.com/repos/$Repository/releases/latest"
Write-Info "Current version: $currentVersion"
Write-Info "Checking $apiUrl"

$headers = @{ "User-Agent" = "FeoSport2-updater" }
$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 20
$latestVersion = ($release.tag_name -as [string]).TrimStart("v")
Write-Info "Latest version: $($release.tag_name)"

if ($currentVersion -ne "unknown" -and $latestVersion -eq $currentVersion) {
    Write-Info "You already have the latest version."
    exit 0
}

$asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $asset) {
    Write-Info "Release does not contain $AssetName."
    Write-Info "Open release page manually: $($release.html_url)"
    exit 3
}

$downloadRoot = Join-Path $InstallDir "support\updates"
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
$target = Join-Path $downloadRoot $asset.name

Write-Info "Downloading $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -Headers $headers -UseBasicParsing

Write-Info "Downloaded: $target"
Write-Info "The installer was not started automatically. Run it manually when ready."
Start-Process explorer.exe -ArgumentList "/select,`"$target`"" -ErrorAction SilentlyContinue
