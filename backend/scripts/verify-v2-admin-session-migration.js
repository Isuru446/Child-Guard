// Read-only PostgreSQL verification; before-mode creates only private FILE evidence.
// Never deploys, loads runtime .env or prints preservation fingerprints/credentials.
import { lstatSync, realpathSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { baseline } from '../src/baseline-manifest.js';
import { adminForwardHashes } from '../src/admin-session-forward-manifest.js';
import { validateMigrationEnvironment } from '../src/migration-admission.js';
import { createMigrationPrismaClient } from '../src/migration-prisma-client.js';
import { inspectAdminForwardMigration } from '../src/admin-session-migration-readiness.js';

const root='D:\\ChildGuard-V2', backend=root+'\\backend';
let db,passed=false;
function regular(path, directory=false) {
  if(resolve(path)!==path||!(path===root||path.startsWith(root+'\\')))throw Error();
  const rootStat=lstatSync(root);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory()||realpathSync.native(root)!==root)throw Error();
  let part=root;
  for(const name of path.slice(root.length+1).split('\\').filter(Boolean)) {
    part=resolve(part,name);if(lstatSync(part).isSymbolicLink())throw Error();
  }
  if(realpathSync.native(path)!==path)throw Error();
  const st=lstatSync(path);if(directory?!st.isDirectory():!st.isFile()||st.nlink!==1)throw Error();
}
try {
  const [phase,evidencePath]=process.argv.slice(2);
  if(process.argv.length!==4||!['before','after'].includes(phase)||process.cwd()!==backend||realpathSync.native(process.cwd())!==backend||
      realpathSync.native(fileURLToPath(import.meta.url))!==backend+'\\scripts\\verify-v2-admin-session-migration.js'||
      !/^D:\\ChildGuard-V2\\private-backups\\childguard-v2\\wp02-preservation-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(evidencePath||''))throw Error();
  regular(resolve(evidencePath,'..'),true);
  const hashes={...baseline.hashes,...adminForwardHashes};
  for(const [relative,expected] of Object.entries(hashes)) {
    const path=resolve(backend,relative);regular(path);
    if(createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()!==expected)throw Error();
  }
  const migrationRoot=backend+'\\prisma\\migrations';regular(migrationRoot,true);
  const dirs=Object.keys(hashes).filter(p=>p.endsWith('/migration.sql')).map(p=>p.split('/')[2]);
  if(JSON.stringify(readdirSync(migrationRoot).sort())!==JSON.stringify([...dirs,'migration_lock.toml'].sort()))throw Error();
  for(const name of dirs) {regular(resolve(migrationRoot,name),true);if(JSON.stringify(readdirSync(resolve(migrationRoot,name)))!=='["migration.sql"]')throw Error();}
  if(JSON.stringify(readdirSync(backend+'\\prisma').sort())!=='["migrations","schema.prisma"]')throw Error();
  const relative='prisma/migrations/202610250001_admin_session_foundation/migration.sql';
  const checksum=hashes[relative];
  const sql=readFileSync(resolve(backend,relative),'utf8');
  const functionSource=/CREATE FUNCTION public\.childguard_invalidate_admin_sessions\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(sql)?.[1];
  if(!functionSource)throw Error();
  let evidence;
  if(phase==='after') {
    regular(evidencePath);if(lstatSync(evidencePath).size>16384)throw Error();
    evidence=JSON.parse(readFileSync(evidencePath,'utf8'));
    if(evidence.database!=='childguard_v2'||evidence.checksum!==checksum||evidence.schema!==hashes['prisma/schema.prisma']||
        !Number.isSafeInteger(evidence.createdAt)||Date.now()<evidence.createdAt||Date.now()-evidence.createdAt>14400000)throw Error();
  }
  const url=validateMigrationEnvironment('development',process.env);
  db=createMigrationPrismaClient(url);
  const snapshot=await inspectAdminForwardMigration(db,{phase,checksum,functionSource,before:evidence?.snapshot});
  if(phase==='before')writeFileSync(evidencePath,JSON.stringify({database:'childguard_v2',checksum,schema:hashes['prisma/schema.prisma'],createdAt:Date.now(),snapshot}),{flag:'wx',mode:0o600});
  passed=true;
} catch { passed=false; }
finally {if(db){try{await db.$disconnect();}catch{passed=false;}}}
console.log('V2 Admin forward verification '+(passed?'PASSED':'FAILED'));
if(!passed)process.exitCode=1;
