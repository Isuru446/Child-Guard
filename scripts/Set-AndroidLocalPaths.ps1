[CmdletBinding()]
param(
 [string]$FlutterSdk = 'C:\develop\flutter',
 [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk"
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath (Join-Path $FlutterSdk 'bin\flutter.bat'))) { throw 'Flutter SDK is missing.' }
if (!(Test-Path -LiteralPath (Join-Path $AndroidSdk 'platform-tools\adb.exe'))) { throw 'Android platform-tools are missing. Finish Android Studio SDK setup first.' }
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'App\android\local.properties'
$backup = "$target.transferred.private.backup"
if ((Test-Path -LiteralPath $target) -and !(Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $target -Destination $backup }
$flutterValue = $FlutterSdk.Replace('\','/')
$androidValue = $AndroidSdk.Replace('\','/')
$kept = @()
if (Test-Path -LiteralPath $target) { $kept = [IO.File]::ReadAllLines($target) | Where-Object { $_ -notmatch '^(sdk.dir|flutter.sdk)=' } }
[IO.File]::WriteAllLines($target, @($kept) + @("sdk.dir=$androidValue", "flutter.sdk=$flutterValue"), (New-Object Text.UTF8Encoding($false)))
Write-Host 'Updated local Android SDK paths. Transferred configuration was preserved privately.'
