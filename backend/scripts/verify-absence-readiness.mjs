// Owner-run, read-only normal runtime admission. No migration history access or writes.
import {realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrismaClient,Prisma} from '@prisma/client';
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
import {withDatabaseAdmission,assertDatabaseIdentity} from '../src/database-admission.js';
import {absenceAvailable} from '../src/attendance-absence.js';
let db,step='WORKING_DIRECTORY';
try{
 const backend=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 if(realpathSync(process.cwd())!==realpathSync(backend))throw Object.assign(new Error(),{code:'BACKEND_WORKING_DIRECTORY_REQUIRED'});
 step='CONFIGURATION';
 const env=loadDevelopmentEnvironment();step='CLIENT_CONSTRUCTION';db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 step='DATABASE_ADMISSION';
 await withDatabaseAdmission(db,env.DATABASE_URL,'development',env,async()=>{
  step='READ_ONLY_TRANSACTION';
  const result=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;step='DATABASE_IDENTITY';await assertDatabaseIdentity(tx,'development');
   step='ATTENDANCE_ENUM_READ';
   const labels=await tx.$queryRaw`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='AttendanceStatus' ORDER BY e.enumsortorder`;
   step='CLIENT_MODEL_METADATA';
   const models=Prisma.dmmf.datamodel.models.map(m=>m.name);
   step='PICKUP_TABLES';
   const [pickup]=await tx.$queryRaw`SELECT to_regclass('public."AuthorizedPickupPerson"') IS NOT NULL AND to_regclass('public."PickupPhoto"') IS NOT NULL AND to_regclass('public."PickupRequest"') IS NOT NULL AS available`;
   step='ATTENDANCE_READ';
   await tx.attendance.count(); // Confirms normal application attendance reads remain permitted.
   return {database:'childguard_v2',host:'127.0.0.1',port:5432,models:models.length,pickup:pickup.available,enumValues:labels.map(l=>l.enumlabel)};
  });
  step='ABSENCE_AVAILABILITY';
  const ready=await absenceAvailable(db);console.log(JSON.stringify({...result,absenceReady:ready}));
  step='READINESS_ASSERTIONS';
  if(!ready)throw Object.assign(new Error(),{code:'ABSENCE_UNAVAILABLE'});
  if(result.models!==31)throw Object.assign(new Error(),{code:'MODEL_COUNT_MISMATCH'});
  if(!result.pickup)throw Object.assign(new Error(),{code:'PICKUP_STORAGE_UNAVAILABLE'});
 });
}catch(error){
 const allowed=new Set(['BACKEND_WORKING_DIRECTORY_REQUIRED','ABSENCE_UNAVAILABLE','MODEL_COUNT_MISMATCH','PICKUP_STORAGE_UNAVAILABLE','P1000','P1001','P1002','P1010','P2021','P2022']);
 const cause=allowed.has(error?.code)?error.code:'REFUSED_OR_UNAVAILABLE';
 console.error(JSON.stringify({check:'absence-readiness',step,cause,databaseChanged:false,...(cause==='BACKEND_WORKING_DIRECTORY_REQUIRED'?{instruction:'Set-Location D:/ChildGuard-V2/backend; node scripts/verify-absence-readiness.mjs'}:{})}));
 process.exitCode=1;
}
finally{await db?.$disconnect().catch(()=>{});}
