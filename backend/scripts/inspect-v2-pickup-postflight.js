// Catalog inspection only; application admission, READ ONLY, no role/history escalation.
import {PrismaClient} from '@prisma/client';
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
import {withDatabaseAdmission,assertDatabaseIdentity} from '../src/database-admission.js';
import {verifyPickupCatalog} from '../src/pickup-catalog-policy.js';
let db;
try {
 const env=loadDevelopmentEnvironment();
 db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 await withDatabaseAdmission(db,env.DATABASE_URL,'development',env,async()=>{
  const evidence=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   await assertDatabaseIdentity(tx,'development');
   const tables=await tx.$queryRaw`SELECT c.relname,pg_get_userbyid(c.relowner)::text AS owner,
    has_table_privilege('childguard_v2_app',c.oid,'SELECT') AS read,
    has_table_privilege('childguard_v2_app',c.oid,'INSERT') AS insert,
    has_table_privilege('childguard_v2_app',c.oid,'UPDATE') AS update,
    has_table_privilege('childguard_v2_app',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excess
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest') ORDER BY c.relname`;
   const constraints=await tx.$queryRaw`SELECT c.relname,k.conname,k.contype::text AS type,k.convalidated,k.condeferrable,
    pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest') ORDER BY c.relname,k.conname`;
   const indexes=await tx.$queryRaw`SELECT c.relname,ic.relname AS name,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest') ORDER BY c.relname,ic.relname`;
   const grants=await tx.$queryRaw`SELECT c.relname,a.grantee::text AS grantee_oid,pg_get_userbyid(a.grantee)::text AS grantee,
    a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest')
    ORDER BY c.relname,a.grantee,a.privilege_type`;
   const columnGrants=await tx.$queryRaw`SELECT c.relname,a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('PickupPhoto','AuthorizedPickupPerson','PickupRequest')
    AND a.attnum>0 AND a.attacl IS NOT NULL`;
   const [history]=await tx.$queryRaw`SELECT has_table_privilege(current_user,'public."_prisma_migrations"','SELECT') AS readable`;
   return {observedAt:new Date().toISOString(),database:'childguard_v2',host:'127.0.0.1',port:5432,tables,constraints,indexes,grants,columnGrants,ledgerReadable:history.readable};
  });
  console.log(JSON.stringify({summary:verifyPickupCatalog(evidence),...evidence},null,2));
 });
}catch(error){console.error(error.message?.startsWith('Pickup catalog refused:')?error.message:'Read-only Pickup catalog inspection refused; no changes performed');process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
