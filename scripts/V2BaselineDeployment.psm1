Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ApprovedBaselineHashes {
  # Literal WP00-E nine-file manifest. Never derive approved values from source.
  return [ordered]@{
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
}

function Assert-V2RegularPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -cne $Path) { throw 'Path refused' }
  $item = Get-Item -LiteralPath $Path -Force
  while ($null -ne $item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected path refused' }
    if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
  }
  if ((Resolve-Path -LiteralPath $Path).ProviderPath -cne $full) { throw 'Resolved path refused' }
}

function Assert-V2Workspace([string]$Root, [string]$ScriptPath, [string]$CurrentPath) {
  if ($Root -cne 'D:\ChildGuard-V2' -or $CurrentPath -cne $Root -or
      $ScriptPath -cne 'D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1') { throw 'Workspace refused' }
  Assert-V2RegularPath $Root
  Assert-V2RegularPath $ScriptPath
  if ((New-Object IO.DriveInfo('D:\')).DriveType -ne [IO.DriveType]::Fixed) { throw 'Drive refused' }
}

function Assert-V2Consent([bool]$Requested, [bool]$Interactive, [string]$Phrase) {
  if (-not $Requested -or -not $Interactive -or $Phrase -cne 'DEPLOY CHILDGUARD V2 DEVELOPMENT BASELINE') {
    throw 'Explicit interactive deployment approval required'
  }
}

function Assert-V2CleanEnvironment([System.Collections.IDictionary]$Environment) {
  foreach ($key in $Environment.Keys) {
    $value = [string]$Environment[$key]
    if ($value -and ($key -match '^(PG|DOTENV|PRISMA_|NPM_CONFIG_)' -or
        ($key -match '^NODE_' -and $key -ne 'NODE_ENV') -or
        $key -match '^(DATABASE_URL|TEST_DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|MIGRATION_DATABASE_URL|NODE_OPTIONS|NODE_PATH|DEBUG|CI)$' -or
        ($key -eq 'NODE_ENV' -and $value -cne 'development'))) { throw 'Inherited configuration refused' }
  }
}

function Get-V2Tree([string]$Path) {
  Assert-V2RegularPath $Path
  foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
    Assert-V2RegularPath $item.FullName
    $item
    if ($item.PSIsContainer) { Get-V2Tree $item.FullName }
  }
}

function Assert-V2BaselineInventory([string[]]$Files, [string[]]$Directories, [System.Collections.IDictionary]$Hashes, [bool]$Staged) {
  $approved = Get-ApprovedBaselineHashes
  $expectedFiles = @($approved.Keys)
  if ($Staged) { $expectedFiles += 'package.json' }
  $expectedDirs = @('prisma','prisma\migrations') + @($approved.Keys | Where-Object { $_ -like '*\migration.sql' } | ForEach-Object { Split-Path $_ -Parent })
  if ((($Files | Sort-Object) -join '|') -cne (($expectedFiles | Sort-Object) -join '|')) { throw 'Baseline file set refused' }
  if ((($Directories | Sort-Object) -join '|') -cne (($expectedDirs | Sort-Object) -join '|')) { throw 'Migration directory set refused' }
  foreach ($key in $approved.Keys) {
    if (-not $Hashes.Contains($key) -or $Hashes[$key] -cne $approved[$key]) { throw 'Baseline hash refused' }
  }
  $names = @($approved.Keys | Where-Object { $_ -like '*\migration.sql' } | ForEach-Object { Split-Path (Split-Path $_ -Parent) -Leaf })
  if ($names.Count -ne 7 -or ($names -join '|') -cne (($names | Sort-Object) -join '|')) { throw 'Migration order refused' }
}

function Assert-V2BaselineTree([string]$Base, [bool]$Staged) {
  Assert-V2RegularPath $Base
  $files = @(); $dirs = @('prisma'); $hashes = @{}
  # Source scope is exactly backend/prisma; backend/.env is never opened.
  foreach ($item in @(Get-V2Tree (Join-Path $Base 'prisma'))) {
    $relative = $item.FullName.Substring($Base.Length + 1)
    if ($item.PSIsContainer) { $dirs += $relative }
    else { $files += $relative; $hashes[$relative] = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
  }
  if ($Staged) {
    $rootItems = @(Get-ChildItem -LiteralPath $Base -Force)
    if ((($rootItems.Name | Sort-Object) -join '|') -cne 'package.json|prisma') { throw 'Staged root refused' }
    Assert-V2RegularPath (Join-Path $Base 'package.json')
    if ([IO.File]::ReadAllText((Join-Path $Base 'package.json')) -cne '{"name":"childguard-v2-baseline-stage","private":true}') { throw 'Staged package refused' }
    $files += 'package.json'
  }
  Assert-V2BaselineInventory $files $dirs $hashes $Staged
}

function Assert-V2Dependencies([string]$Backend) {
  $node = 'C:\Program Files\nodejs\node.exe'
  Assert-V2RegularPath $node
  if ((Get-Command node -CommandType Application).Source -cne $node -or
      (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -cne 'B3094D0B49F9AD602262A9921551737BB97637C05DD357A06AE98188D7290AA3') { throw 'Pinned Node refused' }
  if ((& $node --version) -cne 'v24.16.0' -or $LASTEXITCODE -ne 0) { throw 'Pinned Node version refused' }
  # Native Windows realpath additionally catches drive aliases/SUBST mappings.
  $pathCheck = '-e "const fs=require(''node:fs''),p=require(''node:path'');for(const x of [''D:/ChildGuard-V2'',''D:/ChildGuard-V2/backend''])if(fs.realpathSync.native(x)!==p.resolve(x))process.exit(1)"'
  Invoke-V2PrivateNode $node 'D:\ChildGuard-V2' $pathCheck @{ SystemRoot = [Environment]::GetFolderPath('Windows') }
  $package = Get-Content -LiteralPath (Join-Path $Backend 'package.json') -Raw | ConvertFrom-Json
  if ($package.dependencies.'@prisma/client' -cne '6.12.0' -or $package.devDependencies.prisma -cne '6.12.0') { throw 'Dependency declarations refused' }
  foreach ($path in @('node_modules\prisma\package.json','node_modules\@prisma\client\package.json','node_modules\@prisma\engines\package.json')) {
    $full = Join-Path $Backend $path; Assert-V2RegularPath $full
    if ((Get-Content -LiteralPath $full -Raw | ConvertFrom-Json).version -cne '6.12.0') { throw 'Installed Prisma refused' }
  }
  # Reviewed implementation pins: configuration loading and native engine selection.
  $pins = @{
    'node_modules\prisma\build\index.js' = '245FCBC1156EE5D35F04AB5EA18E1558DF1A6D92DEDD9BAE80E49F58D3EF9920'
    'node_modules\@prisma\config\dist\index.js' = '75A3D631648C1E229881CC6F4DF652BC642F5866CC84B0817161C617AC8928C5'
    'node_modules\@prisma\client\runtime\library.js' = 'C7007AE0F7E447362DAC9F28022ED902EB279EC73F7B630111D45D61C34A10E6'
    'node_modules\.prisma\client\index.js' = '7A681FAEFFB923A2AD28D5CD5B9AE57798A24017DFBB393E94F53B759B7C67D8'
    'node_modules\@prisma\engines\schema-engine-windows.exe' = 'C9A229EA2EB67EE1101FFF136E385989AD283C2F4B76CE6D7DACCAB32EB53D8E'
    'node_modules\.prisma\client\query_engine-windows.dll.node' = '335F15347A9400C7830D7650B3BA0D961138960348B8036AC3702CCC03AE56BB'
  }
  foreach ($key in $pins.Keys) {
    $full = Join-Path $Backend $key; Assert-V2RegularPath $full
    if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -cne $pins[$key]) { throw 'Reviewed Prisma implementation changed' }
  }
  foreach ($directory in @('D:\ChildGuard-V2', $Backend)) {
    if (Get-ChildItem -LiteralPath $directory -Force -File | Where-Object { $_.Name -like 'prisma.config.*' }) { throw 'Unexpected Prisma configuration' }
  }
  return $node
}

function New-V2BaselineStage([string]$Backend) {
  $stage = 'D:\ChildGuard-V2\.baseline-stage-' + [guid]::NewGuid().ToString('N')
  [void](New-Item -ItemType Directory -Path $stage)
  Assert-V2RegularPath $stage
  foreach ($key in (Get-ApprovedBaselineHashes).Keys) {
    $target = Join-Path $stage $key
    [void](New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force)
    Copy-Item -LiteralPath (Join-Path $Backend $key) -Destination $target
  }
  [IO.File]::WriteAllText((Join-Path $stage 'package.json'), '{"name":"childguard-v2-baseline-stage","private":true}', [Text.Encoding]::ASCII)
  Assert-V2BaselineTree $stage $true
  return $stage
}

function New-V2ChildEnvironment([string]$Url, [ValidateSet('Preflight','Deploy','Verify')][string]$Action) {
  if ($Url -cnotmatch '\Apostgresql://childguard_v2_migrator:([^@/?#:\s\\]+)@127\.0\.0\.1:5432/childguard_v2\?schema=public\z') { throw 'Migration datasource refused' }
  $passwordPart = $Matches[1]
  if ($passwordPart -match '%(?![0-9A-Fa-f]{2})' -or [Uri]::UnescapeDataString($passwordPart) -match '[\x00-\x20\x7f]') { throw 'Migration datasource refused' }
  # No inheritance except the minimum Windows OS settings. No PATH/plugin/proxy loader.
  $result = @{ SystemRoot = [Environment]::GetEnvironmentVariable('SystemRoot','Process'); NODE_ENV = 'development'; NO_COLOR = '1' }
  if (-not $result.SystemRoot -or $result.SystemRoot -ine [Environment]::GetFolderPath('Windows')) { throw 'Windows environment refused' }
  if ($Action -eq 'Deploy') { $result.DATABASE_URL = $Url }
  else { $result.MIGRATION_DATABASE_URL = $Url }
  return $result
}

function Assert-V2ChildExit([int]$Code) {
  if ($Code -ne 0) { throw 'Child step failed; details withheld' }
}

function Invoke-V2PrivateNode([string]$Node, [string]$WorkingDirectory, [string]$Arguments, [hashtable]$PrivateEnvironment) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $Node; $psi.Arguments = $Arguments; $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.EnvironmentVariables.Clear()
  foreach ($key in $PrivateEnvironment.Keys) { $psi.EnvironmentVariables[$key] = $PrivateEnvironment[$key] }
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $psi
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    [void]$stdout.GetAwaiter().GetResult(); [void]$stderr.GetAwaiter().GetResult()
    Assert-V2ChildExit $process.ExitCode
  } catch { throw 'Child step failed; details withheld' }
  finally { $psi.EnvironmentVariables.Clear(); $process.Dispose() }
}

function Invoke-V2BaselineSequence([scriptblock]$CheckStage, [scriptblock]$Preflight, [scriptblock]$Deploy, [scriptblock]$Verify) {
  # No retries or recovery branch; failure prevents all later actions.
  [void](& $CheckStage)
  [void](& $Preflight)
  [void](& $Deploy)
  [void](& $Verify)
}

Export-ModuleMember -Function Get-ApprovedBaselineHashes, Assert-V2RegularPath, Assert-V2Workspace,
  Assert-V2Consent, Assert-V2CleanEnvironment, Assert-V2BaselineInventory, Assert-V2BaselineTree,
  Assert-V2Dependencies, New-V2BaselineStage, New-V2ChildEnvironment, Assert-V2ChildExit, Invoke-V2PrivateNode, Invoke-V2BaselineSequence
