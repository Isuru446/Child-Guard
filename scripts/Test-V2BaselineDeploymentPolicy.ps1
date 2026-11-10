#Requires -Version 5.1
# Pure policy/AST regression tests. NEVER invoke the deployment runner.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module 'D:\ChildGuard-V2\scripts\V2BaselineDeployment.psm1' -Force -DisableNameChecking
$script:checks = 0
function Check([bool]$Condition, [string]$Name) {
  if ($Name -cnotmatch '^[A-Z][A-Z0-9_]+$') { throw 'Policy regression failed: INVALID_ASSERTION_NAME' }
  if (-not $Condition) { throw ('Policy regression failed: ' + $Name) }
  $script:checks++
}
function Must-Refuse([scriptblock]$Action, [string]$Name, [string]$ExpectedError = '') {
  $refused = $false
  $actualError = $null
  try { & $Action | Out-Null } catch { $refused = $true; $actualError = $_.Exception.Message }
  Check $refused $Name
  if ($ExpectedError) { Check ($actualError -ceq $ExpectedError) ($Name + '_EXPECTED_REFUSAL') }
}
# Failures identify only a bounded assertion name, never the tested input/error.
try { Check $false 'SYNTHETIC_NAMED_ASSERTION'; throw 'Expected assertion failure' }
catch { Check ($_.Exception.Message -ceq 'Policy regression failed: SYNTHETIC_NAMED_ASSERTION') 'NAMED_ASSERTION_ERROR_IS_REDACTED' }
$phrase = 'DEPLOY CHILDGUARD V2 DEVELOPMENT BASELINE'
$caseIndex = 0
foreach ($case in @(@($false,$true,$phrase),@($true,$false,$phrase),@($true,$true,'yes'),@($true,$true,''))) {
  Must-Refuse { Assert-V2Consent $case[0] $case[1] $case[2] } ('REJECT_INVALID_CONSENT_' + (++$caseIndex))
}
Assert-V2Consent $true $true $phrase
Check $true 'ACCEPT_EXPLICIT_INTERACTIVE_CONSENT'
$caseIndex = 0
foreach ($root in @('D:\Pro','D:\ChildGuard-V2-other','D:\ChildGuard-V2\..\ChildGuard-V2')) {
  Must-Refuse { Assert-V2Workspace $root 'D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1' $root } ('REJECT_WRONG_ROOT_' + (++$caseIndex))
}
Must-Refuse { Assert-V2Workspace 'D:\ChildGuard-V2' 'D:\Pro\scripts\Deploy-V2DevelopmentBaseline.ps1' 'D:\ChildGuard-V2' } 'REJECT_WRONG_SCRIPT_PATH'
Must-Refuse { Assert-V2Workspace 'D:\ChildGuard-V2' 'D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1' 'D:\ChildGuard-V2\backend' } 'REJECT_WRONG_WORKING_DIRECTORY'

$approved = Get-ApprovedBaselineHashes
$files = @($approved.Keys)
$dirs = @('prisma','prisma\migrations') + @($files | Where-Object { $_ -like '*\migration.sql' } | ForEach-Object { Split-Path $_ -Parent })
Assert-V2BaselineInventory $files $dirs $approved $false
Check $true 'ACCEPT_APPROVED_SOURCE_INVENTORY'
Must-Refuse { Assert-V2BaselineInventory $files[1..8] $dirs $approved $false } 'REJECT_MISSING_BASELINE_FILE'
Must-Refuse { Assert-V2BaselineInventory ($files + 'prisma\.env') $dirs $approved $false } 'REJECT_EXTRA_ENV_FILE'
Must-Refuse { Assert-V2BaselineInventory ($files + 'prisma\migrations\extra\migration.sql') ($dirs + 'prisma\migrations\extra') $approved $false } 'REJECT_EXTRA_MIGRATION'
Must-Refuse { Assert-V2BaselineInventory $files $dirs[1..8] $approved $false } 'REJECT_MISSING_MIGRATION_DIRECTORY'
Must-Refuse { Assert-V2BaselineInventory $files ($dirs + 'prisma\migrations\extra') $approved $false } 'REJECT_EXTRA_MIGRATION_DIRECTORY'
$badHashes = @{}; foreach ($key in $approved.Keys) { $badHashes[$key] = $approved[$key] }
$badHashes[$files[0]] = '0' * 64
Must-Refuse { Assert-V2BaselineInventory $files $dirs $badHashes $false } 'REJECT_BASELINE_HASH_MISMATCH'
Assert-V2BaselineInventory ($files + 'package.json') $dirs $approved $true
Check $true 'ACCEPT_APPROVED_STAGED_INVENTORY'
Must-Refuse { Assert-V2BaselineInventory ($files + 'package.json' + '.env') $dirs $approved $true } 'REJECT_EXTRA_STAGED_ENV_FILE'
# Read-only tree comparison; no stage creation, no runtime .env read.
Assert-V2BaselineTree 'D:\ChildGuard-V2\backend' $false
Check $true 'ACCEPT_APPROVED_SOURCE_TREE'

