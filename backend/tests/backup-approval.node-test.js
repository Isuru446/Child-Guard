import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { baseline } from '../src/baseline-manifest.js';
import { approvalBytes, approvalRelativePattern, criticalFiles, developmentIdentity, recoveryLimitations,
  trustedReviewerKey, verifyRecoveryApproval } from '../src/backup-approval.js';
import { allowedEvidencePath, inspectEvidenceFile } from '../src/backup-approval-files.js';

// Ephemeral in-memory test authority only. No production keys, approval files,
// backup files or signatures are created, enrolled or written by these tests.
const pair = generateKeyPairSync('ed25519');
const digest = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const trust = { schemaVersion: 1, reviewerId: 'synthetic-reviewer',
  keyId: digest(pair.publicKey.export({ type: 'spki', format: 'der' })),
  publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
const id = '11111111-1111-4111-8111-111111111111';
const windowId = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-10-24T09:00:00.000Z');
const backupBytes = Buffer.from('PGDMP_SYNTHETIC_NOT_A_REAL_DATABASE_DUMP');
const planBytes = Buffer.from('Synthetic V2-only recovery plan; no automatic action.');
function record() {
  return { schemaVersion: 1, approvalId: id, target: { ...developmentIdentity },
    reviewer: { id: trust.reviewerId, keyId: trust.keyId, decision: 'ACCEPT' },
    acceptedAt: '2026-10-24T08:50:00.000Z',
    window: { id: windowId, notBefore: '2026-10-24T08:55:00.000Z', expiresAt: '2026-10-24T10:00:00.000Z' },
    baselineHashes: { ...baseline.hashes }, criticalHashes: Object.fromEntries(criticalFiles.map(p => [p, digest('synthetic-code:' + p)])),
    backup: { relativePath: `private-backups/childguard-v2/baseline-${id}.dump`, size: backupBytes.length, sha256: digest(backupBytes) },
    verification: { result: 'PASS', method: 'PG18_CUSTOM_ARCHIVE_AND_SOURCE_IDENTITY_REVIEW', createdAt: '2026-10-24T08:30:00.000Z',
      verifiedAt: '2026-10-24T08:45:00.000Z', source: { ...developmentIdentity }, archiveReadable: true, applicationObjects: 0, migrationLedgerExists: false },
    recovery: { scope: 'ONLY_CHILDGUARD_V2', limitations: [...recoveryLimitations],
      plan: { relativePath: `private-backups/childguard-v2/recovery-${id}.md`, size: planBytes.length, sha256: digest(planBytes) } },
  };
}
function inspector(value = record(), mutate = () => {}) {
  const files = new Map([
    ...Object.entries(value.baselineHashes).map(([p, sha256]) => ['backend/' + p, { sha256, size: 1, regular: true, links: 1 }]),
    ...Object.entries(value.criticalHashes).map(([p, sha256]) => [p, { sha256, size: 1, regular: true, links: 1 }]),
    [value.backup.relativePath, { sha256: digest(backupBytes), size: backupBytes.length, regular: true, links: 1, customArchive: true }],
    [value.recovery.plan.relativePath, { sha256: digest(planBytes), size: planBytes.length, regular: true, links: 1 }],
  ]);
  mutate(files);
  const calls = [];
  return { calls, async inspect(path) { calls.push(path); if (!files.has(path)) throw Error('Synthetic missing file'); return files.get(path); } };
}
async function validate(value, options = {}) {
  const bytes = options.bytes ?? approvalBytes(value);
  const signature = options.signature ?? sign(null, bytes, options.privateKey ?? pair.privateKey);
  const adapter = options.adapter ?? inspector();
  return verifyRecoveryApproval(bytes, signature, options.trust ?? trust, adapter.inspect, options.now ?? (() => now));
}
const refused = promise => assert.rejects(promise, e => {
  assert.equal(e.message, 'Recovery approval refused; details withheld'); assert.equal(e.cause, undefined); return true;
});
test('valid independently signed synthetic evidence passes and hashes every required item', async () => {
  const value = record(), adapter = inspector();
  const proof = await validate(value, { adapter });
  assert.equal(proof.approvalId, id); assert.equal(proof.windowId, windowId);
  assert.equal(proof.approvalSha256, digest(approvalBytes(value)));
  assert.equal(adapter.calls.length, 9 + criticalFiles.length + 2);
  assert.ok(Object.isFrozen(proof));
});
test('missing approval/signature is refused without inspecting artifacts', async () => {
  const adapter = inspector();
  await refused(verifyRecoveryApproval(Buffer.alloc(0), Buffer.alloc(0), trust, adapter.inspect, () => now));
  assert.deepEqual(adapter.calls, []);
});
test('production anchor is unenrolled and refuses even a correctly signed test record', async () => {
  const anchor = JSON.parse(readFileSync(new URL('../../scripts/V2BackupApprovalTrust.json', import.meta.url), 'utf8'));
  const adapter = inspector();
  await refused(validate(record(), { trust: anchor, adapter })); assert.deepEqual(adapter.calls, []);
});
test('self-generated approved flag and recomputed digest are not authorization', async () => {
  const value = record(); value.approved = true;
  const bytes = approvalBytes(value), adapter = inspector();
  assert.equal(digest(bytes).length, 64);
  await refused(validate(value, { bytes, signature: Buffer.alloc(64), adapter }));
  await refused(validate(value, { adapter })); // Even trusted signatures cannot widen the schema.
  assert.deepEqual(adapter.calls, []);
});
test('attacker key cannot authorize or substitute the independent reviewer', async () => {
  const attacker = generateKeyPairSync('ed25519'), adapter = inspector();
  await refused(validate(record(), { privateKey: attacker.privateKey, adapter })); assert.deepEqual(adapter.calls, []);
});
test('modified signed bytes refuse before file access even with a fresh self-calculated hash', async () => {
  const value = record(), old = approvalBytes(value), signature = sign(null, old, pair.privateKey), adapter = inspector();
  value.target.database = 'childguard_v2_test';
  await refused(validate(value, { signature, adapter })); assert.deepEqual(adapter.calls, []);
});
const invalid = [
  ['wrong database', r => { r.target.database = 'childguard'; }],
  ['test database', r => { r.target.database = 'childguard_v2_test'; }],
  ['wrong role', r => { r.target.role = 'postgres'; }],
  ['test role', r => { r.target.role = 'childguard_v2_test_migrator'; }],
  ['wrong host', r => { r.target.host = 'localhost'; }],
  ['wrong port', r => { r.target.port = 5433; }],
  ['wrong schema', r => { r.target.schema = 'other'; }],
  ['wrong PostgreSQL', r => { r.target.postgresMajor = 19; }],
  ['V1 backup path', r => { r.backup.relativePath = 'D:/Pro/childguard_backup.dump'; }],
  ['test backup path', r => { r.backup.relativePath = `private-backups/childguard-v2-test/baseline-${id}.dump`; }],
  ['traversal backup path', r => { r.backup.relativePath = `private-backups/childguard-v2/../../Pro/baseline-${id}.dump`; }],
  ['V1 recovery path', r => { r.recovery.plan.relativePath = 'D:/Pro/recovery.md'; }],
  ['alternate data stream', r => { r.backup.relativePath += ':secret'; }],
  ['empty backup', r => { r.backup.size = 0; }],
  ['string backup size', r => { r.backup.size = '20'; }],
  ['unsafe backup size', r => { r.backup.size = Number.MAX_SAFE_INTEGER + 1; }],
  ['malformed digest', r => { r.backup.sha256 = 'x'; }],
  ['unknown verification', r => { r.verification.result = 'UNKNOWN'; }],
  ['unreadable archive', r => { r.verification.archiveReadable = false; }],
  ['nonempty source', r => { r.verification.applicationObjects = 1; }],
  ['existing ledger', r => { r.verification.migrationLedgerExists = true; }],
  ['foreign backup source', r => { r.verification.source.database = 'childguard_test'; }],
  ['incorrect recovery scope', r => { r.recovery.scope = 'ALL_DATABASES'; }],
  ['missing limitation', r => { r.recovery.limitations.pop(); }],
  ['wrong reviewer', r => { r.reviewer.id = 'operator'; }],
  ['wrong reviewer key', r => { r.reviewer.keyId = '0'.repeat(64); }],
  ['unaccepted decision', r => { r.reviewer.decision = 'PENDING'; }],
  ['expired', r => { r.window.expiresAt = '2026-10-24T09:00:00.000Z'; }],
  ['not started', r => { r.window.notBefore = '2026-10-24T09:01:00.000Z'; }],
  ['excessive window', r => { r.window.notBefore = '2026-10-24T05:00:00.000Z'; r.window.expiresAt = '2026-10-24T10:00:00.001Z'; }],
  ['stale backup', r => { r.verification.createdAt = '2026-10-23T08:00:00.000Z'; }],
  ['future acceptance', r => { r.acceptedAt = '2026-10-24T09:01:00.000Z'; }],
  ['unreviewed backup', r => { r.verification.verifiedAt = '2026-10-24T08:51:00.000Z'; }],
  ['changed baseline', r => { r.baselineHashes['prisma/schema.prisma'] = '0'.repeat(64); }],
  ['missing baseline', r => { delete r.baselineHashes['prisma/schema.prisma']; }],
  ['extra baseline', r => { r.baselineHashes['prisma/new.sql'] = '0'.repeat(64); }],
  ['missing critical script', r => { delete r.criticalHashes['scripts/V2BaselineDeployment.psm1']; }],
  ['foreign critical script', r => { r.criticalHashes['D:/Pro/script.ps1'] = '0'.repeat(64); }],
  ['credential field', r => { r.DATABASE_URL = 'synthetic-forbidden'; }],
];
for (const [name, mutate] of invalid) test(`signed ${name} is rejected before artifact inspection`, async () => {
  const value = record(); mutate(value); const adapter = inspector();
  await refused(validate(value, { adapter })); assert.deepEqual(adapter.calls, []);
});
for (const path of criticalFiles) test(`changed critical file ${path} refuses`, async () => {
  const adapter = inspector(record(), files => { files.get(path).sha256 = '0'.repeat(64); });
  await refused(validate(record(), { adapter }));
});
for (const [name, mutate] of [
  ['changed archive', f => { f.sha256 = '0'.repeat(64); }], ['changed size', f => { f.size++; }],
  ['linked archive', f => { f.links = 2; }], ['nonregular archive', f => { f.regular = false; }],
  ['not a custom archive', f => { f.customArchive = false; }],
]) test(`${name} refuses independently of a valid signature`, async () => {
  const value = record(), adapter = inspector(value, files => mutate(files.get(value.backup.relativePath)));
  await refused(validate(value, { adapter }));
});
test('changed recovery plan refuses', async () => {
  const value = record(), adapter = inspector(value, files => { files.get(value.recovery.plan.relativePath).sha256 = '0'.repeat(64); });
  await refused(validate(value, { adapter }));
});
test('approval expiring during artifact hashing refuses', async () => {
  let clock = 0;
  await refused(validate(record(), { now: () => clock++ === 0 ? now : Date.parse('2026-10-24T10:00:00.000Z') }));
});
test('malformed/duplicate/noncanonical JSON and corrupted signatures refuse safely', async () => {
  for (const bytes of [Buffer.from('not-json'), Buffer.concat([approvalBytes(record()), Buffer.from(' ')]),
    Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n')]) {
    await refused(validate(record(), { bytes }));
  }
  const bytes = approvalBytes(record()), signature = sign(null, bytes, pair.privateKey); signature[0] ^= 1;
  await refused(validate(record(), { signature }));
});
test('artifact access faults are redacted', async () => {
  await refused(validate(record(), { adapter: { inspect: async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); } } }));
});
test('untrusted/mismatched anchor metadata fails closed', () => {
  for (const changed of [{ ...trust, keyId: '0'.repeat(64) }, { ...trust, publicKeyPem: null },
    { ...trust, publicKeyPem: trust.publicKeyPem + 'SYNTHETIC_EXTRA_CONTENT' }, { ...trust, schemaVersion: 2 }, { ...trust, approved: true }]) {
    assert.throws(() => trustedReviewerKey(changed), /details withheld/);
  }
});
test('filesystem adapter paths can never select V1, test backups or live runtime configuration', () => {
  assert.ok(approvalRelativePattern.test(`private-backups/childguard-v2/approvals/${id}.json`));
  assert.ok(allowedEvidencePath(record().backup.relativePath));
  for (const path of ['D:/Pro/backup.dump', '../Pro/backup.dump', 'backend/.env', 'backend/prisma/.env',
    'private-backups/childguard-v2-test/archive.dump', 'private-backups/childguard-v2/baseline.dump',
    `private-backups/childguard-v2/baseline-${id}.dump:stream`]) assert.equal(allowedEvidencePath(path), false);
});
test('read-only file adapter hashes an allowlisted public source file without executing it', async () => {
  const relative = 'backend/src/migration-prisma-client.js';
  const bytes = readFileSync(new URL('../src/migration-prisma-client.js', import.meta.url));
  const actual = await inspectEvidenceFile(relative);
  assert.equal(actual.sha256, digest(bytes)); assert.equal(actual.size, bytes.length);
  assert.equal(actual.regular, true); assert.equal(actual.links, 1); assert.equal(actual.customArchive, false);
  await assert.rejects(inspectEvidenceFile('backend/.env'), /details withheld/);
});
test('runner bootstrap and gate ordering protect staging, module import, credentials and final deployment', () => {
  const text = readFileSync(new URL('../../scripts/Deploy-V2DevelopmentBaseline.ps1', import.meta.url), 'utf8');
  const first = text.indexOf('$approvalFingerprint = Invoke-V2RecoveryEvidenceCheck');
  assert.ok(first > 0);
  for (const later of ['Import-Module', '$stage = New-V2BaselineStage', '-AsSecureString']) assert.ok(first < text.indexOf(later));
  const deploy = text.slice(text.indexOf('} -Deploy {'), text.indexOf('} -Verify {'));
  assert.ok(deploy.indexOf('Invoke-V2RecoveryEvidenceCheck') < deploy.indexOf('migrate deploy --schema'));
  assert.match(deploy, /recheckedApproval -cne \$approvalFingerprint/);
  assert.match(deploy, /Assert-V2BaselineTree \$stage \$true/);
  assert.match(deploy, /Assert-V2BaselineTree \$backend \$false/);
  assert.doesNotMatch(text, /SkipRecovery|BypassRecovery|AllowUnsigned|ExecutionPolicy/);
  const pins = [...text.matchAll(/'(backend\\(?:scripts\\verify-v2-backup-approval\.js|src\\(?:backup-approval(?:-files)?|baseline-manifest)\.js)|scripts\\V2BackupApprovalTrust\.json)' = '([A-F0-9]{64})'/g)];
  assert.equal(pins.length, 5);
  for (const [, relative, hash] of pins) assert.equal(digest(readFileSync(new URL('../../' + relative.replaceAll('\\', '/'), import.meta.url))), hash);
  assert.ok(criticalFiles.includes('scripts/Deploy-V2DevelopmentBaseline.ps1'));
});
test('PowerShell parser sees approval checks as throwing gates with a required record argument', () => {
  const command = String.raw`
$tokens=$null;$errors=$null
$a=[Management.Automation.Language.Parser]::ParseFile('D:\ChildGuard-V2\scripts\Deploy-V2DevelopmentBaseline.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Runner parse failed'}
@{parameters=@($a.ParamBlock.Parameters.Name.VariablePath.UserPath);gates=@($a.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-V2RecoveryEvidenceCheck'},$true)|ForEach-Object {$_.CommandElements.Count})}|ConvertTo-Json -Compress
`;
  const parsed = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }));
  assert.ok(parsed.parameters.includes('RecoveryApprovalRecord'));
  assert.deepEqual(parsed.gates, [2, 2]);
});
