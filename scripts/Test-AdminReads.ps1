[CmdletBinding()]
param()
throw 'WP00-B BLOCKED: legacy HTTP checks can access the V1 API. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$username = Read-Host 'Existing ChildGuard Admin username'
$password = Read-Host 'Existing Admin password (hidden)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$headers = $null
$login = $null
$body = $null
try {
 $body = @{ username=$username; password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } | ConvertTo-Json -Compress
 try { $login = Invoke-RestMethod "$base/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body $body }
 catch { throw 'Admin login failed. Verify the local backend and existing credentials privately; no credentials changed.' }
 $body = $null
 if ($login.data.user.role -ne 'ADMIN') { throw 'An existing ADMIN account is required for this read-only acceptance check.' }
 $headers = @{ Authorization="Bearer $($login.data.token)" }
 Write-Host 'PASS: existing ADMIN authenticated. Token and profile withheld.'
 $paths = @('/api/v1/auth/me','/api/v1/admin/users','/api/v1/devices','/api/v1/attendance','/api/v1/beacons','/api/v1/alerts','/api/v1/activity/settings','/api/v1/activity/children','/api/v1/mobile/profile','/api/v1/mobile/children')
 foreach ($path in $paths) {
  try { $result = Invoke-RestMethod ($base+$path) -Headers $headers }
  catch { throw "Authenticated GET failed: $path (response withheld)." }
  $count = if ($null -eq $result.data) { 0 } else { @($result.data).Count }
  [pscustomobject]@{ Method='GET'; Route=$path; Result='PASS'; Items=$count }
  if ($path -eq '/api/v1/mobile/children' -and @($result.data).Count -gt 0) {
   $id = [string]$result.data[0].id
   $parsedId = [Guid]::Empty
   if (![Guid]::TryParse($id,[ref]$parsedId)) { throw 'Unexpected child identifier returned by server.' }
   foreach ($suffix in @('','/attendance','/alerts','/device','/activity')) {
    try { $detail = Invoke-RestMethod "$base/api/v1/mobile/children/$id$suffix" -Headers $headers }
    catch { throw "Authorized child GET failed for suffix '$suffix' (private details withheld)." }
    $count = if ($null -eq $detail.data) { 0 } else { @($detail.data).Count }
    [pscustomobject]@{ Method='GET'; Route="/api/v1/mobile/children/:id$suffix"; Result='PASS'; Items=$count }
   }
  }
 }
 Write-Host 'Read-only API acceptance completed. No confirmation, reset, setup, or provisioning request sent.'
} finally {
 $headers=$null; $login=$null; $body=$null; $result=$null; $detail=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $password.Dispose()
}
