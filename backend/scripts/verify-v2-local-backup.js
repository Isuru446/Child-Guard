import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalRecoveryRecord, inspectEvidenceFile } from '../src/backup-approval-files.js';
import { verifyLocalDevelopmentApproval } from '../src/local-development-approval.js';
try {
  const root = resolve('D:/ChildGuard-V2');
  if (process.argv.length !== 3 || realpathSync.native(process.cwd()) !== root ||
      realpathSync.native(fileURLToPath(import.meta.url)) !== resolve(root, 'backend/scripts/verify-v2-local-backup.js')) throw Error();
  const bytes = readLocalRecoveryRecord(process.argv[2]);
  const digest = await verifyLocalDevelopmentApproval(bytes, inspectEvidenceFile);
  if (!readLocalRecoveryRecord(process.argv[2]).equals(bytes)) throw Error();
  console.log('LOCAL_RECOVERY_EVIDENCE_VERIFIED ' + digest);
} catch {
  console.error('Local development backup evidence refused; details withheld');
  process.exitCode = 1;
}
