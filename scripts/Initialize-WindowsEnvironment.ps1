[CmdletBinding()]
param([int]$Port = 5432)
throw 'WP00-B BLOCKED: legacy configuration generator targets V1. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'backend\.env.windows'
if (Test-Path -LiteralPath (Join-Path $root 'backend\.env')) { throw 'Existing backend/.env preserved. Review it locally instead of replacing its credentials.' }
if (Test-Path -LiteralPath $target) { throw '.env.windows already exists. Preserved; edit locally if needed.' }
$password = Read-Host 'Password for local childguard_app role' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $escaped = [Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
  $jwt = $null
  $oldEnv = Join-Path $root 'backend\.env'
  if (Test-Path -LiteralPath $oldEnv) {
    foreach ($line in [IO.File]::ReadAllLines($oldEnv)) {
      if ($line -match '^JWT_SECRET=(.+)$') { $jwt = $Matches[1].Trim().Trim('"').Trim("'") }
    }
  }
  if (!$jwt -or $jwt.Length -lt 32 -or $jwt.StartsWith('REPLACE_')) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $jwt = [Convert]::ToBase64String($bytes)
  }
  $lines = @("DATABASE_URL=postgresql://childguard_app:${escaped}@127.0.0.1:${Port}/childguard?schema=public", "JWT_SECRET=$jwt", 'HOST=0.0.0.0', 'PORT=3000', 'CORS_ORIGINS=http://localhost:5173', 'NODE_ENV=development', 'ENABLE_DEV_ATTENDANCE_RESET=false')
  [IO.File]::WriteAllLines($target, $lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Created ignored .env.windows. Original .env preserved. No credentials printed.'
} finally {
  $escaped = $null; $jwt = $null; $lines = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $password.Dispose()
}
