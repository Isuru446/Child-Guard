// Source/AST regression checks: never execute the runner or policy module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { baseline } from '../src/baseline-manifest.js';

const runner = readFileSync(new URL('../../scripts/Deploy-V2DevelopmentBaseline.ps1', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../scripts/V2BaselineDeployment.psm1', import.meta.url), 'utf8');
const policyTests = readFileSync(new URL('../../scripts/Test-V2BaselineDeploymentPolicy.ps1', import.meta.url), 'utf8');
const parseCommand = String.raw`
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$r=[Management.Automation.Language.Parser]::ParseFile('D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Runner parse failed'}
$try=$r.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]} | Select-Object -First 1
$m=[Management.Automation.Language.Parser]::ParseFile('D:\ChildGuard-V2\scripts\V2BaselineDeployment.psm1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Policy parse failed'}
$sequence=$m.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Invoke-V2BaselineSequence'},$true)[0]
$commands=@($sequence.Body.FindAll({param($a) $a -is [Management.Automation.Language.CommandAst]},$true) | ForEach-Object {$_.CommandElements[0].Extent.Text})
@{gateType=$try.Body.Statements[0].GetType().Name;gate=$try.Body.Statements[0].Extent.Text;sequence=$commands;parameters=@($r.ParamBlock.Parameters.Name.VariablePath.UserPath)}|ConvertTo-Json -Compress
`;
let ast;
test('Windows parser inspects the actual runner and policy without executing either', () => {
  ast = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parseCommand], { encoding: 'utf8' }));
  assert.equal(ast.gateType, 'IfStatementAst');
  assert.deepEqual(ast.parameters, ['ConfirmDevelopmentBaselineDeployment', 'RecoveryApprovalRecord']);
  assert.deepEqual(ast.sequence, ['$CheckStage', '$Preflight', '$Deploy', '$Verify']);
});
test('initial AST guard refuses missing consent, redirection and unattended hosts', () => {
  assert.ok(ast);
  for (const required of ['-not $ConfirmDevelopmentBaselineDeployment', '-not [Environment]::UserInteractive',
    '[Console]::IsInputRedirected', '[Console]::IsOutputRedirected', "'ConsoleHost'"]) {
    assert.ok(ast.gate.includes(required));
  }
  assert.match(ast.gate, /throw/);
  assert.ok(runner.indexOf('Assert-V2Consent') < runner.indexOf('$stage = New-V2BaselineStage'));
  assert.ok(runner.indexOf('Assert-V2Consent') < runner.indexOf('-AsSecureString'));
  assert.match(policy, /Phrase -cne 'DEPLOY CHILDGUARD V2 DEVELOPMENT BASELINE'/);
});
test('both PowerShell manifests embed exactly the immutable nine reviewed hashes', () => {
  for (const text of [runner, policy]) {
    const hashes = Object.fromEntries([...text.matchAll(/'((?:prisma\\)[^']+)' = '([A-F0-9]{64})'/g)].map(m => [m[1].replaceAll('\\', '/'), m[2]]));
    assert.deepEqual(hashes, baseline.hashes);
  }
  assert.match(policy, /Hashes\[\$key\] -cne \$approved\[\$key\]/);
  assert.match(policy, /Migration directory set refused/);
  assert.match(policy, /Baseline file set refused/);
});
test('fixed path, redirect and exact staged-file policies remain explicit', () => {
  assert.match(policy, /Root -cne 'D:\\ChildGuard-V2'/);
  assert.match(policy, /ScriptPath -cne 'D:\\ChildGuard-V2\\scripts\\Deploy-V2DevelopmentBaseline.ps1'/);
  assert.match(policy, /CurrentPath -cne \$Root/);
  assert.match(policy, /IO\.FileAttributes\]::ReparsePoint/);
  assert.match(policy, /ProviderPath -cne \$full/);
  assert.match(policy, /-cne 'package.json\|prisma'/);
  assert.match(policy, /Copy-Item -LiteralPath \(Join-Path \$Backend \$key\)/);
  assert.doesNotMatch(policy, /Copy-Item[^\r\n]+-Recurse/);
  // Parenthesize concatenations within PowerShell array literals; otherwise
  // comma/plus precedence can produce extra path elements.
  assert.match(runner, /@\(\$root, \(\$root \+ '\\scripts'\), \$PSCommandPath, \(\$root \+ '\\scripts\\V2BaselineDeployment\.psm1'\)\)/);
});
const urlPattern = policy.match(/Url -cnotmatch '([^']+)'/)?.[1];
assert.ok(urlPattern);
const pattern = new RegExp(urlPattern.replace('\\A', '^').replace('\\z', '$'));
const url = 'postgresql://childguard_v2_migrator:synthetic%40password@127.0.0.1:5432/childguard_v2?schema=public';
test('actual embedded deployment URL pattern admits only its fixed development identity', () => {
  assert.ok(pattern.test(url));
  for (const wrong of [url.replace('childguard_v2_migrator', 'postgres'), url.replace('/childguard_v2?', '/childguard_v2_test?'),
    url.replace('127.0.0.1', 'localhost'), url.replace(':5432', ':5433'), url + '&options=x', url.replace('schema=public', 'schema=other')]) {
    assert.equal(pattern.test(wrong), false);
  }
});
test('connection/loader variables are refused before any dependency process', () => {
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'NODE_OPTIONS', 'NODE_PATH', 'DIRECT_URL', 'SHADOW_DATABASE_URL', 'DEBUG', 'CI']) assert.ok(policy.includes(key));
  assert.match(policy, /\^\(PG\|DOTENV\|PRISMA_\|NPM_CONFIG_\)/);
  assert.ok(runner.indexOf('Assert-V2CleanEnvironment') < runner.indexOf('Assert-V2Dependencies'));
});
test('clean isolated subprocesses consume errors privately and contain no secrets in arguments', () => {
  assert.match(policy, /EnvironmentVariables.Clear\(\)/);
  assert.match(policy, /RedirectStandardError = \$true/);
  assert.match(policy, /\[void\]\$stderr.GetAwaiter\(\).GetResult\(\)/);
  assert.match(policy, /Assert-V2ChildExit \$process.ExitCode/);
  assert.doesNotMatch(runner, /\$env:|SetEnvironmentVariable|\$_|Write-Error|Start-Transcript/);
  assert.match(runner, /Read-Host[^\r\n]+-AsSecureString/);
  assert.match(runner, /ZeroFreeBSTR/);
  assert.doesNotMatch(policy, /ReadAllText\([^\r\n]*\.env|Get-Content[^\r\n]*\.env/);
  assert.doesNotMatch(runner, /Invoke-V2PrivateNode[^\r\n]+\$url/);
});
test('single deploy is between real preflight and independent verifier; failure cannot retry', () => {
  assert.equal([...runner.matchAll(/migrate deploy --schema prisma\/schema\.prisma/g)].length, 1);
  assert.match(runner, /verify-v2-migration-target\.js" development/);
  assert.match(runner, /verify-v2-baseline-deployed\.js/);
  assert.doesNotMatch(runner, /\bmigrate (dev|reset|resolve)\b|\bdb (push|seed)\b|npm run/);
  const body = policy.slice(policy.indexOf('function Invoke-V2BaselineSequence'), policy.indexOf('Export-ModuleMember'));
  assert.doesNotMatch(body, /\btry\b|\bcatch\b|\bwhile\b|\bfor\b/);
  assert.match(runner, /DEPLOY_EXIT_ZERO; independent verification pending/);
  assert.match(runner, /Preserve the stage and status; do not retry automatically/);
});
test('standalone verifier fixes its real path and never imports empty-target admission', () => {
  const entry = readFileSync(new URL('../scripts/verify-v2-baseline-deployed.js', import.meta.url), 'utf8');
  assert.match(entry, /backend !== resolve\('D:\/ChildGuard-V2\/backend'\)/);
  assert.match(entry, /process.argv.length !== 2/);
  assert.match(entry, /realpathSync\(fileURLToPath\(import.meta.url\)\)/);
  const verifier = readFileSync(new URL('../src/baseline-verification.js', import.meta.url), 'utf8');
  assert.doesNotMatch(verifier, /assertEmptyMigrationTarget|queryRawUnsafe|executeRaw|dotenv/);
  assert.match(entry, /createMigrationPrismaClient/);
  assert.doesNotMatch(entry, /import\('@prisma\/client'\)/);
});
test('separate proposed grant SQL requires typed consent, actual identity and immutable ledger before grants', () => {
  const sql = readFileSync(new URL('../../scripts/Grant-V2DevelopmentBaselineRuntime.sql', import.meta.url), 'utf8');
  assert.match(sql, /\\prompt/); assert.match(sql, /\\quit 1/);
  assert.ok(sql.indexOf('current_database()') < sql.indexOf('\nGRANT SELECT'));
  assert.match(sql, /session_user IS DISTINCT FROM 'childguard_v2_migrator'/);
  for (const [path, hash] of Object.entries(baseline.hashes).filter(([p]) => p.endsWith('/migration.sql'))) {
    assert.ok(sql.includes(path.split('/')[2])); assert.ok(sql.includes(hash.toLowerCase()));
  }
  const grant = sql.match(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE([\s\S]+?)TO childguard_v2_app;/)[1];
  assert.deepEqual([...grant.matchAll(/public\."([^"]+)"/g)].map(m => m[1]).sort(), [...baseline.tables].sort());
  assert.doesNotMatch(grant, /_prisma_migrations/);
  assert.match(sql, /REVOKE ALL ON TABLE public\._prisma_migrations FROM PUBLIC, childguard_v2_app, childguard_v2_test_app/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|CREATE)|ALTER ROLE|OWNER TO|GRANT.*TRUNCATE|ALTER DEFAULT PRIVILEGES/);
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(runner, /Grant-V2DevelopmentBaselineRuntime/);
});
test('PowerShell negative datasource fixtures parenthesize concatenation and validate the fixture set', () => {
  const fixture = policyTests.match(/\$badUrls = @\(([\s\S]*?)\r?\n\$badUrlNames =/)?.[1];
  assert.ok(fixture);
  assert.match(fixture, /\(\$url \+ '&host=elsewhere'\)/);
  assert.doesNotMatch(fixture, /,\s*\$url \+/);
  assert.match(policyTests, /Check \(\$badUrls.Count -eq 7\) 'INVALID_DATASOURCE_FIXTURE_COUNT'/);
  assert.match(policyTests, /Check \(\$badUrls\[4\] -ceq \(\$url \+ '&host=elsewhere'\)\) 'EXTRA_URL_PARAMETER_FIXTURE_IS_COMPLETE'/);
  assert.match(policyTests, /Check \(\$badUrl -cne \$url\)/);
  assert.match(policyTests, /'REJECT_' \+ \$badUrlNames\[\$caseIndex\]/);
  assert.match(policyTests, /'Migration datasource refused'/);
});
test('PowerShell assertion diagnostics are named and never interpolate tested values or raw errors', () => {
  assert.match(policyTests, /Name -cnotmatch '\^\[A-Z\]\[A-Z0-9_\]\+\$'/);
  assert.match(policyTests, /throw \('Policy regression failed: ' \+ \$Name\)/);
  assert.match(policyTests, /'NAMED_ASSERTION_ERROR_IS_REDACTED'/);
  assert.doesNotMatch(policyTests, /throw[^\r\n]*(?:\$url|\$badUrl|\$environment|\$actualError|\$_)/);
  assert.match(policyTests, /Check \(\$actualError -ceq \$ExpectedError\)/);
});
test('PowerShell policy test AST cannot invoke external process/deployment/grant commands', () => {
  const command = String.raw`
$tokens=$null;$errors=$null
$a=[Management.Automation.Language.Parser]::ParseFile('D:\ChildGuard-V2\scripts\Test-V2BaselineDeploymentPolicy.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Policy-test parse failed'}
$commands=@($a.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true)|ForEach-Object {$_.CommandElements[0].Extent.Text})
$checks=@($a.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -in @('Check','Must-Refuse')},$true)|ForEach-Object {$_.CommandElements.Count})
$calls=@($a.FindAll({param($n) $n -is [Management.Automation.Language.InvokeMemberExpressionAst]},$true)|ForEach-Object {$_.Member.Extent.Text})
@{commands=$commands;checks=$checks;methods=$calls}|ConvertTo-Json -Compress
`;
  const parsed = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }));
  const allowed = new Set(['Set-StrictMode', 'Import-Module', 'Check', 'Must-Refuse', '$Action', 'Out-Null', 'Assert-V2Consent', 'Assert-V2Workspace',
    'Get-ApprovedBaselineHashes', 'Where-Object', 'ForEach-Object', 'Split-Path', 'Assert-V2BaselineInventory',
    'Assert-V2BaselineTree', 'Assert-V2CleanEnvironment', 'New-V2ChildEnvironment', 'Assert-V2ChildExit', 'New-Object',
    'Invoke-V2BaselineSequence', 'Get-Module', '$policy', 'Assert-V2RegularPath', 'Remove-Item', 'Select-Object', 'Write-Output']);
  for (const name of parsed.commands) assert.ok(allowed.has(name), 'Unexpected policy-test command');
  for (const count of parsed.checks) assert.ok(count >= 3, 'Every assertion requires a safe name');
  assert.ok(!parsed.methods.includes('Start'));
  assert.ok(!parsed.methods.includes('StartProcess'));
  for (const prohibited of ['Invoke-V2PrivateNode', 'Assert-V2Dependencies', 'New-V2BaselineStage', 'Start-Process']) {
    assert.ok(!parsed.commands.includes(prohibited));
  }
});
