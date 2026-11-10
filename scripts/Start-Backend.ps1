[CmdletBinding()]
param([ValidateSet('start','validate','generate','status')][string]$Action = 'start')
throw 'WP00-B BLOCKED: legacy environment loader is not approved for V2. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$config = Join-Path $backend '.env.windows'
if (!(Test-Path -LiteralPath $config)) { $config = Join-Path $backend '.env' }
if (!(Test-Path -LiteralPath $config)) { throw 'Configure backend/.env locally. Do not restore the existing database again.' }
$saved = @{}
try {
 foreach ($line in [IO.File]::ReadAllLines($config)) {
  if ($line -match '^([A-Z_]+)=(.*)$') {
   $name = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
   if ($name -notin @('DATABASE_URL','JWT_SECRET','HOST','PORT','CORS_ORIGINS','NODE_ENV','ENABLE_DEV_ATTENDANCE_RESET','ENABLE_REGISTRATION','PUBLIC_REGISTRATION_CENTER_IDS','PRIVATE_MEDIA_DIR')) { throw 'Unexpected environment key.' }
   $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
   [Environment]::SetEnvironmentVariable($name,$value,'Process')
  }
 }
 Push-Location -LiteralPath $backend
 try {
  switch ($Action) {
   'start' { & npm.cmd run dev }
   'validate' { & npx.cmd --no-install prisma validate }
   'generate' { & npx.cmd --no-install prisma generate }
   'status' { & npx.cmd --no-install prisma migrate status }
  }
  if ($LASTEXITCODE -ne 0) { throw "Backend command failed: $Action" }
 } finally { Pop-Location }
} finally {
 foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
