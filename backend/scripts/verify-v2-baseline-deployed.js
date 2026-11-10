import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBaselineDeployed } from '../src/baseline-verification.js';
import { createMigrationPrismaClient } from '../src/migration-prisma-client.js';

try {
  const backend = realpathSync('D:/ChildGuard-V2/backend');
  if (backend !== resolve('D:/ChildGuard-V2/backend') || realpathSync(process.cwd()) !== backend || process.argv.length !== 2 ||
      realpathSync(fileURLToPath(import.meta.url)) !== resolve(backend, 'scripts/verify-v2-baseline-deployed.js') ||
      realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..')) !== backend) throw Error();
  await verifyBaselineDeployed(process.env, createMigrationPrismaClient);
  console.log('Development baseline verification PASSED');
} catch {
  console.error('Development baseline verification FAILED; details withheld');
  process.exitCode = 1;
}
