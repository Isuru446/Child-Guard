[CmdletBinding()]
param(
  [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [int]$Port = 5433,
  [string]$AdminUser = 'postgres',
  [switch]$AllowPostgres18
)
throw 'WP00-B BLOCKED: original-target restore must never run from V2. Disposable restoration requires separate redesign and approval.'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $root 'childguard_backup.dump'
$psql = Join-Path $PgBin 'psql.exe'
$restore = Join-Path $PgBin 'pg_restore.exe'
if (!(Test-Path -LiteralPath $psql) -or !(Test-Path -LiteralPath $restore)) { throw 'Install PostgreSQL 16 or specify PgBin explicitly.' }
if (!(Test-Path -LiteralPath $archive)) { throw 'Original archive is missing.' }
$originalHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
& $restore --list $archive | Select-Object -First 14
if ($LASTEXITCODE -ne 0) { throw 'Archive validation failed.' }
$adminSecret = Read-Host 'Local PostgreSQL administrator password (never sent to chat)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  function Query([string]$database, [string]$sql) {
    $result = & $psql -X -w -h localhost -p $Port -U $AdminUser -d $database -v ON_ERROR_STOP=1 -Atc $sql
    if ($LASTEXITCODE -ne 0) { throw 'Database check failed; no restoration attempted.' }
    return $result
  }
  $version = [int](Query 'postgres' 'SHOW server_version_num')
  if (($version -lt 160000 -or $version -ge 170000) -and !($AllowPostgres18 -and $version -ge 180000 -and $version -lt 190000)) {
    throw 'Expected PostgreSQL 16. Existing PostgreSQL 18 requires explicit -AllowPostgres18.'
  }
  $exists = Query 'postgres' "SELECT count(*) FROM pg_database WHERE datname='childguard'"
  $role = Query 'postgres' "SELECT count(*) FROM pg_roles WHERE rolname='childguard_app'"
  if ([int]$exists -ne 0) {
    # Reject even an apparently empty existing installation: preserve it for review.
    $objects = Query 'childguard' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'"
    throw "Existing childguard database detected ($objects catalog relations). Preserved; review its ownership, contents and emptiness before any restore."
  }
  if ([int]$role -ne 0) { throw 'Existing childguard_app role detected. Preserve and review privileges before using it.' }
  Query 'postgres' 'CREATE ROLE childguard_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION' | Out-Null
  Write-Host 'Set a new application-role password using the hidden PostgreSQL prompt.'
  & $psql -X -w -h localhost -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c '\password childguard_app'
  if ($LASTEXITCODE -ne 0) { throw 'Password setup failed. New role is preserved; do not rerun blindly.' }
  Query 'postgres' 'CREATE DATABASE childguard OWNER childguard_app TEMPLATE template0' | Out-Null
  $objects = Query 'childguard' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'"
  if ([int]$objects -ne 0) { throw 'New target is unexpectedly nonempty. Preserved without restoration.' }
  & $restore -w -h localhost -p $Port -U $AdminUser -d childguard --role=childguard_app --no-owner --no-privileges --exit-on-error --single-transaction $archive
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed and its transaction rolled back. Database/role remain; review before retrying.' }
  & $psql -X -w -h localhost -p $Port -U $AdminUser -d childguard -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'verify-database.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Restore completed but verification failed. Preserve database and investigate.' }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $originalHash) { throw 'Archive hash changed unexpectedly.' }
  Write-Host 'Restore and verification completed. Compare counts and migration names with the archive/report before starting services.'
} finally {
  $env:PGPASSWORD = $previousPassword
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $adminSecret.Dispose()
}
