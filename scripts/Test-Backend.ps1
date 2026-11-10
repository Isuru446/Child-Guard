[CmdletBinding()]
param([switch]$GenerateClient,[string]$ResultPath)
throw 'WP00-B BLOCKED: legacy migration/test runner is not approved for V2. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$secret=Read-Host 'Dedicated childguard_test PostgreSQL connection URL (hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$oldDb=$env:DATABASE_URL
$oldTest=$env:TEST_DATABASE_URL
try {
 $url=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 $uri=$null
 if (![Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri)) { throw 'Invalid private test database URL. Re-enter it locally; no value is displayed.' }
 if ($uri.Scheme -notin @('postgresql','postgres') -or $uri.AbsolutePath -ne '/childguard_test') { throw 'Only a separately provisioned childguard_test URL is accepted.' }
 $env:TEST_DATABASE_URL=$url
 $env:DATABASE_URL=$url
 Push-Location -LiteralPath (Join-Path $root 'backend')
 try {
  & node scripts/check-test-database.js
  $preflight=$LASTEXITCODE
  if ($preflight -eq 2) {
   $approval=Read-Host 'Existing tables detected. Inspect this database independently first. Type TEST-ONLY only if all records are disposable synthetic test fixtures'
   if ($approval -cne 'TEST-ONLY') { throw 'Existing database not approved for fixture writes. No migration or test executed.' }
  } elseif ($preflight -ne 0) { throw 'Independent database identity check failed. No writes permitted.' }
  if ($GenerateClient) {
   Write-Host 'Generating Prisma Client. If the Windows engine is locked, stop only your ChildGuard backend in its own terminal, then retry.'
   & npx.cmd --no-install prisma generate
   if ($LASTEXITCODE -ne 0) { throw 'Prisma Client generation failed. No migration or tests executed.' }
  }
  & npx.cmd --no-install prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Isolated test migration failed.' }
  if ($ResultPath) {
   $resolvedResult=[IO.Path]::GetFullPath($ResultPath)
   if (!$resolvedResult.StartsWith(([IO.Path]::GetFullPath($root)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) { throw 'Test result file must remain inside the project.' }
   & npm.cmd test -- --reporter=default --reporter=json "--outputFile=$resolvedResult"
  } else { & npm.cmd test }
  if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
 } finally { Pop-Location }
} finally {
 $env:DATABASE_URL=$oldDb
 $env:TEST_DATABASE_URL=$oldTest
 $url=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $secret.Dispose()
}
