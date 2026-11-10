[CmdletBinding()]
param([string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',[switch]$Quick)
throw 'WP00-B BLOCKED: both legacy verification branches target V1. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($Quick) {
 & node (Join-Path $root 'backend\scripts\check-supervisor-database.js')
 if ($LASTEXITCODE -ne 0) { throw 'Read-only database preflight failed; no write performed.' }
 return
}
$config = Join-Path $root 'backend\.env.windows'
if (!(Test-Path -LiteralPath $config)) { $config = Join-Path $root 'backend\.env' }
$connection = $null
foreach ($line in [IO.File]::ReadAllLines($config)) {
 if ($line -match '^DATABASE_URL=(.*)$') { $connection = $Matches[1].Trim().Trim('"').Trim("'") }
}
$uri = $null
if (![Uri]::TryCreate($connection,[UriKind]::Absolute,[ref]$uri)) { throw 'Invalid local DATABASE_URL (value withheld).' }
if ($uri.Scheme -notin @('postgresql','postgres') -or $uri.Host -ne '127.0.0.1' -or $uri.Port -ne 5432 -or $uri.AbsolutePath -ne '/childguard') {
 throw 'Expected PostgreSQL 18 application target 127.0.0.1:5432/childguard. No query executed.'
}
$credentials = $uri.UserInfo -split ':',2
if ($credentials.Count -ne 2 -or $credentials[0] -ne 'childguard_app') { throw 'Expected local childguard_app credentials.' }
$psql = Join-Path $PgBin 'psql.exe'
$oldPassword = $env:PGPASSWORD
$oldOptions = $env:PGOPTIONS
try {
 $env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
 $env:PGOPTIONS = '-c default_transaction_read_only=on'
 $serverVersion = "SELECT current_setting('server_version_num');" | & $psql -X -w -h 127.0.0.1 -p 5432 -U childguard_app -d childguard -v ON_ERROR_STOP=1 -A -t
 if ($LASTEXITCODE -ne 0) { throw 'Cannot authenticate to the expected local database.' }
 if ([int]$serverVersion -lt 180000 -or [int]$serverVersion -ge 190000) { throw 'Expected PostgreSQL 18. No automatic server switch is permitted.' }
 & $psql -X -w -h 127.0.0.1 -p 5432 -U childguard_app -d childguard -f (Join-Path $root 'scripts\verify-database.sql')
 if ($LASTEXITCODE -ne 0) { throw 'Read-only database verification failed.' }
 $ledger = 'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name;' | & $psql -X -w -h 127.0.0.1 -p 5432 -U childguard_app -d childguard -v ON_ERROR_STOP=1 -A -t
 if ($LASTEXITCODE -ne 0) { throw 'Cannot read migration checksums.' }
 $files = @(Get-ChildItem -LiteralPath (Join-Path $root 'backend\prisma\migrations') -Directory)
 if (@($ledger).Count -ne $files.Count) { throw 'Migration file/ledger counts differ. Do not migrate automatically.' }
 foreach ($row in $ledger) {
  $parts = $row -split '\|',2
  if ($parts[0] -notmatch '^\d+_[a-z0-9_]+$') { throw 'Unexpected migration name.' }
  $file = Join-Path $root "backend\prisma\migrations\$($parts[0])\migration.sql"
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $parts[1]) { throw "Migration checksum mismatch: $($parts[0])" }
 }
 Write-Host 'PASS: all local migration file checksums match the restored ledger. No database writes performed.'
} finally {
 $env:PGPASSWORD = $oldPassword
 $env:PGOPTIONS = $oldOptions
 $connection = $null; $credentials = $null
}
