[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$taskTemp = Join-Path $root '.validation\tmp'
[void][IO.Directory]::CreateDirectory($taskTemp)
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$failed = $false
try {
    Push-Location (Join-Path $root 'backend')
    try {
        & node node_modules/vitest/vitest.mjs run --config vitest.isolated.config.js
        if ($LASTEXITCODE -ne 0) { $failed = $true }
    } finally { Pop-Location }
    Push-Location (Join-Path $root 'web_front')
    try {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { $failed = $true }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { $failed = $true }
    } finally { Pop-Location }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
if ($failed) { throw 'One or more isolated checks failed. See docs/VALIDATION.md for known failures.' }
