#Requires -Version 5.1
[CmdletBinding()]
param([switch]$ConfirmDevelopmentBaselineDeployment, [string]$RecoveryApprovalRecord = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stage = $null; $journal = $null; $secret = $null; $pointer = [IntPtr]::Zero
$url = $null; $encoded = $null; $privateEnvironment = $null
try {
  # First executable guard, before imports, prompts, staging or child processes.
  if (-not $ConfirmDevelopmentBaselineDeployment -or -not [Environment]::UserInteractive -or
      [Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or $Host.Name -cne 'ConsoleHost' -or
      ([Environment]::GetCommandLineArgs() -match '^-NonI')) { throw 'Interactive deployment confirmation required' }
  $root = 'D:\ChildGuard-V2'; $backend = $root + '\backend'
  # Check module and ancestor paths before executing imported code.
  foreach ($path in @($root, ($root + '\scripts'), $PSCommandPath, ($root + '\scripts\V2BaselineDeployment.psm1'))) {
    $item = Get-Item -LiteralPath $path -Force
    while ($null -ne $item) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected path refused' }
      if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
    }
  }
  if ($PSCommandPath -cne $root + '\scripts\Deploy-V2DevelopmentBaseline.ps1' -or
      $PSScriptRoot -cne $root + '\scripts' -or (Get-Location).ProviderPath -cne $root) { throw 'Workspace refused' }
  function Invoke-V2RecoveryEvidenceCheck([string]$RecordPath) {
    # Bootstrap trust BEFORE importing the policy module. These are reviewed
    # code/trust-anchor pins, not an approval digest computed from unreviewed data.
    if ($RecordPath -cnotmatch '\AD:\\ChildGuard-V2\\private-backups\\childguard-v2\\approvals\\[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json\z') { throw 'Recovery approval required' }
    $bootstrapPins = [ordered]@{
      'backend\scripts\verify-v2-backup-approval.js' = '5478F13FD53C62C145D6566107218EF114EEDF8DC74A0EFE02AB93F61443A190'
      'backend\src\backup-approval.js' = '1CB4DB415A9EDD95848E4E3ED5992D17432BB8B4A84F948E0369C837892E6FCF'
      'backend\src\backup-approval-files.js' = 'E215F3C21B62852622EDA401AE1AFB45D83FB078875F945B841EE6D0A5D37CAF'
      'backend\src\baseline-manifest.js' = '2C7998BA1E464F14BF7612C927587A56E1F517F24CCC25E6959C80E04295BAA4'
      'scripts\V2BackupApprovalTrust.json' = '25AC76FE84D61D09618E6F96D88F9B799CF32E1F3C5A81213D442C4760CEC054'
    }
    $bootstrapNode = 'C:\Program Files\nodejs\node.exe'
    $bootstrapPaths = @($bootstrapNode)
    foreach ($bootstrapRelative in $bootstrapPins.Keys) { $bootstrapPaths += Join-Path $root $bootstrapRelative }
    foreach ($bootstrapPath in $bootstrapPaths) {
      $bootstrapItem = Get-Item -LiteralPath $bootstrapPath -Force
      if ($bootstrapItem.PSIsContainer) { throw 'Recovery bootstrap refused' }
      while ($null -ne $bootstrapItem) {
        if ($bootstrapItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Recovery bootstrap refused' }
        if ($bootstrapItem -is [IO.FileInfo]) { $bootstrapItem = $bootstrapItem.Directory } else { $bootstrapItem = $bootstrapItem.Parent }
      }
    }
    if ((Get-FileHash -LiteralPath $bootstrapNode -Algorithm SHA256).Hash -cne 'B3094D0B49F9AD602262A9921551737BB97637C05DD357A06AE98188D7290AA3') { throw 'Recovery bootstrap refused' }
    foreach ($key in $bootstrapPins.Keys) {
      if ((Get-FileHash -LiteralPath (Join-Path $root $key) -Algorithm SHA256).Hash -cne $bootstrapPins[$key]) { throw 'Recovery bootstrap refused' }
    }
    $bootstrapProcessInfo = New-Object Diagnostics.ProcessStartInfo
    $bootstrapProcessInfo.FileName = $bootstrapNode
    $bootstrapProcessInfo.Arguments = '"' + $root + '\backend\scripts\verify-v2-backup-approval.js" "' + $RecordPath + '"'
    $bootstrapProcessInfo.WorkingDirectory = $root
    $bootstrapProcessInfo.UseShellExecute = $false; $bootstrapProcessInfo.CreateNoWindow = $true
    $bootstrapProcessInfo.RedirectStandardOutput = $true; $bootstrapProcessInfo.RedirectStandardError = $true
    $bootstrapProcessInfo.EnvironmentVariables.Clear()
    $bootstrapProcessInfo.EnvironmentVariables['SystemRoot'] = [Environment]::GetFolderPath('Windows')
    $bootstrapProcessInfo.EnvironmentVariables['NODE_ENV'] = 'development'
    $bootstrapProcessInfo.EnvironmentVariables['NO_COLOR'] = '1'
    $bootstrapProcess = New-Object Diagnostics.Process
    $bootstrapProcess.StartInfo = $bootstrapProcessInfo
    try {
      [void]$bootstrapProcess.Start()
      $bootstrapOutputTask = $bootstrapProcess.StandardOutput.ReadToEndAsync()
      $bootstrapErrorTask = $bootstrapProcess.StandardError.ReadToEndAsync()
      $bootstrapProcess.WaitForExit()
      $bootstrapOutput = $bootstrapOutputTask.GetAwaiter().GetResult()
      [void]$bootstrapErrorTask.GetAwaiter().GetResult()
      if ($bootstrapProcess.ExitCode -ne 0 -or $bootstrapOutput -cnotmatch '\ARECOVERY_EVIDENCE_ACCEPTED ([A-F0-9]{64})\r?\n\z') { throw 'Recovery approval refused' }
      return $Matches[1]
    } finally { $bootstrapProcessInfo.EnvironmentVariables.Clear(); $bootstrapProcess.Dispose() }
  }
  $approvalFingerprint = Invoke-V2RecoveryEvidenceCheck $RecoveryApprovalRecord
  Import-Module ($root + '\scripts\V2BaselineDeployment.psm1') -Force -DisableNameChecking
  # Embedded WP00-E manifest; independently cross-check the tested policy module.
  $approvedBaseline = [ordered]@{
    'prisma\schema.prisma' = '7CEB70CEF00F9BCB0F7E293F714BA806C239DE05A10CE176797B760C7DAF91C0'
    'prisma\migrations\migration_lock.toml' = '1DB17A8D051AA136110736752C5E1F8B7ED92B6EA8E803112FBBE2497047C210'
    'prisma\migrations\202610190001_phase1\migration.sql' = '558509EDB058D17C39D59EB25B00E8D494986C8F48BBB792E7C29B707AF5990F'
    'prisma\migrations\202610190002_constraints\migration.sql' = 'EC07E4D242B912C03712C5F7F67081DA1C938D2D7D1658C15C5BE7932F90CD07'
    'prisma\migrations\202610210001_ble_proximity\migration.sql' = '78B9537D308FB1E919F0446D97F3571C53182F181BCE6659657A0AF0D33EC3F4'
    'prisma\migrations\202610220001_multi_beacon\migration.sql' = '524AA22CFAC44A7434AC900FEEAC2AE9262230505E96CE10D6CD125CD1D102C7'
    'prisma\migrations\202610230001_personal_activity\migration.sql' = '6BD9B95F2C5B707CA6A6C83B4C4FBE5B4EEEB0DB5C6DFB13278283297BC0C527'
    'prisma\migrations\202610240001_registration_review\migration.sql' = 'FFC15C752473E5E7AC064A3C4429EB29B3B9B87CC30F3EC18DE9884F2EA8FED4'
    'prisma\migrations\202610240002_registration_invariants\migration.sql' = 'D7AAD501EFF8C74C82842A0042BB32BB57D9FF54435CEBE020C949990EF517A0'
  }
  $policyBaseline = Get-ApprovedBaselineHashes
  if ($policyBaseline.Count -ne 9) { throw 'Manifest refused' }
  foreach ($key in $approvedBaseline.Keys) {
    if ($policyBaseline[$key] -cne $approvedBaseline[$key]) { throw 'Manifest refused' }
  }
  Assert-V2Workspace $root $PSCommandPath (Get-Location).ProviderPath
  Assert-V2CleanEnvironment ([Environment]::GetEnvironmentVariables('Process'))
  Assert-V2RegularPath $backend
  foreach ($path in @('scripts\verify-v2-migration-target.js','scripts\verify-v2-baseline-deployed.js',
      'src\migration-admission.js','src\migration-client-options.js','src\migration-prisma-client.js','src\baseline-verification.js',
      'src\baseline-manifest.js','src\baseline-expression.js','package.json')) {
    Assert-V2RegularPath (Join-Path $backend $path)
  }
  $node = Assert-V2Dependencies $backend
  Assert-V2BaselineTree $backend $false
  $phrase = Read-Host 'Type DEPLOY CHILDGUARD V2 DEVELOPMENT BASELINE after separate execution approval'
  Assert-V2Consent ([bool]$ConfirmDevelopmentBaselineDeployment) $true $phrase
  $stage = New-V2BaselineStage $backend
  $journal = $stage + '.status.txt'
  [IO.File]::WriteAllText($journal, 'STAGED; no migration attempted')
  Write-Host ('Reviewed stage: ' + $stage)
  $secret = Read-Host 'childguard_v2_migrator password' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $encoded = [Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
  if (-not $encoded) { throw 'Missing credential' }
  $url = 'postgresql://childguard_v2_migrator:' + $encoded + '@127.0.0.1:5432/childguard_v2?schema=public'
  Invoke-V2BaselineSequence -CheckStage {
    Assert-V2BaselineTree $backend $false
    Assert-V2BaselineTree $stage $true
  } -Preflight {
    [IO.File]::WriteAllText($journal, 'PREFLIGHT_STARTED; no migration attempted')
    $privateEnvironment = New-V2ChildEnvironment $url Preflight
    try { Invoke-V2PrivateNode $node $backend ('"' + $backend + '\scripts\verify-v2-migration-target.js" development') $privateEnvironment }
    finally { $privateEnvironment.Clear() }
    [IO.File]::WriteAllText($journal, 'PREFLIGHT_PASSED; no migration attempted')
  } -Deploy {
    # The only database-writing command. Future explicit approval is mandatory.
    Assert-V2BaselineTree $backend $false
    Assert-V2BaselineTree $stage $true
    $recheckedApproval = Invoke-V2RecoveryEvidenceCheck $RecoveryApprovalRecord
    if ($recheckedApproval -cne $approvalFingerprint) { throw 'Recovery approval changed' }
    [IO.File]::WriteAllText($journal, 'DEPLOY_STARTED; inspect ledger privately if interrupted')
    $privateEnvironment = New-V2ChildEnvironment $url Deploy
    try { Invoke-V2PrivateNode $node $stage ('"' + $backend + '\node_modules\prisma\build\index.js" migrate deploy --schema prisma/schema.prisma') $privateEnvironment }
    finally { $privateEnvironment.Clear() }
    [IO.File]::WriteAllText($journal, 'DEPLOY_EXIT_ZERO; independent verification pending')
  } -Verify {
    $privateEnvironment = New-V2ChildEnvironment $url Verify
    try { Invoke-V2PrivateNode $node $backend ('"' + $backend + '\scripts\verify-v2-baseline-deployed.js"') $privateEnvironment }
    finally { $privateEnvironment.Clear() }
    [IO.File]::WriteAllText($journal, 'BASELINE_VERIFIED; runtime grants remain separately approved')
  }
  Write-Host 'Development baseline deployed and independently verified; runtime grants remain separate.'
} catch {
  # Preserve stage and last safe status. Never serialize caught errors or child output.
  [Console]::Error.WriteLine('Development baseline deployment STOPPED; details withheld. Preserve the stage and status; do not retry automatically.')
  exit 1
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($null -ne $privateEnvironment) { $privateEnvironment.Clear() }
  $url = $null; $encoded = $null
  if ($null -ne $secret) { $secret.Dispose() }
}