foreach ($name in @('PGHOST','PGDATABASE','DOTENV_CONFIG_PATH','DOTENV_KEY','PRISMA_CONFIG',
  'PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK','DATABASE_URL','TEST_DATABASE_URL','MIGRATION_DATABASE_URL',
  'DIRECT_URL','SHADOW_DATABASE_URL','NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NPM_CONFIG_NODE_OPTIONS','DEBUG','CI')) {
  $environment = @{}; $environment[$name] = 'synthetic-not-a-secret'
  Must-Refuse { Assert-V2CleanEnvironment $environment } ('REJECT_INHERITED_' + $name)
}
Assert-V2CleanEnvironment @{NODE_ENV='development';PATH='ordinary-path'}
Must-Refuse { Assert-V2CleanEnvironment @{NODE_ENV='test'} } 'REJECT_TEST_NODE_ENV'
Check $true 'ACCEPT_CLEAN_DEVELOPMENT_ENVIRONMENT'

$url = 'postgresql://childguard_v2_migrator:synthetic%40password@127.0.0.1:5432/childguard_v2?schema=public'
foreach ($action in @('Preflight','Deploy','Verify')) {
  $child = New-V2ChildEnvironment $url $action
  $assertionPrefix = 'CHILD_' + $action.ToUpperInvariant() + '_'
  Check ($child.Count -eq 4) ($assertionPrefix + 'EXACT_ENVIRONMENT_COUNT')
  Check ($child.NODE_ENV -ceq 'development') ($assertionPrefix + 'DEVELOPMENT_MODE')
  Check (-not $child.ContainsKey('PATH')) ($assertionPrefix + 'NO_INHERITED_PATH')
  if ($action -eq 'Deploy') { Check ($child.DATABASE_URL -ceq $url) ($assertionPrefix + 'EXPLICIT_DATASOURCE'); Check (-not $child.ContainsKey('MIGRATION_DATABASE_URL')) ($assertionPrefix + 'NO_PREFLIGHT_CREDENTIAL') }
  else { Check ($child.MIGRATION_DATABASE_URL -ceq $url) ($assertionPrefix + 'EXPLICIT_DATASOURCE'); Check (-not $child.ContainsKey('DATABASE_URL')) ($assertionPrefix + 'NO_CLI_CREDENTIAL') }
  $child.Clear()
}
$badUrls = @($url.Replace('childguard_v2_migrator','postgres'), $url.Replace('/childguard_v2?','/childguard_v2_test?'),
    $url.Replace('127.0.0.1','localhost'), $url.Replace(':5432',':5433'), ($url + '&host=elsewhere'),
    $url.Replace('synthetic%40password','%0A'), $url.Replace('synthetic%40password','%ZZ'))
