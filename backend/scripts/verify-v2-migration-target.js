import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMigrationTarget } from '../src/migration-admission.js';
import { createMigrationPrismaClient } from '../src/migration-prisma-client.js';

// Read-only entry point. No dotenv loader, CLI spawning or deployment branch.
try {
  const backend = realpathSync('D:/ChildGuard-V2/backend');
  if (backend !== resolve('D:/ChildGuard-V2/backend') || realpathSync(process.cwd()) !== backend ||
      realpathSync(fileURLToPath(import.meta.url)) !== resolve(backend, 'scripts/verify-v2-migration-target.js') ||
      realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..')) !== backend ||
      process.argv.length !== 3) throw new Error();
  await verifyMigrationTarget(process.argv[2], process.env, createMigrationPrismaClient);
  console.log('Migration preflight PASSED; empty target verified; no deployment performed');
} catch {
  console.error('Migration preflight FAILED; details withheld');
  process.exitCode = 1;
}
