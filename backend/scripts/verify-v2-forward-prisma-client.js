import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyForwardPrismaClient } from '../src/verify-forward-prisma-client.js';
try {
  const root=resolve('D:/ChildGuard-V2');
  if(process.argv.length!==2||![root,resolve(root,'backend')].includes(realpathSync.native(process.cwd()))||
      realpathSync.native(fileURLToPath(import.meta.url))!==resolve(root,'backend/scripts/verify-v2-forward-prisma-client.js'))throw Error();
  const result=verifyForwardPrismaClient();
  console.log('Forward Prisma Client '+result.clientVersion+' PASSED; '+result.models.length+' models; User.authVersion verified');
} catch {
  console.error('Forward Prisma Client integrity FAILED; details withheld');
  process.exitCode=1;
}
