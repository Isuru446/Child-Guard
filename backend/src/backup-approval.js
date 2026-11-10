// No filesystem, process, Prisma or environment imports. Signature authority is
// supplied by the fixed, bootstrap-pinned trust anchor, never by the record.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { baseline } from './baseline-manifest.js';

export const criticalFiles = Object.freeze([
  'scripts/Deploy-V2DevelopmentBaseline.ps1',
  'scripts/V2BaselineDeployment.psm1',
  'scripts/V2BackupApprovalTrust.json',
  'backend/src/backup-approval.js',
  'backend/src/backup-approval-files.js',
  'backend/scripts/verify-v2-backup-approval.js',
  'backend/src/migration-admission.js',
  'backend/src/migration-client-options.js',
  'backend/src/migration-prisma-client.js',
  'backend/src/baseline-manifest.js',
  'backend/src/baseline-expression.js',
  'backend/src/baseline-verification.js',
  'backend/scripts/verify-v2-migration-target.js',
  'backend/scripts/verify-v2-baseline-deployed.js',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/node_modules/prisma/package.json',
  'backend/node_modules/prisma/build/index.js',
  'backend/node_modules/@prisma/config/dist/index.js',
  'backend/node_modules/@prisma/client/package.json',
  'backend/node_modules/@prisma/client/runtime/library.js',
  'backend/node_modules/.prisma/client/index.js',
  'backend/node_modules/@prisma/engines/package.json',
  'backend/node_modules/@prisma/engines/schema-engine-windows.exe',
  'backend/node_modules/.prisma/client/query_engine-windows.dll.node',
]);
export const recoveryLimitations = Object.freeze([
  'NO_V1_ACCESS', 'NO_TEST_DATABASE_AUTHORIZATION', 'NO_CLUSTER_ROLES_OR_HBA',
  'NO_AUTOMATIC_RESTORE_OR_RESET', 'RECOVERY_REQUIRES_SEPARATE_AUTHORIZATION',
]);
export const developmentIdentity = Object.freeze({
  database: 'childguard_v2', role: 'childguard_v2_migrator', host: '127.0.0.1',
  port: 5432, schema: 'public', postgresMajor: 18,
});
const refusal = () => new Error('Recovery approval refused; details withheld');
const requireThat = value => { if (!value) throw refusal(); };
const sha = value => typeof value === 'string' && /^[A-F0-9]{64}$/.test(value);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`);
export const approvalRelativePattern = new RegExp(`^private-backups/childguard-v2/approvals/${uuid}\\.json$`);
const backupPattern = new RegExp(`^private-backups/childguard-v2/baseline-${uuid}\\.dump$`);
const planPattern = new RegExp(`^private-backups/childguard-v2/recovery-${uuid}\\.md$`);
function keys(value, expected) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()));
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortObject(value[k])]));
  return value;
}
// Sign exactly these UTF-8 bytes (sorted keys, two-space indentation, final LF).
// Canonical comparison also refuses duplicate JSON keys and ambiguous formatting.
export const approvalBytes = value => Buffer.from(JSON.stringify(sortObject(value), null, 2) + '\n', 'utf8');
function timestamp(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  const time = Date.parse(value);
  requireThat(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}
function metadata(value, pattern) {
  keys(value, ['relativePath', 'size', 'sha256']);
  requireThat(typeof value.relativePath === 'string' && pattern.test(value.relativePath) &&
    Number.isSafeInteger(value.size) && value.size > 0 && sha(value.sha256));
}
export function trustedReviewerKey(trust) {
  try {
    keys(trust, ['schemaVersion', 'keyId', 'reviewerId', 'publicKeyPem']);
    requireThat(trust.schemaVersion === 1 && sha(trust.keyId) &&
      typeof trust.reviewerId === 'string' && /^[a-z0-9][a-z0-9_-]{2,63}$/.test(trust.reviewerId) &&
      typeof trust.publicKeyPem === 'string' && trust.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n'));
    const key = createPublicKey(trust.publicKeyPem);
    requireThat(key.asymmetricKeyType === 'ed25519' && key.export({ type: 'spki', format: 'pem' }) === trust.publicKeyPem &&
      createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').toUpperCase() === trust.keyId);
    return key;
  } catch { throw refusal(); }
}

export async function verifyRecoveryApproval(bytes, signature, trust, inspect, now = Date.now) {
  try {
    const key = trustedReviewerKey(trust); // Unenrolled trust denies before any artifact access.
    requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 131072 &&
      Buffer.isBuffer(signature) && signature.length === 64 && verify(null, bytes, key, signature));
    const record = JSON.parse(bytes.toString('utf8'));
    requireThat(approvalBytes(record).equals(bytes));
    keys(record, ['schemaVersion', 'approvalId', 'target', 'reviewer', 'acceptedAt', 'window',
      'baselineHashes', 'criticalHashes', 'backup', 'verification', 'recovery']);
    requireThat(record.schemaVersion === 1 && typeof record.approvalId === 'string' && uuidPattern.test(record.approvalId));
    keys(record.target, Object.keys(developmentIdentity));
    requireThat(Object.entries(developmentIdentity).every(([k, v]) => record.target[k] === v));
    keys(record.reviewer, ['id', 'keyId', 'decision']);
    requireThat(record.reviewer.id === trust.reviewerId && record.reviewer.keyId === trust.keyId && record.reviewer.decision === 'ACCEPT');
    keys(record.window, ['id', 'notBefore', 'expiresAt']);
    requireThat(typeof record.window.id === 'string' && uuidPattern.test(record.window.id));
    const begins = timestamp(record.window.notBefore), expires = timestamp(record.window.expiresAt);
    const accepted = timestamp(record.acceptedAt);
    requireThat(expires > begins && expires - begins <= 4 * 60 * 60 * 1000 && accepted <= expires);
    const withinWindow = () => {
      const time = now();
      requireThat(Number.isSafeInteger(time) && begins <= time && time < expires && accepted <= time);
      return time;
    };
    const time = withinWindow();
    keys(record.baselineHashes, Object.keys(baseline.hashes));
    requireThat(Object.entries(baseline.hashes).every(([p, h]) => record.baselineHashes[p] === h));
    keys(record.criticalHashes, criticalFiles);
    requireThat(criticalFiles.every(p => sha(record.criticalHashes[p])));
    metadata(record.backup, backupPattern);
    keys(record.verification, ['result', 'method', 'verifiedAt', 'createdAt', 'source', 'archiveReadable', 'applicationObjects', 'migrationLedgerExists']);
    requireThat(record.verification.result === 'PASS' && record.verification.method === 'PG18_CUSTOM_ARCHIVE_AND_SOURCE_IDENTITY_REVIEW' &&
      record.verification.archiveReadable === true && record.verification.applicationObjects === 0 && record.verification.migrationLedgerExists === false);
    keys(record.verification.source, Object.keys(developmentIdentity));
    requireThat(Object.entries(developmentIdentity).every(([k, v]) => record.verification.source[k] === v));
    const created = timestamp(record.verification.createdAt), verified = timestamp(record.verification.verifiedAt);
    requireThat(created <= verified && verified <= accepted && time - created <= 24 * 60 * 60 * 1000);
    keys(record.recovery, ['scope', 'limitations', 'plan']);
    requireThat(record.recovery.scope === 'ONLY_CHILDGUARD_V2' &&
      JSON.stringify(record.recovery.limitations) === JSON.stringify(recoveryLimitations));
    metadata(record.recovery.plan, planPattern);
    // No caller-supplied path is inspected before signature, target and all path
    // schemas pass. Reviewer signatures bind these exact expected digests.
    for (const [relativePath, expectedHash] of [
      ...Object.entries(record.baselineHashes).map(([p, h]) => ['backend/' + p, h]),
      ...Object.entries(record.criticalHashes),
    ]) {
      const actual = await inspect(relativePath);
      requireThat(actual?.regular === true && actual.links === 1 && actual.sha256 === expectedHash);
    }
    for (const item of [record.backup, record.recovery.plan]) {
      const actual = await inspect(item.relativePath);
      requireThat(actual?.regular === true && actual.links === 1 && actual.size === item.size && actual.sha256 === item.sha256);
      if (item === record.backup) requireThat(actual.customArchive === true);
    }
    requireThat(withinWindow() - created <= 24 * 60 * 60 * 1000); // Recheck after hashing large artifacts.
    return Object.freeze({ approvalId: record.approvalId, windowId: record.window.id,
      approvalSha256: createHash('sha256').update(bytes).digest('hex').toUpperCase() });
  } catch { throw refusal(); }
}
