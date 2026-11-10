// Read-only metadata and EXPLAIN (without ANALYZE). No alerts are acknowledged or manufactured.
import {PrismaClient,Prisma} from '@prisma/client';
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
import {withDatabaseAdmission,assertDatabaseIdentity} from '../src/database-admission.js';
import {dangerGroupIds} from '../src/teacher-alert-checks.js';
let db,step='CONFIGURATION';
try{
 const env=loadDevelopmentEnvironment();db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 step='DATABASE_ADMISSION';
 await withDatabaseAdmission(db,env.DATABASE_URL,'development',env,async()=>{
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;await assertDatabaseIdentity(tx,'development');
   step='AUDIT_STORAGE';
   const columns=await tx.$queryRaw`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='AuditLog'`;
   if(['id','userId','resourceId','action'].some(name=>!columns.some(c=>c.column_name===name&&c.data_type==='text'))||!columns.some(c=>c.column_name==='createdAt'&&c.data_type==='timestamp with time zone'))throw Error();
   const [privilege]=await tx.$queryRaw`SELECT has_table_privilege(current_user,'public."AuditLog"','SELECT') AS readable,has_table_privilege(current_user,'public."AuditLog"','INSERT') AS insertable,
    EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid='public."AuditLog"'::regclass AND k.contype='p' AND k.convalidated AND k.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=k.conrelid AND attname='id')]::smallint[]) AS primary_key`;
   if(!privilege.readable||!privilege.insertable||!privilege.primary_key)throw Error();
   step='GROUP_QUERY_PLAN';
   // Compile the exact production query with non-user constants. EXPLAIN never executes it.
   const explain={$queryRaw:(strings,...values)=>tx.$queryRaw(Prisma.sql`EXPLAIN ${Prisma.sql(strings,...values)}`)};
   await dangerGroupIds(explain,{id:'readiness-only',centerId:'readiness-only'},{limit:1,offset:0});
   console.log(JSON.stringify({database:'childguard_v2',host:'127.0.0.1',port:5432,auditStorage:true,existingPrimaryKey:true,groupQueryPlan:true,modelCount:Prisma.dmmf.datamodel.models.length,recordsRead:false,recordsWritten:false,migrationRequired:false}));
  });
 });
}catch{console.error(JSON.stringify({check:'teacher-alert-check-readiness',step,cause:'REFUSED_OR_UNAVAILABLE',recordsWritten:false}));process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
