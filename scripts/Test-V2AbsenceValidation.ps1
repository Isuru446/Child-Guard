# Isolated regression tests: extracts function definitions only. Never runs the deployment script,
# PostgreSQL, migrations, backup utilities, or any database operation.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='D:\ChildGuard-V2'
$path=Join-Path $root 'scripts\Deploy-V2Absence.ps1'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Runner parse failed'}
function Assert([bool]$value,[string]$message){if(-not $value){throw $message}}
function Definition([string]$name){return $ast.Find({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq $name},$true).Extent.Text}
foreach($name in @('Record','RunNative','Catalog','OwnerSql')){. ([scriptblock]::Create((Definition $name)))}
$testDir=Join-Path $root ('.local-tools\absence-validation-tests-'+[Guid]::NewGuid().ToString())
[void](New-Item -ItemType Directory -Path $testDir)
$journal=Join-Path $testDir 'status.txt'
$fixture=Join-Path $testDir 'child.ps1'
$fixtureText=@'
param([string]$Case)
if($Case -eq 'environment'){
 if($env:PGPASSWORD -cne 'synthetic quote" space $ dollar ; ampersand&'){exit 90}
 if($env:ABSENCE_TEST_PARENT_SECRET){exit 91}
 exit 0
}
[Console]::Out.WriteLine('synthetic-private-output-never-disclose')
switch($Case){
 'guard' {[Console]::Error.WriteLine('ERROR: Migration checksum/history mismatch');[Console]::Error.WriteLine('CONTEXT: synthetic-private-output-never-disclose');exit 3}
 'authentication' {[Console]::Error.WriteLine('FATAL: password authentication failed for user synthetic-private-output-never-disclose');exit 2}
 'syntax' {[Console]::Error.WriteLine('ERROR: syntax error at or near synthetic-private-output-never-disclose');[Console]::Error.WriteLine('LINE 1: SQL containing V2 owner target refused');exit 3}
 'permission' {[Console]::Error.WriteLine('ERROR: permission denied for table synthetic-private-output-never-disclose');exit 3}
 default {[Console]::Error.WriteLine('synthetic-private-output-never-disclose');exit 2}
}
'@
[IO.File]::WriteAllText($fixture,$fixtureText)
$exe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$environment=@{SystemRoot=$env:SystemRoot;PGPASSWORD='synthetic quote" space $ dollar ; ampersand&'}
$priorParent=[Environment]::GetEnvironmentVariable('ABSENCE_TEST_PARENT_SECRET','Process')
try{
 [Environment]::SetEnvironmentVariable('ABSENCE_TEST_PARENT_SECRET','synthetic-parent-only','Process')
 RunNative $exe ('-NoProfile -NonInteractive -File "'+$fixture+'" environment') $environment 'ENVIRONMENT_TEST'
 $cases=@{guard='LEDGER_CHECKSUM_OR_STATE';authentication='AUTHENTICATION_FAILED';syntax='SQL_SYNTAX_OR_INVOCATION';permission='SQL_PERMISSION_DENIED';other='CONNECTION_OR_AUTHENTICATION_FAILURE'}
 foreach($case in $cases.Keys){
  $message=''
  try{RunNative $exe ('-NoProfile -NonInteractive -File "'+$fixture+'" '+$case) $environment 'CATALOG_BEFORE'}catch{$message=$_.Exception.Message}
  Assert ($message.Contains('CATALOG_BEFORE') -and $message.Contains('cause='+$cases[$case])) ('Wrong safe diagnostic for '+$case)
  Assert (-not $message.Contains('synthetic-private-output') -and -not $message.Contains($environment.PGPASSWORD)) 'Private child output leaked'
 }
 $log=[IO.File]::ReadAllText($journal)
 Assert (-not $log.Contains('synthetic-private-output') -and -not $log.Contains($environment.PGPASSWORD)) 'Journal leaked private output'
 Assert ($log.Contains('ENVIRONMENT_TEST_PASSED')) 'Private environment test failed'
 # Source/flow guard: migrator credential acquisition must follow Validate's unconditional return.
 $source=[IO.File]::ReadAllText($path)
 $returnAt=$source.IndexOf("if(`$Mode -eq 'Validate'){Record 'VALIDATION_PASSED'")
 $promptAt=$source.IndexOf("`$migratorSecret=Read-Host")
 Assert ($returnAt -gt 0 -and $promptAt -gt $returnAt) 'Validate must not request a migrator password'
 Assert ($source.Substring($returnAt,$promptAt-$returnAt).Contains(';return}')) 'Validate return must precede migrator credential handling'
 # Spy on SQL command construction; no executable is launched below.
 function RunNative([string]$exe,[string]$arguments,[hashtable]$environment,[string]$step){$script:captured=@($exe,$arguments,$environment,$step)}
 $psql='synthetic-never-executed';$backend=Join-Path $root 'backend';$ownerEnvironment=@{PGPASSWORD='synthetic-owner-only'}
 Catalog 'before'
 Assert ($script:captured[1].Contains('-U postgres -d childguard_v2') -and $script:captured[1].Contains('absence\before.sql') -and $script:captured[3] -ceq 'CATALOG_BEFORE') 'Catalog must use owner read-only SQL'
 $sql='BEGIN READ ONLY; DO $$ BEGIN PERFORM 1; END $$; ROLLBACK;'
 OwnerSql $sql 'OWNER_TARGET_AND_LOCK'
 Assert ($script:captured[1].Contains('-c "'+$sql+'"') -and $script:captured[1].Contains('-U postgres')) 'SQL/dollar quoting changed'
 Assert ($script:captured[2].PGPASSWORD -ceq 'synthetic-owner-only') 'Owner credential forwarding changed'
 $before=[IO.File]::ReadAllText((Join-Path $backend 'prisma\review\absence\before.sql'))
 Assert ($before.Contains('BEGIN READ ONLY;') -and $before.TrimEnd().EndsWith('ROLLBACK;')) 'Catalog must remain read-only'
 foreach($guard in @('Migration checksum/history mismatch','Migrator is not locked','Competing migrator connection','Runtime ledger access refused','Enum ownership requires review')){Assert ($before.Contains($guard)) ('Guard removed: '+$guard)}
 Write-Host 'PASS: 10 isolated validation checks (environment, five safe failure categories, credential ordering, owner catalog, SQL forwarding, read-only guards). No PostgreSQL process or deployment was executed.'
}finally{
 [Environment]::SetEnvironmentVariable('ABSENCE_TEST_PARENT_SECRET',$priorParent,'Process')
 $environment.Clear();$ownerEnvironment=$null
}
