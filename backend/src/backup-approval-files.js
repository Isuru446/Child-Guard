// Read-only file adapter; no database/client/process imports or writes.
import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline } from './baseline-manifest.js';
import { approvalRelativePattern, criticalFiles, trustedReviewerKey, verifyRecoveryApproval } from './backup-approval.js';

const root = resolve('D:/ChildGuard-V2');
const refuse = () => new Error('Recovery approval refused; details withheld');
const fixedPaths = new Set([...criticalFiles, ...Object.keys(baseline.hashes).map(p => 'backend/' + p)]);
const artifact = /^private-backups\/childguard-v2\/(?:baseline-[0-9a-f-]{36}\.dump|recovery-[0-9a-f-]{36}\.md)$/;
export function allowedEvidencePath(relative) {
  return typeof relative === 'string' && (fixedPaths.has(relative) || artifact.test(relative) ||
    approvalRelativePattern.test(relative) || (relative.endsWith('.sig') && approvalRelativePattern.test(relative.slice(0, -4))));
}
function checkedFile(relative) {
  if (!allowedEvidencePath(relative)) throw refuse();
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync.native(root) !== root) throw refuse();
  const path = resolve(root, relative);
  if (!path.startsWith(root + '\\')) throw refuse();
  // Walk from the trusted root outward; never descend through a junction or
  // resolve a file target before checking its ancestors for redirects.
  let part = root;
  const segments = relative.split('/');
  for (let index = 0; index < segments.length; index++) {
    part = resolve(part, segments[index]);
    const stat = lstatSync(part);
    if (stat.isSymbolicLink()) throw refuse();
    if (index < segments.length - 1 && !stat.isDirectory()) throw refuse();
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || realpathSync.native(path) !== path) throw refuse();
  return { path, stat };
}
function unchanged(before, after) {
  if (before.size !== after.size || before.ino !== after.ino || before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs || !after.isFile() || after.nlink !== 1) throw refuse();
}
function readBounded(relative, limit) {
  const file = checkedFile(relative);
  if (file.stat.size > limit) throw refuse();
  const bytes = readFileSync(file.path);
  unchanged(file.stat, lstatSync(file.path));
  if (bytes.length !== file.stat.size) throw refuse();
  return bytes;
}
// Shared read-only record access. This supplies bytes, never approval authority.
export function readLocalRecoveryRecord(recordPath) {
  if (typeof recordPath !== 'string' || !recordPath.startsWith(root + '\\') || resolve(recordPath) !== recordPath) throw refuse();
  const relative = recordPath.slice(root.length + 1).replaceAll('\\', '/');
  if (!approvalRelativePattern.test(relative)) throw refuse();
  return readBounded(relative, 131072);
}
export async function inspectEvidenceFile(relative) {
  const file = checkedFile(relative);
  const hash = createHash('sha256');
  let prefix = Buffer.alloc(0);
  for await (const chunk of createReadStream(file.path)) {
    if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
    hash.update(chunk);
  }
  const after = checkedFile(relative);
  unchanged(file.stat, after.stat);
  return { regular: true, links: 1, size: after.stat.size, sha256: hash.digest('hex').toUpperCase(), customArchive: prefix.equals(Buffer.from('PGDMP')) };
}
export async function verifyStoredRecoveryApproval(recordPath) {
  try {
    const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (backend !== resolve(root, 'backend') || realpathSync.native(backend) !== backend ||
        typeof recordPath !== 'string' || !recordPath.startsWith(root + '\\') || resolve(recordPath) !== recordPath) throw refuse();
    const relative = recordPath.slice(root.length + 1).replaceAll('\\', '/');
    if (!approvalRelativePattern.test(relative)) throw refuse();
    const trust = JSON.parse(readBounded('scripts/V2BackupApprovalTrust.json', 16384).toString('utf8'));
    trustedReviewerKey(trust); // Default null anchor refuses before reading records/artifacts.
    const bytes = readBounded(relative, 131072);
    const signature = readBounded(relative + '.sig', 64);
    const result = await verifyRecoveryApproval(bytes, signature, trust, inspectEvidenceFile);
    if (basename(relative) !== result.approvalId + '.json') throw refuse();
    // Do not accept an envelope changed during its verification.
    if (!readBounded(relative, 131072).equals(bytes) || !readBounded(relative + '.sig', 64).equals(signature)) throw refuse();
    return result;
  } catch { throw refuse(); }
}
