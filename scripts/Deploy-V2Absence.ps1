# Owner-terminal orchestration. Default is read-only validation, never deployment.
[CmdletBinding()]
param([ValidateSet('Validate','Deploy')][string]$Mode='Validate', [string]$Approval='', [Parameter(Mandatory=$true)][string]$BackupPath, [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$BackupSha256)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='D:\ChildGuard-V2'
$backend=Join-Path $root 'backend'
$stage=Join-Path $root '.absence-migration-stage-912195b5-fcfd-4885-92ed-cfea0f9288b8'
$node='C:\Program Files\nodejs\node.exe'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$restore='C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
$backup=[IO.Path]::GetFullPath($BackupPath)
if(-not $backup.StartsWith((Join-Path $root 'private-backups\childguard-v2\'),[StringComparison]::OrdinalIgnoreCase)){throw 'V2 backup location required'}
if((Get-Location).Path -cne $root){throw 'Run from D:\ChildGuard-V2'}
if($Mode -eq 'Deploy' -and $Approval -cne 'DEPLOY ABSENCE'){throw 'Explicit DEPLOY ABSENCE approval required'}
$helper=Join-Path $root 'scripts\V2BaselineDeployment.psm1'
if((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash -cne '10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A'){throw 'Security helper drift'}
Import-Module $helper -Force
Assert-V2CleanEnvironment ([Environment]::GetEnvironmentVariables('Process'))
foreach($path in @($PSCommandPath,$helper,$stage,$backend,$node,$psql,$restore)){Assert-V2RegularPath $path}
Assert-V2RegularPath (Join-Path $root '.local-tools')
$pickupOsProfile=Join-Path $root ('.local-tools\absence-deploy-'+[Guid]::NewGuid().ToString())
[void](New-Item -ItemType Directory -Path $pickupOsProfile)
Assert-V2RegularPath $pickupOsProfile
$journal=Join-Path $pickupOsProfile 'status.txt'
function Record([string]$state){[IO.File]::AppendAllText($journal,([DateTime]::UtcNow.ToString('o')+' '+$state+[Environment]::NewLine))}
function OsEnvironment {
 return @{SystemRoot='C:\Windows';USERPROFILE=$pickupOsProfile;TEMP=$pickupOsProfile;TMP=$pickupOsProfile;APPDATA=$pickupOsProfile;LOCALAPPDATA=$pickupOsProfile;PATH='C:\Program Files\nodejs;C:\Windows\System32'}
}
function RunNode([string]$cwd,[string]$arguments,[hashtable]$environment){Invoke-V2PrivateNode $node $cwd $arguments $environment}
function RunNative([string]$exe,[string]$arguments,[hashtable]$environment,[string]$step){
 if($step -cnotmatch '^[A-Z_]+$'){throw 'Private step label required'}
 Record ($step+'_STARTED')
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$exe;$info.Arguments=$arguments;$info.WorkingDirectory=$root
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.EnvironmentVariables.Clear()
 foreach($name in $environment.Keys){$info.EnvironmentVariables[$name]=$environment[$name]}
 $process=New-Object Diagnostics.Process
 $process.StartInfo=$info
 try {
  try{[void]$process.Start()}catch{Record ($step+'_FAILED cause=PROCESS_START_FAILED');throw ('Private PostgreSQL step failed: '+$step+'; cause=PROCESS_START_FAILED. Private details withheld.')}
  $outTask=$process.StandardOutput.ReadToEndAsync();$errTask=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  [void]$outTask.GetAwaiter().GetResult();$privateError=$errTask.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){
   # Never print/store stderr: it can contain private connection metadata or echoed input.
   $cause='UNCLASSIFIED'
   $guards=@{'V2 owner target refused'='TARGET_GUARD';'Original locked migrator state refused'='LOCKED_ROLE_GUARD';'Unexpected ledger count'='LEDGER_COUNT';'Migration checksum/history mismatch'='LEDGER_CHECKSUM_OR_STATE';'Attendance enum mismatch'='ATTENDANCE_ENUM';'Enum ownership requires review'='ENUM_OWNER';'Migrator is not locked'='LOCKED_ROLE_GUARD';'Competing migrator connection'='COMPETING_MIGRATOR';'Runtime ledger access refused'='RUNTIME_LEDGER_PRIVILEGES';'Pickup storage missing'='PICKUP_TABLES'}
   foreach($message in $guards.Keys){if($privateError -match ('(?m)(?:ERROR|FATAL):\s+(?:P0001:\s+)?'+[regex]::Escape($message)+'\s*$')){$cause=$guards[$message];break}}
   if($cause -eq 'UNCLASSIFIED'){
    if($privateError -match 'password authentication failed|no password supplied|28P01'){$cause='AUTHENTICATION_FAILED'}
    elseif($privateError -match 'syntax error|42601'){$cause='SQL_SYNTAX_OR_INVOCATION'}
    elseif($privateError -match 'permission denied|42501'){$cause='SQL_PERMISSION_DENIED'}
    elseif($process.ExitCode -eq 2){$cause='CONNECTION_OR_AUTHENTICATION_FAILURE'}
   }
   Record ($step+'_FAILED exit='+$process.ExitCode+' cause='+$cause)
   throw ('Private PostgreSQL step failed: '+$step+'; exit='+$process.ExitCode+'; cause='+$cause+'. No private output was disclosed. Journal: '+$journal)
  }
  Record ($step+'_PASSED')
 }finally{$privateError=$null;$info.EnvironmentVariables.Clear();$process.Dispose()}
}
function SourceChecks {
 RunNode $root 'backend/scripts/verify-absence-client.mjs' (OsEnvironment)
 RunNode $root ('backend/scripts/prepare-absence-stage.mjs "'+$stage+'"') (OsEnvironment)
}
function Catalog([string]$phase){RunNative $psql ('-X -w -h 127.0.0.1 -p 5432 -U postgres -d childguard_v2 -v ON_ERROR_STOP=1 -f "'+$backend+'\prisma\review\absence\'+$phase+'.sql"') $ownerEnvironment ('CATALOG_'+$phase.ToUpperInvariant())}
function MigrationEnvironment([string]$url,[string]$action){
 $environment=New-V2ChildEnvironment $url $action
 foreach($entry in (OsEnvironment).GetEnumerator()){$environment[$entry.Key]=$entry.Value}
 return $environment
}
function RequireNoListener {
 $nodes=Get-CimInstance Win32_Process -Filter "Name='node.exe'"
 foreach($process in $nodes){
  if(-not $process.CommandLine){throw 'Node identity unavailable; owner process review required'}
  if($process.CommandLine -match '(?i)(prisma.*migrate|src[/\\]server\.js|node.+--watch|ChildGuard-V2[/\\]backend)'){throw 'Backend/watcher or competing migration remains; review its identity manually'}
 }

 $lines=& 'C:\Windows\System32\netstat.exe' -ano -p TCP
 if($LASTEXITCODE -ne 0){throw 'Listener inspection failed'}
 if($lines | Where-Object {$_ -match '^\s*TCP\s+\S+:3100\s+\S+\s+LISTENING\s+\d+\s*$'}){throw 'Backend listener remains; owner must stop only its confirmed backend before deployment'}
}
Record 'VALIDATION_STARTED; no deployment attempted'
SourceChecks
# Current locks/activity/state are checked read-only through normal application admission.
# Fresh catalog checks run below with the owner credential; the runtime role never reads migration history.
Assert-V2RegularPath $backup
if((Get-Item -LiteralPath $backup).LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-24)){throw 'A fresh owner-controlled backup is required'}
if((Get-Item -LiteralPath $backup).Length -le 0 -or (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -cne $BackupSha256.ToUpperInvariant()){throw 'Backup mismatch'}
RunNative $restore ('--list "'+$backup+'"') (OsEnvironment) 'BACKUP_LIST'
RunNative $restore ('--file=NUL "'+$backup+'"') (OsEnvironment) 'BACKUP_DECODE'
Record 'BACKUP_VALIDATION_PASSED'
# Validate also requires the owner-authenticated catalog check below.
# Ask for existing credentials privately; never change passwords, use argv URLs, or write credentials to disk.
$ownerSecret=Read-Host 'Existing postgres password (V2 owner operations only)' -AsSecureString
$migratorSecret=$null # Validate uses only the owner read-only connection.
$ownerPointer=[IntPtr]::Zero;$migratorPointer=[IntPtr]::Zero
$ownerEnvironment=$null;$privateEnvironment=$null;$roleAttempted=$false;$migrationSucceeded=$false
function OwnerSql([string]$sql,[string]$step){RunNative $psql ('-X -w -h 127.0.0.1 -p 5432 -U postgres -d childguard_v2 -v ON_ERROR_STOP=1 -c "'+$sql+'"') $ownerEnvironment $step}
$targetGuard="DO `$`$ BEGIN IF current_database()<>'childguard_v2' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port() IS DISTINCT FROM 5432 OR current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'V2 owner target refused'; END IF; END `$`$;"
$lockedGuard="DO `$`$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles r WHERE rolname='childguard_v2_migrator' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT has_schema_privilege(rolname,'public','CREATE') AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)) THEN RAISE EXCEPTION 'Original locked migrator state refused'; END IF; END `$`$;"
try {
 $ownerPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ownerSecret)
 $ownerEnvironment=OsEnvironment
 $ownerEnvironment.PGPASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ownerPointer)
 if(-not $ownerEnvironment.PGPASSWORD){throw 'Missing owner credential'}
 OwnerSql ('BEGIN READ ONLY; '+$targetGuard+$lockedGuard+' ROLLBACK;') 'OWNER_TARGET_AND_LOCK'
 Catalog 'before'
 if($Mode -eq 'Validate'){Record 'VALIDATION_PASSED';Write-Host 'Read-only absence validation passed; no deployment.';return}
 # Only the already approved Deploy path needs a migrator credential.
 $migratorSecret=Read-Host 'Existing childguard_v2_migrator password' -AsSecureString
 $migratorPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($migratorSecret)
 $encoded=[Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($migratorPointer))
 if(-not $encoded){throw 'Missing migrator credential'}
 $url='postgresql://childguard_v2_migrator:'+$encoded+'@127.0.0.1:5432/childguard_v2?schema=public'
 SourceChecks
 RequireNoListener
 $roleAttempted=$true
 Record 'TEMPORARY_ROLE_ENABLE_ATTEMPT'
 OwnerSql ('BEGIN; '+$targetGuard+$lockedGuard+' ALTER ROLE childguard_v2_migrator LOGIN; COMMIT;') 'MIGRATOR_ENABLE'
 Record 'BEFORE_PASSED'
 SourceChecks
 $privateEnvironment=MigrationEnvironment $url Deploy
 Record 'MIGRATION_ATTEMPT; never retry automatically'
 try {RunNode $stage ('"'+$backend+'\node_modules\prisma\build\index.js" migrate deploy --schema prisma/schema.prisma') $privateEnvironment}finally{$privateEnvironment.Clear()}
 $migrationSucceeded=$true
 Record 'MIGRATION_FINISHED; cleanup then owner read-only postflight required'
}catch{Record 'STOPPED; inspect live ledger/catalog; no automatic retry/recovery';throw}
finally {
 try {
  if($roleAttempted){
   OwnerSql ('BEGIN; '+$targetGuard+' REVOKE CREATE ON SCHEMA public FROM childguard_v2_migrator; ALTER ROLE childguard_v2_migrator NOLOGIN; '+$lockedGuard+' COMMIT;') 'MIGRATOR_CLEANUP'
   Record 'MIGRATOR_LOCKED_AND_VERIFIED'
   if($migrationSucceeded){Catalog 'after'}
  }
 }finally {
  if($ownerEnvironment){$ownerEnvironment.Clear()};if($privateEnvironment){$privateEnvironment.Clear()}
  if($ownerPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ownerPointer)}
  if($migratorPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($migratorPointer)}
  $url=$null;$encoded=$null;$ownerSecret=$null;$migratorSecret=$null
 }
}
Write-Host ('Absence migration checks passed; migrator locked. Evidence: '+$journal)
Write-Host 'STOP: reviewed full-client activation and integrity verification must precede npm.cmd start.'