$badUrlNames = @('WRONG_ROLE','WRONG_DATABASE','WRONG_HOST','WRONG_PORT','EXTRA_URL_PARAMETER','CONTROL_PASSWORD','INVALID_PASSWORD_ESCAPE')
Check ($badUrls.Count -eq 7) 'INVALID_DATASOURCE_FIXTURE_COUNT'
Check ($badUrls[4] -ceq ($url + '&host=elsewhere')) 'EXTRA_URL_PARAMETER_FIXTURE_IS_COMPLETE'
for ($caseIndex = 0; $caseIndex -lt $badUrls.Count; $caseIndex++) {
  $badUrl = $badUrls[$caseIndex]
  Check ($badUrl -cne $url) ('INVALID_FIXTURE_DIFFERS_FROM_VALID_' + $badUrlNames[$caseIndex])
  Must-Refuse { New-V2ChildEnvironment $badUrl Deploy } ('REJECT_' + $badUrlNames[$caseIndex]) 'Migration datasource refused'
}
Assert-V2ChildExit 0
foreach ($status in @(1,2,-1,137)) {
  try { Assert-V2ChildExit $status; throw 'Expected rejection' }
  catch { Check ($_.Exception.Message -ceq 'Child step failed; details withheld') ('REDACT_CHILD_EXIT_' + ([string]$status).Replace('-','NEGATIVE_')) }
}

# Injected synthetic actions test stage/preflight/deploy/verify ordering and aborts.
for ($failure = 0; $failure -le 4; $failure++) {
  $events = New-Object 'System.Collections.Generic.List[string]'
  $steps = @()
  for ($index = 1; $index -le 4; $index++) {
    $capturedIndex = $index; $capturedFailure = $failure; $capturedEvents = $events
    $steps += { $capturedEvents.Add([string]$capturedIndex); if ($capturedIndex -eq $capturedFailure) { throw 'Synthetic step failed' } }.GetNewClosure()
  }
  if ($failure -eq 0) { Invoke-V2BaselineSequence $steps[0] $steps[1] $steps[2] $steps[3]; Check (($events -join ',') -ceq '1,2,3,4') 'SEQUENCE_SUCCESS_ORDER' }
  else { Must-Refuse { Invoke-V2BaselineSequence $steps[0] $steps[1] $steps[2] $steps[3] } ('SEQUENCE_PROPAGATES_FAILURE_' + $failure); Check ($events.Count -eq $failure) ('SEQUENCE_STOPS_AT_FAILURE_' + $failure) }
}

# Simulated reparse point: block before resolution or recursive enumeration.
$policy = Get-Module V2BaselineDeployment
& $policy { function script:Get-Item { [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint;Parent=$null} } }
try { Must-Refuse { Assert-V2RegularPath 'D:\ChildGuard-V2\synthetic-link' } 'REJECT_REPARSE_POINT' }
finally { & $policy { Remove-Item function:Get-Item } }

