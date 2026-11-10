#Requires -Version 5.1
# FILE STAGING ONLY. No database, credential prompt, role change or deployment.
[CmdletBinding()]
param([switch]$PrepareReviewedAdminSessionStage,[string]$VerifyExistingStage='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
try {
  $root='D:\ChildGuard-V2'; $backend=$root+'\backend'
  if ([bool]$PrepareReviewedAdminSessionStage -eq [bool]$VerifyExistingStage -or $PSCommandPath -cne $root+'\scripts\New-V2AdminSessionMigrationStage.ps1' -or
      (Get-Location).ProviderPath -cne $root) { throw 'Stage preparation refused' }
  $module=$root+'\scripts\V2BaselineDeployment.psm1'
  foreach($path in @($root,$PSCommandPath,$module)) {
    $item=Get-Item -LiteralPath $path -Force
    while($null -ne $item) {
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirect refused'}
      if($item -is [IO.FileInfo]){$item=$item.Directory}else{$item=$item.Parent}
    }
  }
  if((Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash -cne '10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A'){throw 'Policy integrity refused'}
  Import-Module $module -Force -DisableNameChecking
  Assert-V2RegularPath $root
  Assert-V2CleanEnvironment ([Environment]::GetEnvironmentVariables('Process'))
  [void](Assert-V2Dependencies $backend)
  $hashes=Get-ApprovedBaselineHashes
  $hashes['prisma\schema.prisma']='5D7E41ED2BBA1059FAAF6E5F90C29FEF0C8B0FB0597953C16D4937B798C61261'
  $hashes['prisma\migrations\202610250001_admin_session_foundation\migration.sql']='D282437BA93DC8491C067E9C02A2202D161693A5A9601E0E127C35D45F94D2E7'
  function Get-SessionSourceTree([string]$Path) {
    Assert-V2RegularPath $Path
    foreach($entry in Get-ChildItem -LiteralPath $Path -Force) {
      Assert-V2RegularPath $entry.FullName
      $entry
      if($entry.PSIsContainer){Get-SessionSourceTree $entry.FullName}
    }
  }
  $found=@(Get-SessionSourceTree ($backend+'\prisma'))
  $files=@($found|Where-Object {-not $_.PSIsContainer})
  if($files.Count -ne 10){throw 'Source inventory refused'}
  foreach($file in $files){if(-not $hashes.Contains($file.FullName.Substring($backend.Length+1))){throw 'Unknown source refused'}}
  if(@($found|Where-Object {$_.PSIsContainer}).Count -ne 9){throw 'Directory inventory refused'}
  foreach($relative in $hashes.Keys) {
    $path=Join-Path $backend $relative
    Assert-V2RegularPath $path
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $hashes[$relative]){throw 'Source hash refused'}
  }
  if($VerifyExistingStage) {
    if($VerifyExistingStage -cnotmatch '\AD:\\ChildGuard-V2\\\.admin-session-stage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z'){throw 'Stage path refused'}
    $stage=$VerifyExistingStage
    Assert-V2RegularPath $stage
  } else {
    $stage=$root+'\.admin-session-stage-'+[guid]::NewGuid().ToString('D')
    [void](New-Item -ItemType Directory -Path $stage)
    foreach($relative in $hashes.Keys){
      $destination=Join-Path $stage $relative
      $parent=Split-Path -Parent $destination
      if(-not (Test-Path -LiteralPath $parent)){[void](New-Item -ItemType Directory -Path $parent -Force)}
      Copy-Item -LiteralPath (Join-Path $backend $relative) -Destination $destination
    }
    [IO.File]::WriteAllText(($stage+'\package.json'),'{"name":"childguard-v2-admin-session-stage","private":true}')
  }
  foreach($relative in $hashes.Keys) {
    $destination=Join-Path $stage $relative
    Assert-V2RegularPath $destination
    if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -cne $hashes[$relative]){throw 'Staged hash refused'}
  }
  $staged=@(Get-SessionSourceTree $stage)
  $stageFiles=@($staged|Where-Object {-not $_.PSIsContainer})
  if($stageFiles.Count -ne 11 -or @($staged|Where-Object {$_.PSIsContainer}).Count -ne 10){throw 'Stage inventory refused'}
  foreach($file in $stageFiles){$relative=$file.FullName.Substring($stage.Length+1);if($relative -cne 'package.json' -and -not $hashes.Contains($relative)){throw 'Unknown staged file refused'}}
  if([IO.File]::ReadAllText(($stage+'\package.json')) -cne '{"name":"childguard-v2-admin-session-stage","private":true}'){throw 'Stage package refused'}
  Write-Output ('Verified source stage only: '+$stage)
} catch {
  [Console]::Error.WriteLine('V2 Admin session stage preparation FAILED; details withheld. No deployment attempted.')
  exit 1
}
