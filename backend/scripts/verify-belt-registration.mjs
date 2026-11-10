// Read-only V2 admission; never prints connection strings, tokens or hashes.
import { PrismaClient } from '@prisma/client';
import { loadDevelopmentEnvironment } from '../src/development-environment.js';
import { withDatabaseAdmission } from '../src/database-admission.js';
let db;
try {
 const environment=loadDevelopmentEnvironment();
 db=new PrismaClient({datasources:{db:{url:environment.DATABASE_URL}},log:[]});
 await withDatabaseAdmission(db,environment.DATABASE_URL,'development',environment,()=>db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const device=await tx.device.findUnique({where:{hardwareId:'CG-WEARABLE-001'},select:{id:true,hardwareId:true,centerId:true,active:true}});
  if(!device){console.log(JSON.stringify({deviceFound:false}));return;}
  const gates=await tx.beacon.findMany({where:{centerId:device.centerId,kind:'GATE'},select:{hardwareId:true,serviceUuid:true,active:true}});
  const reserved=await tx.beacon.findMany({where:{OR:[{hardwareId:'CG-GATE-01'},{serviceUuid:'7b700001-24a6-4a25-9d3b-21c547a10001'}]},select:{centerId:true,kind:true,active:true}});
  const assignments=await tx.assignment.findMany({where:{deviceId:device.id,endedAt:null},select:{child:{select:{name:true,centerId:true,guardians:{select:{userId:true}}}}}});
  console.log(JSON.stringify({device,registrationEnabled:environment.ENABLE_REGISTRATION==='true',gates,reservedIdentityRecords:reserved.map(b=>({sameCenter:b.centerId===device.centerId,kind:b.kind,active:b.active})),activeAssignments:assignments.map(a=>({child:a.child.name,sameCenter:a.child.centerId===device.centerId,guardianCount:a.child.guardians.length}))},null,2));
 }));
} catch {
 console.error('Read-only V2 verification refused or unavailable; connection details withheld.');process.exitCode=1;
} finally {await db?.$disconnect().catch(()=>{});}
