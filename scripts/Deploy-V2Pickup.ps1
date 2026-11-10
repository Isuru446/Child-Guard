# Owner-terminal orchestration. Default is read-only validation, never deployment.
[CmdletBinding()]
param([ValidateSet('Validate','Deploy')][string]$Mode='Validate', [string]$Approval='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='D:\ChildGuard-V2'
$backend=Join-Path $root 'backend'
$stage=Join-Path $root '.pickup-migration-stage-4955326a-a758-4732-adf1-210044257511'
$node='C:\Program Files\nodejs\node.exe'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$restore='C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
$backup=Join-Path $root 'private-backups\childguard-v2\before-pickup-20261026-115119-0eeebd8cd60a40cab3c534ff156b5ccb.dump'
if((Get-Location).Path -cne $root){throw 'Run from D:\ChildGuard-V2'}
if($Mode -eq 'Deploy' -and $Approval -cne 'DEPLOY PICKUP'){throw 'Explicit DEPLOY PICKUP approval required'}
$helper=Join-Path $root 'scripts\V2BaselineDeployment.psm1'
if((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash -cne '10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A'){throw 'Security helper drift'}
Import-Module $helper -Force
Assert-V2CleanEnvironment ([Environment]::GetEnvironmentVariables('Process'))
foreach($path in @($PSCommandPath,$helper,$stage,$backend,$node,$psql,$restore)){Assert-V2RegularPath $path}
Assert-V2RegularPath (Join-Path $root '.local-tools')
$pickupOsProfile=Join-Path $root ('.local-tools\pickup-deploy-'+[Guid]::NewGuid().ToString())
[void](New-Item -ItemType Directory -Path $pickupOsProfile)
Assert-V2RegularPath $pickupOsProfile
$journal=Join-Path $pickupOsProfile 'status.txt'
function Record([string]$state){[IO.File]::AppendAllText($journal,([DateTime]::UtcNow.ToString('o')+' '+$state+[Environment]::NewLine))}
function OsEnvironment {
 return @{SystemRoot='C:\Windows';USERPROFILE=$pickupOsProfile;TEMP=$pickupOsProfile;TMP=$pickupOsProfile;APPDATA=$pickupOsProfile;LOCALAPPDATA=$pickupOsProfile;PATH='C:\Program Files\nodejs;C:\Windows\System32'}
}
function RunNode([string]$cwd,[string]$arguments,[hashtable]$environment){Invoke-V2PrivateNode $node $cwd $arguments $environment}
function RunNative([string]$exe,[string]$arguments,[hashtable]$environment){
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$exe;$info.Arguments=$arguments;$info.WorkingDirectory=$root
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.EnvironmentVariables.Clear()
 foreach($name in $environment.Keys){$info.EnvironmentVariables[$name]=$environment[$name]}
 $process=New-Object Diagnostics.Process
 $process.StartInfo=$info
 try {
  [void]$process.Start()
  $outTask=$process.StandardOutput.ReadToEndAsync();$errTask=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  [void]$outTask.GetAwaiter().GetResult();[void]$errTask.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){throw 'Private PostgreSQL step failed; inspect owner terminal metadata before continuing'}
 }finally{$info.EnvironmentVariables.Clear();$process.Dispose()}
}
function SourceChecks {
 RunNode $root 'backend/scripts/verify-v2-pickup-client.js' (OsEnvironment)
 RunNode $root ('backend/scripts/prepare-v2-pickup-stage.js "'+$stage+'" backend/prisma/review/pickup/owner-ledger-20261026.json') (OsEnvironment)
}
function MigrationEnvironment([string]$url,[string]$action){
 $environment=New-V2ChildEnvironment $url $action
 foreach($entry in (OsEnvironment).GetEnumerator()){$environment[$entry.Key]=$entry.Value}
 return $environment
}
function RequireNoListener {
 $lines=& 'C:\Windows\System32\netstat.exe' -ano -p TCP
 if($LASTEXITCODE -ne 0){throw 'Listener inspection failed'}
 if($lines | Where-Object {$_ -match '^\s*TCP\s+\S+:3100\s+\S+\s+LISTENING\s+\d+\s*$'}){throw 'Backend listener remains; owner must stop only its confirmed backend before deployment'}
}
Record 'VALIDATION_STARTED; no deployment attempted'
SourceChecks
# Current locks/activity/state are checked read-only through normal application admission.
RunNode $backend 'scripts/verify-v2-pickup-runtime-preflight.js' (OsEnvironment)
Assert-V2RegularPath $backup
if((Get-Item -LiteralPath $backup).Length -ne 156042 -or (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -cne '3FBF2F33BDD108189C0B913762F0B58B68D36C91E6CFC348319D8237D3615C9B'){throw 'Backup mismatch'}
RunNative $restore ('--list "'+$backup+'"') (OsEnvironment)
RunNative $restore ('--file=NUL "'+$backup+'"') (OsEnvironment)
Record 'READ_ONLY_VALIDATION_PASSED'
if($Mode -eq 'Validate'){Write-Host 'Owner-terminal validation passed. No migration, role/client change or restart performed.';return}
RequireNoListener
# Ask for existing credentials privately; never change passwords, use argv URLs, or write credentials to disk.
$ownerSecret=Read-Host 'Existing postgres password (V2 owner operations only)' -AsSecureString
$migratorSecret=Read-Host 'Existing childguard_v2_migrator password' -AsSecureString
$ownerPointer=[IntPtr]::Zero;$migratorPointer=[IntPtr]::Zero
$ownerEnvironment=$null;$privateEnvironment=$null;$roleAttempted=$false
function OwnerSql([string]$sql){RunNative $psql ('-X -w -h 127.0.0.1 -p 5432 -U postgres -d childguard_v2 -v ON_ERROR_STOP=1 -c "'+$sql+'"') $ownerEnvironment}
$targetGuard="DO `$`$ BEGIN IF current_database()<>'childguard_v2' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port() IS DISTINCT FROM 5432 OR current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'V2 owner target refused'; END IF; END `$`$;"
$lockedGuard="DO `$`$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles r WHERE rolname='childguard_v2_migrator' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT has_schema_privilege(rolname,'public','CREATE') AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)) THEN RAISE EXCEPTION 'Original locked migrator state refused'; END IF; END `$`$;"
try {
 $ownerPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ownerSecret)
 $migratorPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($migratorSecret)
 $ownerEnvironment=OsEnvironment
 $ownerEnvironment.PGPASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ownerPointer)
 $encoded=[Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($migratorPointer))
 if(-not $encoded -or -not $ownerEnvironment.PGPASSWORD){throw 'Missing credential'}
 $url='postgresql://childguard_v2_migrator:'+$encoded+'@127.0.0.1:5432/childguard_v2?schema=public'
 OwnerSql ('BEGIN READ ONLY; '+$targetGuard+$lockedGuard+' ROLLBACK;')
 SourceChecks
 RequireNoListener
 $roleAttempted=$true
 Record 'TEMPORARY_ROLE_ENABLE_ATTEMPT'
 OwnerSql ('BEGIN; '+$targetGuard+$lockedGuard+' ALTER ROLE childguard_v2_migrator LOGIN; GRANT CREATE ON SCHEMA public TO childguard_v2_migrator; COMMIT;')
 $privateEnvironment=MigrationEnvironment $url Preflight
 try {RunNode $root ('backend/scripts/verify-v2-pickup-migration.js before "'+$stage+'"') $privateEnvironment}finally{$privateEnvironment.Clear()}
 Record 'BEFORE_PASSED'
 SourceChecks
 $privateEnvironment=MigrationEnvironment $url Deploy
 Record 'MIGRATION_ATTEMPT; never retry automatically'
 try {RunNode $stage ('"'+$backend+'\node_modules\prisma\build\index.js" migrate deploy --schema prisma/schema.prisma') $privateEnvironment}finally{$privateEnvironment.Clear()}
 $privateEnvironment=MigrationEnvironment $url Verify
 try {RunNode $root ('backend/scripts/verify-v2-pickup-migration.js after "'+$stage+'"') $privateEnvironment}finally{$privateEnvironment.Clear()}
 Record 'AFTER_PASSED; client not activated; backend not restarted'
}catch{Record 'STOPPED; inspect live ledger/catalog; no automatic retry/recovery';throw}
finally {
 try {
  if($roleAttempted){
   OwnerSql ('BEGIN; '+$targetGuard+' REVOKE CREATE ON SCHEMA public FROM childguard_v2_migrator; ALTER ROLE childguard_v2_migrator NOLOGIN; '+$lockedGuard+' COMMIT;')
   Record 'MIGRATOR_LOCKED_AND_VERIFIED'
  }
 }finally {
  if($ownerEnvironment){$ownerEnvironment.Clear()};if($privateEnvironment){$privateEnvironment.Clear()}
  if($ownerPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ownerPointer)}
  if($migratorPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($migratorPointer)}
  $url=$null;$encoded=$null;$ownerSecret=$null;$migratorSecret=$null
 }
}
Write-Host ('Pickup migration checks passed; migrator locked. Evidence: '+$journal)
Write-Host 'STOP: reviewed full-client activation and integrity verification must precede npm.cmd start.'
