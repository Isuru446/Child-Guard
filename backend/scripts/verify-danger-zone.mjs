// V2-only, guarded READ ONLY inspection. Never selects tokens or credential hashes.
import { PrismaClient } from '@prisma/client';
import { loadDevelopmentEnvironment } from '../src/development-environment.js';
import { withDatabaseAdmission } from '../src/database-admission.js';
import { activeConfiguration, latestObservation } from '../src/beacons.js';
let db;
try {
 const env=loadDevelopmentEnvironment();db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}},log:[]});
 await withDatabaseAdmission(db,env.DATABASE_URL,'development',env,()=>db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const device=await tx.device.findUnique({where:{hardwareId:'CG-WEARABLE-001'},select:{id:true,hardwareId:true,centerId:true,active:true,lastSeen:true}});
  if(!device){console.log(JSON.stringify({deviceFound:false}));return;}
  const beacons=await tx.beacon.findMany({where:{centerId:device.centerId},select:{id:true,hardwareId:true,kind:true,serviceUuid:true,active:true,entryRssi:true,exitRssi:true,attendanceRssi:true}});
  let configuration;try{configuration=await activeConfiguration(tx,device.centerId);}catch(error){configuration={error:error.code||'CONFIG_UNAVAILABLE'};}
  const observations=[];
  for(const b of beacons){
   const latest=await latestObservation(tx,{beaconId:b.id,deviceId:device.id,...(b.kind==='DANGER_ZONE'?{payload:{path:['beaconUuid'],equals:b.serviceUuid}}:{})});
   const count=await tx.deviceEvent.count({where:{deviceId:device.id,beaconId:b.id,eventType:'BLE_PROXIMITY'}});
   observations.push({beaconId:b.hardwareId,storedProximityCount:count,latest:latest?{observedAt:latest.observedAt,receivedAt:latest.receivedAt,proximity:latest.payload?.proximity,rssi:latest.payload?.rssi??null,uuid:latest.payload?.beaconUuid??null}:null});
  }
  const recent=await tx.deviceEvent.findMany({where:{deviceId:device.id},select:{eventType:true,receivedAt:true,beacon:{select:{hardwareId:true}}},orderBy:{receivedAt:'desc'},take:8});
  console.log(JSON.stringify({device:{hardwareId:device.hardwareId,active:device.active,lastSeen:device.lastSeen},beacons,configuration,configurationResponseBytes:Buffer.byteLength(JSON.stringify({data:configuration})),observations,recent},null,2));
 }));
}catch{console.error('Guarded read-only beacon verification refused/unavailable; details withheld.');process.exitCode=1;}
finally{await db?.$disconnect().catch(()=>{});}