# Parse the runner and inspect its AST; do not dot-source or invoke it.
$runnerPath = 'D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1'
$tokens=$null; $errors=$null
$ast = [Management.Automation.Language.Parser]::ParseFile($runnerPath,[ref]$tokens,[ref]$errors)
Check ($errors.Count -eq 0) 'RUNNER_AST_PARSE'
$text = [IO.File]::ReadAllText($runnerPath)
$tryStatement = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] } | Select-Object -First 1
Check ($tryStatement.Body.Statements[0] -is [Management.Automation.Language.IfStatementAst]) 'RUNNER_FIRST_STATEMENT_IS_GUARD'
$gate = $tryStatement.Body.Statements[0].Extent.Text
foreach ($required in @('ConfirmDevelopmentBaselineDeployment','UserInteractive','IsInputRedirected','IsOutputRedirected','ConsoleHost','NonI')) { Check ($gate.Contains($required)) ('RUNNER_GUARD_' + $required.ToUpperInvariant()) }
Check ($text.IndexOf('Assert-V2Consent') -lt $text.IndexOf('$stage = New-V2BaselineStage')) 'CONSENT_BEFORE_STAGING'
Check ($text.IndexOf('Assert-V2Consent') -lt $text.IndexOf('-AsSecureString')) 'CONSENT_BEFORE_CREDENTIAL_PROMPT'
Check ($text.Contains('verify-v2-migration-target.js" development')) 'RUNNER_REQUIRES_REAL_DEVELOPMENT_PREFLIGHT'
Check ($text.Contains('migrate deploy --schema prisma/schema.prisma')) 'RUNNER_HAS_ONLY_APPROVED_DEPLOY_COMMAND'
Check ($text.Contains('verify-v2-baseline-deployed.js')) 'RUNNER_REQUIRES_INDEPENDENT_VERIFIER'
Check ($text -notmatch '\bmigrate (reset|dev|resolve)\b|\bdb (push|seed)\b|npm run|Start-Transcript') 'RUNNER_NO_UNAPPROVED_COMMANDS'
Check ($text -notmatch '\$env:|SetEnvironmentVariable|\.env[''"]') 'RUNNER_NO_PARENT_OR_FILE_CREDENTIALS'
Check ($text -notmatch '\$_|Write-Error|Out-File') 'RUNNER_NO_RAW_ERROR_LOGGING'
Check ($text.Contains('-AsSecureString') -and $text.Contains('ZeroFreeBSTR')) 'RUNNER_PRIVATE_PROMPT_AND_CLEANUP'
Check (@($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'RecoveryApprovalRecord' }).Count -eq 1) 'RUNNER_HAS_RECOVERY_APPROVAL_RECORD_PARAMETER'
$approvalCheck = $text.IndexOf('$approvalFingerprint = Invoke-V2RecoveryEvidenceCheck')
Check ($approvalCheck -gt 0 -and $approvalCheck -lt $text.IndexOf('Import-Module')) 'RECOVERY_APPROVAL_BEFORE_POLICY_IMPORT'
Check ($approvalCheck -lt $text.IndexOf('$stage = New-V2BaselineStage')) 'RECOVERY_APPROVAL_BEFORE_STAGING'
Check ($approvalCheck -lt $text.IndexOf('-AsSecureString')) 'RECOVERY_APPROVAL_BEFORE_CREDENTIAL_PROMPT'
$deployText = $text.Substring($text.IndexOf('} -Deploy {'), $text.IndexOf('} -Verify {') - $text.IndexOf('} -Deploy {'))
Check ($deployText.IndexOf('Invoke-V2RecoveryEvidenceCheck') -lt $deployText.IndexOf('migrate deploy --schema')) 'RECHECK_RECOVERY_APPROVAL_BEFORE_WRITING'
Check ($deployText.Contains('recheckedApproval -cne $approvalFingerprint')) 'RECHECK_BINDS_SAME_SIGNED_RECORD'
Check ($deployText.Contains('Assert-V2BaselineTree $stage $true')) 'RECHECK_STAGED_SOURCE_BEFORE_WRITING'
$caseIndex = 0
foreach ($key in $approved.Keys) { Check ($text.Contains("'$key' = '$($approved[$key])'")) ('RUNNER_IMMUTABLE_HASH_' + (++$caseIndex)) }

$moduleText = [IO.File]::ReadAllText('D:\ChildGuard-V2\scripts\V2BaselineDeployment.psm1')
Check ($moduleText.Contains('EnvironmentVariables.Clear()')) 'CLEAR_INHERITED_CHILD_ENVIRONMENT'
Check ($moduleText.Contains('RedirectStandardError = $true')) 'REDIRECT_CHILD_ERRORS'
Check ($moduleText.Contains('[void]$stdout.GetAwaiter().GetResult()')) 'DISCARD_RAW_CHILD_STDOUT'
Check ($moduleText.Contains('[void]$stderr.GetAwaiter().GetResult()')) 'DISCARD_RAW_CHILD_STDERR'
Check ($moduleText -notmatch 'ReadAllText\([^\r\n]*\.env|Get-Content[^\r\n]*\.env') 'NO_PRIVATE_ENV_FILE_READ'
Write-Output ('PASS: ' + $script:checks + ' PowerShell policy/AST assertions; runner never executed; no child process or database connection')
