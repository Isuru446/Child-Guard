[CmdletBinding()]
param([string]$BackendUrl='http://localhost:3000',[string]$ReactUrl='http://localhost:5173')
throw 'WP00-B BLOCKED: legacy API/database checks target V1. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script:failures=0
$script:warnings=0
function Result([string]$State,[string]$Message) {
 Write-Host "$State : $Message"
 if ($State -eq 'FAIL') { $script:failures++ }
 if ($State -eq 'WARNING') { $script:warnings++ }
}
foreach ($tool in @('node','npm.cmd','flutter')) {
 if (Get-Command $tool -ErrorAction SilentlyContinue) { Result PASS "$tool command found" }
 else { Result FAIL "$tool command missing" }
}
try {
 $services=@(Get-Service -Name '*postgresql*' -ErrorAction Stop)
 if (@($services | Where-Object Status -eq 'Running').Count) { Result PASS 'A PostgreSQL service is running; server identity checked separately below' }
 else { Result FAIL 'No running PostgreSQL service found' }
} catch { Result WARNING 'Windows service enumeration unavailable' }
try {
 $health=Invoke-RestMethod "$BackendUrl/api/health" -TimeoutSec 10
 if ($health.data.status -ne 'ok') { throw 'Unexpected health' }
 Result PASS 'Backend health: PostgreSQL-backed SELECT succeeds'
} catch { Result FAIL 'Backend health unavailable or unexpected response' }
try {
 $react=Invoke-WebRequest -UseBasicParsing $ReactUrl -TimeoutSec 10
 if ($react.StatusCode -ne 200) { throw 'Unexpected HTTP' }
 Result PASS 'React responds HTTP 200 (not proof of authenticated page behavior)'
} catch { Result FAIL 'React unavailable' }
try {
 $availability=Invoke-RestMethod "$BackendUrl/api/v1/registration/availability" -TimeoutSec 10
 if ($availability.data.enabled -isnot [bool]) { throw 'Unexpected availability' }
 Result PASS 'Registration availability endpoint responds correctly'
 if (!$availability.data.enabled) { Result WARNING 'Registration disabled: signup demo is unavailable' }
 else {
  $centers=Invoke-RestMethod "$BackendUrl/api/v1/registration/centers" -TimeoutSec 10
  if ($null -eq $centers.data -or $centers.data -isnot [System.Array]) { throw 'Unexpected center list' }
  foreach ($center in $centers.data) {
   if (!$center.id -or !$center.name -or @($center.PSObject.Properties.Name | Where-Object { $_ -notin @('id','name') }).Count) { throw 'Unexpected center data' }
  }
  if (@($centers.data).Count) { Result PASS 'Running backend currently lists eligible public centers and returns only ID/name' }
  else { Result WARNING 'Running backend currently lists no eligible public center: review its approved PUBLIC_REGISTRATION_CENTER_IDS configuration' }
 }
} catch { Result FAIL 'Registration availability/center API failed or returned unexpected fields' }
try {
 $database=@(& (Join-Path $PSScriptRoot 'Verify-Database.ps1') -Quick)
 $details=($database | Select-Object -Last 1) | ConvertFrom-Json
 if ($details.database -ne 'childguard' -or !$details.migrationsMatch -or $details.postgresMajor -ne 18) { throw 'Wrong target or migration status' }
 Result PASS "Configured target childguard on PostgreSQL 18; $($details.migrations) migration checksums match"
 if (!$details.testDatabaseExists) { Result WARNING 'childguard_test does not exist; write demonstrations are blocked' }
 if ($details.existingPublicCenters) {
  Result PASS "Checker effective configuration ($($details.configFile) plus inherited environment) allowlists $($details.existingPublicCenters) existing center(s)"
 } else {
  Result WARNING "Checker effective configuration ($($details.configFile) plus inherited environment) has no existing allowlisted center; this does not describe the running backend's public list. A startup-terminal-only PUBLIC_REGISTRATION_CENTER_IDS value may be absent here"
 }
} catch { Result FAIL 'Configured original database connectivity/Prisma migration verification failed; no writes attempted' }
Result WARNING 'Configured database verification cannot prove which environment an already running backend process loaded; start it through the documented helper'
Result WARNING 'Authenticated UI acceptance, Flutter tests/APK, private test credentials and physical hardware require separate checks'
Write-Host "Summary: $script:failures failed checks; $script:warnings warnings. No records, settings or services changed."
if ($script:failures) { exit 1 }
