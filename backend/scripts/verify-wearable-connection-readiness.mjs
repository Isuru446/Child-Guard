// Metadata-only readiness. Never starts the monitor or writes alerts/lastSeen.
import {PrismaClient,Prisma} from '@prisma/client';
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
import {withDatabaseAdmission,assertDatabaseIdentity} from '../src/database-admission.js';
let db,step='CONFIGURATION';
try{
 const env=loadDevelopmentEnvironment();db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 await withDatabaseAdmission(db,env.DATABASE_URL,'development',env,async()=>{
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;await assertDatabaseIdentity(tx,'development');
   step='CONNECTION_STORAGE';
   const [row]=await tx.$queryRaw`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Alert' AND column_name='kind' AND data_type='text') AS text_kind,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Device' AND column_name='lastSeen' AND data_type='timestamp with time zone') AS last_seen,
    EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid WHERE i.indrelid='public."Alert"'::regclass AND a.attname='activityDedupKey' AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indkey::text=a.attnum::text) AS unique_episode,
    (has_table_privilege(current_user,'public."Alert"','SELECT') AND has_table_privilege(current_user,'public."Alert"','INSERT')) AS alerts,
    (has_table_privilege(current_user,'public."Device"','SELECT') AND has_table_privilege(current_user,'public."Device"','UPDATE')) AS devices,
    (has_table_privilege(current_user,'public."AuditLog"','SELECT') AND has_table_privilege(current_user,'public."AuditLog"','INSERT')) AS checks`;
   if(!row.text_kind||!row.last_seen||!row.unique_episode||!row.alerts||!row.devices||!row.checks)throw Error();
   if(Prisma.dmmf.datamodel.models.length!==31)throw Error();
   console.log(JSON.stringify({database:'childguard_v2',storage:true,uniqueEpisodeIndex:true,models:31,migrationRequired:false,businessRecordsRead:false,recordsWritten:false,monitorStarted:false}));
  });
 });
}catch{console.error(JSON.stringify({check:'wearable-connection-readiness',step,cause:'REFUSED_OR_UNAVAILABLE',recordsWritten:false}));process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
