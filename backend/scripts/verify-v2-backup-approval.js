import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStoredRecoveryApproval } from '../src/backup-approval-files.js';

try {
  const root = resolve('D:/ChildGuard-V2');
  if (process.argv.length !== 3 || realpathSync.native(process.cwd()) !== root ||
      realpathSync.native(fileURLToPath(import.meta.url)) !== resolve(root, 'backend/scripts/verify-v2-backup-approval.js')) throw Error();
  const proof = await verifyStoredRecoveryApproval(process.argv[2]);
  console.log('RECOVERY_EVIDENCE_ACCEPTED ' + proof.approvalSha256);
} catch {
  console.error('Recovery approval refused; details withheld');
  process.exitCode = 1;
}
