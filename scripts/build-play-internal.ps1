param(
    [switch]$BumpVersion
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:JAVA_HOME) {
    if (Test-Path "C:\Android\jdk-17") { $env:JAVA_HOME = "C:\Android\jdk-17" }
}

$gradle = Join-Path $root "app\build.gradle.kts"
$text = Get-Content $gradle -Raw
if ($BumpVersion) {
    if ($text -notmatch 'versionCode\s*=\s*(\d+)') { throw "Could not find versionCode" }
    $current = [int]$Matches[1]
    $next = $current + 1
    $text = $text -replace "versionCode = $current", "versionCode = $next"
    if ($text -match 'versionName = "([^"]+)"') {
        $name = $Matches[1]
        if ($name -match '^(\d+)\.(\d+)\.(\d+)') {
            $newName = "$($Matches[1]).$($Matches[2]).$([int]$Matches[3] + 1)"
            $text = $text -replace "versionName = `"$name`"", "versionName = `"$newName`""
        }
    }
    Set-Content -Path $gradle -Value ($text.TrimEnd() + "`n") -Encoding UTF8
    Write-Host "Bumped to versionCode $next"
}

& (Join-Path $root "gradlew.bat") :app:bundleRelease --stacktrace
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$aab = Join-Path $root "app\build\outputs\bundle\release\app-release.aab"
Write-Host ""
Write-Host "Play Internal bundle:"
Write-Host $aab
Write-Host "Upload this file in Play Console → Testing → Internal testing → Create new release"
