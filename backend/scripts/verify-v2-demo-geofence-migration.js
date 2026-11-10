// Read-only when manually invoked. Never run automatically by stage preparation.
import { validateMigrationEnvironment,assertMigrationIdentity } from '../src/migration-admission.js';
import { createMigrationPrismaClient } from '../src/migration-prisma-client.js';
import { demoMigrationName,demoHashes,originalMigrationHashes } from '../src/demo-migration-stage.js';
import { baseline } from '../src/baseline-manifest.js';
let db;
try{
 const phase=process.argv[2];if(process.cwd()!=='D:\\ChildGuard-V2'||process.argv.length!==3||!['before','after'].includes(phase))throw Error();
 const url=validateMigrationEnvironment('development',process.env);db=createMigrationPrismaClient(url);await assertMigrationIdentity(db,'development');
 const rows=await db.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name`;
 const expected=Object.fromEntries(Object.entries(originalMigrationHashes).map(([p,h])=>[p.split('/')[2],h]));if(phase==='after')expected[demoMigrationName]=demoHashes.sql;
 if(rows.length!==Object.keys(expected).length||new Set(rows.map(r=>r.migration_name)).size!==rows.length||rows.some(r=>!r.finished_at||r.rolled_back_at||r.checksum.toUpperCase()!==expected[r.migration_name]))throw Error();
 const tables=await db.$queryRaw`SELECT c.relname,pg_get_userbyid(c.relowner)::text AS owner,has_table_privilege('childguard_v2_app',c.oid,'SELECT') AS read,has_table_privilege('childguard_v2_app',c.oid,'INSERT') AS insert,has_table_privilege('childguard_v2_app',c.oid,'UPDATE') AS update,has_table_privilege('childguard_v2_app',c.oid,'DELETE') AS delete FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('SafeZone','GeofenceState','GeofenceReading') AND c.relkind='r'`;
 if(phase==='before'?tables.length!==0:tables.length!==3||tables.some(t=>t.owner!=='childguard_v2_migrator'||!t.read||!t.insert||t.delete||t.update!==(t.relname!=='GeofenceReading')))throw Error();
 const inventory=await db.$queryRaw`SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`;
 const wanted=[...baseline.tables,'AuthSession','_prisma_migrations',...(phase==='after'?['SafeZone','GeofenceState','GeofenceReading']:[])].sort();if(JSON.stringify(inventory.map(r=>r.relname).sort())!==JSON.stringify(wanted))throw Error();
 if(phase==='after'){
  const constraints=await db.$queryRaw`SELECT t.relname::text AS relname,c.contype::text AS contype,count(*)::int AS count,bool_and(c.convalidated AND NOT c.condeferrable) AS valid FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('SafeZone','GeofenceState','GeofenceReading') AND c.contype IN ('p','u','f','c') GROUP BY t.relname,c.contype`;
  const want={SafeZone:{p:1,u:1,f:1,c:5},GeofenceState:{p:1,f:2,c:1},GeofenceReading:{p:1,f:2,c:3}};
  if(constraints.length!==Object.values(want).reduce((n,v)=>n+Object.keys(v).length,0)||constraints.some(c=>!c.valid||want[c.relname]?.[c.contype]!==c.count))throw Error();
 }
 const [counts]=await db.$queryRaw`SELECT (SELECT count(*)::int FROM public."User") AS users,(SELECT count(*)::int FROM public."Center") AS centers,(SELECT count(*)::int FROM public."Child") AS children,(SELECT count(*)::int FROM public."Device") AS devices,(SELECT count(*)::int FROM public."Assignment") AS assignments`;
 console.log('V2 demo migration '+phase+' verification PASSED');console.log(JSON.stringify(counts));
}catch{console.error('V2 demo migration verification FAILED; details withheld');process.exitCode=1;}finally{await db?.$disconnect().catch(()=>{});}
