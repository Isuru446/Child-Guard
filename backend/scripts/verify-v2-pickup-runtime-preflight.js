// Read-only catalog/activity checks through existing V2 application admission.
// Does not inspect passwords, business rows or privileged migration history.
import {PrismaClient} from '@prisma/client';
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
import {withDatabaseAdmission,assertDatabaseIdentity} from '../src/database-admission.js';
let db;
try {
 const environment=loadDevelopmentEnvironment();
 db=new PrismaClient({datasources:{db:{url:environment.DATABASE_URL}},log:[]});
 await withDatabaseAdmission(db,environment.DATABASE_URL,'development',environment,async()=>{
  const result=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   await assertDatabaseIdentity(tx,'development');
   const roles=await tx.$queryRaw`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege(rolname,'public','CREATE') AS create,
    EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
    FROM pg_roles r WHERE rolname='childguard_v2_migrator'`;
   if(roles.length!==1||Object.values(roles[0]).some(value=>value!==false))throw Error();
   const [activity]=await tx.$queryRaw`SELECT
    count(*) FILTER(WHERE usename='childguard_v2_migrator')::int AS migrator_sessions,
    count(*) FILTER(WHERE state='active' AND query ~* '(prisma_migrations|pg_advisory|CREATE[[:space:]]|ALTER[[:space:]]|DROP[[:space:]])')::int AS migration_activity,
    count(*) FILTER(WHERE state IS NULL AND backend_type='client backend')::int AS opaque_sessions
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`;
   const [locks]=await tx.$queryRaw`SELECT count(*)::int AS advisory_locks FROM pg_locks
    WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
   return {database:'childguard_v2',host:'127.0.0.1',port:5432,migratorLocked:true,...activity,...locks};
  });
  console.log(JSON.stringify(result));
  if(result.migrator_sessions||result.migration_activity||result.opaque_sessions||result.advisory_locks)throw Error();
 });
}catch{console.error('Pickup runtime preflight refused or competing activity cannot be excluded; no changes made.');process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
