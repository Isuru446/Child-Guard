// Read-only forward pre/post checks. Never loads .env, executes migration SQL or changes roles.
import { resolve } from 'node:path';
import { validateMigrationEnvironment, assertMigrationIdentity } from '../src/migration-admission.js';
import { createMigrationPrismaClient } from '../src/migration-prisma-client.js';
import { comparePickupLedger, verifyPickupStage, verifyPickupBackup } from '../src/pickup-preparation.js';
let db;
try {
 const phase=process.argv[2],stage=process.argv[3];
 if(process.cwd()!==resolve('D:/ChildGuard-V2')||process.argv.length!==4||!['before','after'].includes(phase))throw Error();
 verifyPickupStage(resolve(stage));
 const backup=verifyPickupBackup(); // Read-only; intentionally refuses unavailable/changed protected archive.
 const url=validateMigrationEnvironment('development',process.env);
 db=createMigrationPrismaClient(url);
 await assertMigrationIdentity(db,'development');
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  await assertMigrationIdentity(tx,'development');
  const rows=await tx.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM public."_prisma_migrations" ORDER BY migration_name`;
  const ledger=comparePickupLedger(rows,{after:phase==='after'});
  const tables=await tx.$queryRaw`SELECT c.relname,pg_get_userbyid(c.relowner)::text AS owner,
   has_table_privilege('childguard_v2_app',c.oid,'SELECT') AS read,
   has_table_privilege('childguard_v2_app',c.oid,'INSERT') AS insert,
   has_table_privilege('childguard_v2_app',c.oid,'UPDATE') AS update,
   has_table_privilege('childguard_v2_app',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excess
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
   AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest')`;
  if(phase==='before'){if(tables.length)throw Error();}
  else{
   if(tables.length!==3||tables.some(t=>t.owner!=='childguard_v2_migrator'||!t.read||!t.insert||t.excess||t.update!==(t.relname!=='PickupPhoto')))throw Error();
   const [constraints]=await tx.$queryRaw`SELECT count(*)::int AS count,bool_and(k.convalidated AND NOT k.condeferrable) AS valid FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest') AND k.contype <> 'n'`;
   const [indexes]=await tx.$queryRaw`SELECT count(*)::int AS count,bool_and(i.indisvalid) AS valid FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest')`;
   const grants=await tx.$queryRaw`SELECT a.grantee FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest') AND a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_roles WHERE rolname='childguard_v2_app'))`;
   if(constraints.count!==22||!constraints.valid||indexes.count!==9||!indexes.valid||grants.length)throw Error();
  }
  return {phase,ledger,tables:tables.length,backup:{size:backup.size,sha256:backup.sha256}};
 });
 console.log(JSON.stringify(result));
}catch{console.error('Pickup forward verification refused; details withheld. No deployment or automatic recovery performed.');process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
