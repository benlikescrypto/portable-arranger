param(
    [switch]$BumpVersion
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:JAVA_HOME) {
    if (Test-Path "C:\Android\jdk-17") { $env:JAVA_HOME = "C:\Android\jdk-17" }
}

$cred = Join-Path $root "play-service-account.json"
if (-not (Test-Path $cred)) {
    Write-Host @"
Missing play-service-account.json

One-time Play Console setup:
  1. Create the ArrangerBox app and finish Internal testing once in the website
     (Play must see the app before the API can upload).
  2. Play Console → Setup → API access → link a Google Cloud project
  3. Google Cloud → IAM → Service accounts → Create
     name: arrangerbox-play
  4. Keys → Add key → JSON → save as:
     $cred
  5. Play Console → Users and permissions → Invite users
     invite the service account email (…@….iam.gserviceaccount.com)
     permission: Release apps to testing tracks (at least)

Then run this script again.
"@
    exit 1
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

Write-Host "Building and uploading ArrangerBox to Play Internal testing..."
& (Join-Path $root "gradlew.bat") :app:publishReleaseBundle --stacktrace
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Uploaded. Testers get the update from Play."
