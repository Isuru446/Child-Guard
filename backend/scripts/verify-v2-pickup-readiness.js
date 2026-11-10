// Read-only V2 development admission. Never deploys migrations or changes roles/data.
import { PrismaClient, Prisma } from '@prisma/client';
import { loadDevelopmentEnvironment } from '../src/development-environment.js';
import { withDatabaseAdmission, assertDatabaseIdentity } from '../src/database-admission.js';
let db;
try {
 const environment=loadDevelopmentEnvironment();
 db=new PrismaClient({datasources:{db:{url:environment.DATABASE_URL}},log:[]});
 const models=['AuthorizedPickupPerson','PickupPhoto','PickupRequest'];
 const clientModels=models.every(name=>Prisma.dmmf.datamodel.models.some(model=>model.name===name));
 await withDatabaseAdmission(db,environment.DATABASE_URL,'development',environment,async()=>{
  const result=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   await assertDatabaseIdentity(tx,'development');
   const [tables]=await tx.$queryRaw`SELECT to_regclass('public."AuthorizedPickupPerson"') IS NOT NULL AS people,
    to_regclass('public."PickupPhoto"') IS NOT NULL AS photos,
    to_regclass('public."PickupRequest"') IS NOT NULL AS requests`;
   const [history]=await tx.$queryRaw`SELECT has_table_privilege(current_user,'public."_prisma_migrations"','SELECT') AS readable`;
   let migration='UNVERIFIED_PERMISSION';
   if(history.readable){
    const rows=await tx.$queryRaw`SELECT finished_at,rolled_back_at FROM public."_prisma_migrations" WHERE migration_name='202610260001_authorized_pickup'`;
    migration=rows.some(row=>row.finished_at&&!row.rolled_back_at)?'DEPLOYED':rows.length?'UNFINISHED_OR_ROLLED_BACK':'PENDING';
   }
   return {database:'childguard_v2',host:'127.0.0.1',port:5432,migration,tables,generatedPrismaModels:clientModels};
  });
  console.log(JSON.stringify(result));
 });
}catch{console.error('Pickup readiness verification refused or unavailable; no deployment performed; details withheld');process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
