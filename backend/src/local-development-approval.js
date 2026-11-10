// Local owner review only; not independent or production authorization. No I/O.
import { createHash } from 'node:crypto';
import { baseline } from './baseline-manifest.js';
import { developmentIdentity, approvalBytes } from './backup-approval.js';

export const recoveryChecklist = Object.freeze([
  'V2_SOURCE_IDENTITY_REVIEWED', 'ARCHIVE_LIST_AND_CONTENTS_REVIEWED',
  'EMPTY_TARGET_CONFIRMED', 'V2_ONLY_RECOVERY_PLAN_REVIEWED',
  'NO_AUTOMATIC_RESTORE_OR_RESET', 'RESTORE_REQUIRES_SEPARATE_APPROVAL',
]);
const refuse = () => Error('Local development backup evidence refused; details withheld');
const need = v => { if (!v) throw refuse(); };
const equal = (a, b) => approvalBytes(a).equals(approvalBytes(b));
const keys = (v, expected) => need(v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...expected].sort()));
const time = v => { need(typeof v === 'string'); const t = Date.parse(v); need(Number.isFinite(t) && new Date(t).toISOString() === v); return t; };
export async function verifyLocalDevelopmentApproval(bytes, inspect, now = Date.now) {
  try {
    need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 131072);
    const r = JSON.parse(bytes.toString('utf8'));
    need(approvalBytes(r).equals(bytes));
    keys(r, ['schemaVersion', 'purpose', 'target', 'baselineHashes', 'backup', 'inspection', 'recoveryPlan', 'review']);
    need(r.schemaVersion === 1 && r.purpose === 'LOCAL_DEVELOPMENT_ONLY' && equal(r.target, developmentIdentity));
    need(equal(r.baselineHashes, baseline.hashes));
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    for (const [item, prefix, extension] of [[r.backup, 'baseline', 'dump'], [r.recoveryPlan, 'recovery', 'md']]) {
      keys(item, ['relativePath', 'size', 'sha256']);
      need(typeof item.relativePath === 'string' && new RegExp(`^private-backups/childguard-v2/${prefix}-${uuid}\\.${extension}$`).test(item.relativePath));
      need(Number.isSafeInteger(item.size) && item.size > 0 && typeof item.sha256 === 'string' && /^[A-F0-9]{64}$/.test(item.sha256));
    }
    keys(r.inspection, ['source', 'createdAt', 'inspectedAt', 'archiveListPassed', 'archiveContentsPassed', 'applicationObjects', 'migrationLedgerExists']);
    need(equal(r.inspection.source, developmentIdentity) && r.inspection.archiveListPassed === true && r.inspection.archiveContentsPassed === true &&
      r.inspection.applicationObjects === 0 && r.inspection.migrationLedgerExists === false);
    keys(r.review, ['owner', 'reviewedAt', 'expiresAt', 'checklist']);
    need(typeof r.review.owner === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,63}$/.test(r.review.owner));
    need(equal(r.review.checklist, Object.fromEntries(recoveryChecklist.map(k => [k, true]))));
    const created = time(r.inspection.createdAt), inspected = time(r.inspection.inspectedAt), reviewed = time(r.review.reviewedAt), expires = time(r.review.expiresAt);
    need(created <= inspected && inspected <= reviewed && expires > reviewed && expires - reviewed <= 4 * 3600000);
    const checkTime = () => { const t = now(); need(Number.isSafeInteger(t) && reviewed <= t && t < expires && t - created <= 86400000); };
    checkTime();
    for (const [p, h] of Object.entries(baseline.hashes)) {
      const a = await inspect('backend/' + p); need(a?.regular === true && a.links === 1 && a.sha256 === h);
    }
    for (const item of [r.backup, r.recoveryPlan]) {
      const a = await inspect(item.relativePath);
      need(a?.regular === true && a.links === 1 && a.size === item.size && a.sha256 === item.sha256);
      if (item === r.backup) need(a.customArchive === true);
    }
    checkTime();
    return createHash('sha256').update(bytes).digest('hex').toUpperCase();
  } catch { throw refuse(); }
}
