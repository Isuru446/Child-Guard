[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param(
 [Parameter(Mandatory=$true)][ValidateSet('PARENT','TEACHER')][string]$Role,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._@+-]{3,100}$')][string]$Username,
 [Parameter(Mandatory=$true)][Guid]$CenterId,
 [Guid[]]$ChildIds = @()
)
throw 'WP00-B BLOCKED: legacy account provisioning is not approved for V2. See V2_Planning/WP00B_DATABASE_GUARD_IMPLEMENTATION.md.'
$ErrorActionPreference='Stop'
$Role=$Role.ToUpperInvariant()
if ($CenterId -eq [Guid]::Empty) { throw 'Provide the approved nonempty center identifier.' }
if ($ChildIds.Count -gt 100 -or @($ChildIds | Select-Object -Unique).Count -ne $ChildIds.Count -or $ChildIds -contains [Guid]::Empty) { throw 'ChildIds must contain at most 100 unique nonempty approved child identifiers.' }
if ($Role -eq 'PARENT' -and $ChildIds.Count -eq 0) { throw 'Provide approved existing ChildIds for a legitimate Parent.' }
if ($Role -eq 'TEACHER' -and $ChildIds.Count -ne 0) { throw 'Teachers use the authenticated Admin center; do not supply Guardian links.' }
if (!$PSCmdlet.ShouldProcess("approved ChildGuard center $CenterId","Provision the approved $Role account and approved Guardian links")) { return }
$adminName=Read-Host 'Existing authorized Admin username'
$adminSecret=Read-Host 'Existing Admin password (hidden)' -AsSecureString
$newSecret=Read-Host 'Approved new account initial password (hidden; 12+ characters, at most 72 UTF-8 bytes)' -AsSecureString
$confirmation=Read-Host 'Repeat new account password (hidden)' -AsSecureString
$adminPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
$newPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($newSecret)
$confirmPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
$headers=$null; $login=$null; $body=$null; $newValue=$null
try {
 $newValue=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($newPtr)
 if ($newValue -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPtr)) { throw 'Initial passwords do not match.' }
 if ($newValue.Length -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($newValue) -gt 72) { throw 'Initial password must be 12+ characters and at most 72 UTF-8 bytes.' }
 $body=@{username=$adminName;password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr)} | ConvertTo-Json -Compress
 try { $login=Invoke-RestMethod 'http://localhost:3000/api/v1/auth/login' -Method Post -ContentType 'application/json' -Body $body }
 catch { throw 'Admin authentication failed. No account request was made.' }
 if ($login.data.user.role -ne 'ADMIN') { throw 'Existing ADMIN authority is required.' }
 if ($login.data.user.centerId -ne $CenterId.ToString()) { throw 'Authenticated Admin does not belong to the approved target center. No account request was made.' }
 $headers=@{Authorization="Bearer $($login.data.token)"}
 $body=@{username=$Username;password=$newValue;role=$Role;childIds=@($ChildIds | ForEach-Object { $_.ToString() })} | ConvertTo-Json -Compress
 try { $result=Invoke-RestMethod 'http://localhost:3000/api/v1/admin/users' -Method Post -Headers $headers -ContentType 'application/json' -Body $body }
 catch { throw 'Provisioning failed. Review the HTTP status locally without displaying the request body. A timeout may require checking the account list before retrying.' }
 Write-Host "Provisioning returned success for role $($result.data.role). No password or token is displayed."
} finally {
 $headers=$null; $login=$null; $body=$null; $newValue=$null; $result=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr)
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($newPtr)
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPtr)
 $adminSecret.Dispose();$newSecret.Dispose();$confirmation.Dispose()
}
