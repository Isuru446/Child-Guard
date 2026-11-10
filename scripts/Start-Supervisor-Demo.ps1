[CmdletBinding()]
param([ValidateRange(3001,3999)][int]$Port=3001,[ValidateRange(5174,5999)][int]$ReactPort=5174)
throw 'WP00-B BLOCKED: legacy synthetic demo writes/startup are not approved for V2. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
try { $listener.Start() } catch { throw 'Requested isolated demo port is in use. No database writes attempted.' } finally { $listener.Stop() }
$names=@('DATABASE_URL','TEST_DATABASE_URL','JWT_SECRET','PORT','HOST','ENABLE_REGISTRATION','PUBLIC_REGISTRATION_CENTER_IDS','PRIVATE_MEDIA_DIR','CORS_ORIGINS','CHILDGUARD_DEMO_ADMIN_PASSWORD')
$saved=@{}
foreach ($name in $names) { $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
$secret=Read-Host 'Dedicated childguard_test PostgreSQL URL (hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$password=$null
$passwordPtr=[IntPtr]::Zero
try {
 $env:TEST_DATABASE_URL=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 $env:DATABASE_URL=$env:TEST_DATABASE_URL
 Push-Location -LiteralPath (Join-Path $root 'backend')
 try {
  & node scripts/check-test-database.js
  if ($LASTEXITCODE -notin @(0,2)) { throw 'Isolated database identity check failed. No writes permitted.' }
  $approval=Read-Host 'Inspect childguard_test first. Type CREATE-SYNTHETIC-DEMO to add a new isolated center, Admin, simulated Child, wearable, pending attendance and alert. No existing records are changed'
  if ($approval -cne 'CREATE-SYNTHETIC-DEMO') { throw 'Demo setup cancelled before writes.' }
  $password=Read-Host 'New isolated demo Admin password (12+ characters, maximum 72 UTF-8 bytes; hidden)' -AsSecureString
  $passwordPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $env:CHILDGUARD_DEMO_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  $output=@(& node scripts/prepare-supervisor-demo.js)
  if ($LASTEXITCODE -ne 0) { throw 'Isolated demo preparation failed. No backend started.' }
  $demo=($output | Select-Object -Last 1) | ConvertFrom-Json
  $env:CHILDGUARD_DEMO_ADMIN_PASSWORD=$null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  $passwordPtr=[IntPtr]::Zero
  $password.Dispose()
  $password=$null
  if ($demo.database -ne 'childguard_test') { throw 'Unexpected demo target. Backend not started.' }
  Write-Host "ISOLATED SYNTHETIC DEMO ONLY: $($demo.centerName)"
  Write-Host "Admin username: $($demo.username)"
  Write-Host "Existing synthetic child reference: $($demo.childId)"
  Write-Host "Unassigned synthetic wearable: $($demo.hardwareId)"
  Write-Host 'Password is the value you entered privately; it is not printed or stored in a source file.'
  Write-Host "Isolated backend port: $Port. React origin: http://localhost:$ReactPort. Point Flutter API_BASE_URL at this isolated backend port."
  $random=[byte[]]::new(48)
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($random) } finally { $rng.Dispose() }
  $env:JWT_SECRET=[Convert]::ToBase64String($random)
  $env:PORT=[string]$Port;$env:HOST='127.0.0.1'
  $env:ENABLE_REGISTRATION='true'
  $env:PUBLIC_REGISTRATION_CENTER_IDS=$demo.centerId
  $env:PRIVATE_MEDIA_DIR=Join-Path $root 'backend\.supervisor-demo-media'
  $env:CORS_ORIGINS="http://localhost:$ReactPort"
  & npm.cmd start
  if ($LASTEXITCODE -ne 0) { throw 'Isolated demo backend exited unsuccessfully.' }
 } finally { Pop-Location }
} finally {
 foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $secret.Dispose()
 if ($passwordPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
 if ($password) { $password.Dispose() }
}
