# LOCAL DEVELOPMENT ONLY. No independent signature authority; never production approval.
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
  if ($PSCommandPath -cne $root + '\scripts\Deploy-V2LocalDevelopmentBaseline.ps1' -or
      $PSScriptRoot -cne $root + '\scripts' -or (Get-Location).ProviderPath -cne $root) { throw 'Workspace refused' }
  function Invoke-V2RecoveryEvidenceCheck([string]$RecordPath) {
    # Check reviewed code integrity BEFORE importing the policy module.
    # Local owner consent is interactive; these pins are not signature authority.
    if ($RecordPath -cnotmatch '\AD:\\ChildGuard-V2\\private-backups\\childguard-v2\\approvals\\[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json\z') { throw 'Recovery approval required' }
    $bootstrapPins = [ordered]@{
      'scripts\V2BaselineDeployment.psm1' = '10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A'
      'backend\src\backup-approval.js' = '1CB4DB415A9EDD95848E4E3ED5992D17432BB8B4A84F948E0369C837892E6FCF'
      'backend\src\backup-approval-files.js' = 'E215F3C21B62852622EDA401AE1AFB45D83FB078875F945B841EE6D0A5D37CAF'
      'backend\src\local-development-approval.js' = 'EF73DBEF43A966FB462A3DF40045D465D787413FE330DC659099BF30341DC38F'
      'backend\scripts\verify-v2-local-backup.js' = '211CD5F764A0C071C9CCF7D16BF44B6B2A4D69411A57CD8BB39AB25E21617F9A'
      'backend\src\migration-admission.js' = 'CECCA27BFE79BAA102CA1A00902A0859EACA8C6F260D2660D6D3003C0F7B84D9'
      'backend\src\migration-client-options.js' = '88B50EC81FE195804635CDD6DA2B42A2DA7DA47C8ACCB2D3E6A1A3613C7F02A8'
      'backend\src\migration-prisma-client.js' = 'DBFB8658A21C51AF9343DCA814123DA9DBCB898B79FA108583FAFA14A26C383A'
      'backend\src\baseline-manifest.js' = '2C7998BA1E464F14BF7612C927587A56E1F517F24CCC25E6959C80E04295BAA4'
      'backend\src\baseline-expression.js' = '1C13ECCBED19F875CA708ED461FF4367A4992AAE6088B876610EAB3798F31B0E'
      'backend\src\baseline-verification.js' = '7EE273C3557D097653EB696A6FB5FE23CA337368443221206CC5BD111431DC94'
      'backend\scripts\verify-v2-migration-target.js' = '8CC2B3F0F18F675325E73A5C12E44F4A517F74AFA52773C959B8F5E4868B5A3D'
      'backend\scripts\verify-v2-baseline-deployed.js' = '5B88FF87414DEC5BFB7F436F024838A9BB3B313B40344D1CD3783158BCD2D196'
      'backend\package.json' = '6214A6A83BC922E47B5AF2FFA68870DAB9BF93277E3B47A122AB8C31C6D542CC'
      'backend\package-lock.json' = 'FC2A38AE8055C54E8C1A273F5FE3060DD0EE883EDE00C894973B419F2B90F1A0'
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
    $bootstrapProcessInfo.Arguments = '"' + $root + '\backend\scripts\verify-v2-local-backup.js" "' + $RecordPath + '"'
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
      if ($bootstrapProcess.ExitCode -ne 0 -or $bootstrapOutput -cnotmatch '\ALOCAL_RECOVERY_EVIDENCE_VERIFIED ([A-F0-9]{64})\r?\n\z') { throw 'Recovery approval refused' }
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
  Assert-V2RegularPath $root
  Assert-V2RegularPath $PSCommandPath
  if ((New-Object IO.DriveInfo('D:\')).DriveType -ne [IO.DriveType]::Fixed) { throw 'Drive refused' }
  Assert-V2CleanEnvironment ([Environment]::GetEnvironmentVariables('Process'))
  Assert-V2RegularPath $backend
  foreach ($path in @('scripts\verify-v2-migration-target.js','scripts\verify-v2-baseline-deployed.js',
      'src\migration-admission.js','src\migration-client-options.js','src\migration-prisma-client.js','src\baseline-verification.js',
      'src\baseline-manifest.js','src\baseline-expression.js','package.json')) {
    Assert-V2RegularPath (Join-Path $backend $path)
  }
  $node = Assert-V2Dependencies $backend
  Assert-V2BaselineTree $backend $false
  $phrase = Read-Host 'Type DEPLOY CHILDGUARD V2 DEVELOPMENT BASELINE to confirm your manual V2 backup/recovery review and separately approved local execution'
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
