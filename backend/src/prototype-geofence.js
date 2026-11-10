import { randomUUID } from 'node:crypto';
import { evaluateGeofenceReview, zoneLimits, validateCircle } from './geofence-foundation.js';
import { prototypeGpsEvidence } from './prototype-gps.js';
const refuse=(status,code,message)=>Object.assign(Error(message),{status,code});
export async function geofenceInstalled(db){
 const [r]=await db.$queryRaw`SELECT to_regclass('public."SafeZone"') IS NOT NULL AND to_regclass('public."GeofenceState"') IS NOT NULL AND to_regclass('public."GeofenceReading"') IS NOT NULL AS installed`;
 return r?.installed===true;
}
export async function readPrototypeZones(db,centerId){
 if(!await geofenceInstalled(db))return {configurationAvailable:false,monitoringAvailable:false,zones:null,limits:zoneLimits,reason:'MIGRATION_REQUIRED'};
 const zones=await db.$queryRaw`SELECT * FROM public."SafeZone" WHERE "centerId"=${centerId} ORDER BY "id" LIMIT 1`;
 const readings=await db.$queryRaw`SELECT r.*, e."receivedAt", e."childId", c.name AS "childName", d."hardwareId", CASE WHEN z.active AND r."zoneRevision"=z.revision AND r."observedAt"<=clock_timestamp() AND r."observedAt">=clock_timestamp()-interval '30 seconds' THEN r.state ELSE 'UNKNOWN' END AS "currentState" FROM public."GeofenceReading" r JOIN public."SafeZone" z ON z.id=r."zoneId" JOIN public."DeviceEvent" e ON e.id=r."eventId" JOIN public."Device" d ON d.id=e."deviceId" LEFT JOIN public."Child" c ON c.id=e."childId" AND c."centerId"=z."centerId" WHERE z."centerId"=${centerId} AND d."centerId"=${centerId} AND (e."childId" IS NULL OR c.id IS NOT NULL) ORDER BY r."createdAt" DESC LIMIT 50`;
 const seen=new Set();const records=readings.map(r=>{const old=seen.has(r.hardwareId);seen.add(r.hardwareId);return {...r,currentState:old?'UNKNOWN':r.currentState};});
 return {configurationAvailable:true,monitoringAvailable:zones[0]?.active===true,zones,readings:records,limits:zoneLimits,reason:'CLASSROOM_PROTOTYPE_FRESH_GNSS_ONLY'};
}
export async function savePrototypeZone(db,req,body){
 if(!await geofenceInstalled(db))throw refuse(503,'GEOFENCE_UNAVAILABLE','Geofence migration has not been installed');
 if(!body||typeof body!=='object'||Array.isArray(body))throw refuse(422,'VALIDATION_ERROR','Expected zone configuration');
 const {revision,...fields}=body;let circle;try{circle=validateCircle(fields);}catch{throw refuse(422,'VALIDATION_ERROR','Check zone name, coordinates, radius and status');}
 if(!Number.isInteger(revision)||revision<0)throw refuse(422,'VALIDATION_ERROR','A current configuration revision is required');
 return db.$transaction(async tx=>{
  const centerId=req.user.centerId;
  await tx.$queryRaw`SELECT id FROM public."Center" WHERE id=${centerId} FOR UPDATE`;
  const [old]=await tx.$queryRaw`SELECT * FROM public."SafeZone" WHERE "centerId"=${centerId} FOR UPDATE`;
  if((old?.revision??0)!==revision)throw refuse(409,'ZONE_CHANGED','Reload the current zone before saving');
  const id=old?.id??randomUUID();
  const [zone]=await tx.$queryRaw`INSERT INTO public."SafeZone" (id,"centerId",name,latitude,longitude,"radiusM",active,revision,"effectiveAt","createdAt","updatedAt") VALUES (${id},${centerId},${circle.name},${circle.latitude},${circle.longitude},${circle.radiusM},${circle.active},1,clock_timestamp(),clock_timestamp(),clock_timestamp()) ON CONFLICT ("centerId") DO UPDATE SET name=EXCLUDED.name,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,"radiusM"=EXCLUDED."radiusM",active=EXCLUDED.active,revision="SafeZone".revision+1,"effectiveAt"=clock_timestamp(),"updatedAt"=clock_timestamp() RETURNING *`;
  await tx.auditLog.create({data:{userId:req.user.id,resourceId:id,action:'SAFE_ZONE_CONFIG:'+JSON.stringify({before:old??null,after:zone})}});
  return zone;
 },{isolationLevel:'Serializable'});
}
// Called ONLY inside existing authenticated, Device-locked ingestion transaction.
export async function recordPrototypeGeofence(tx,{device,payload,event,assignment,now}){
 if(!await geofenceInstalled(tx))return {state:'UNKNOWN',reason:'MIGRATION_REQUIRED'};
 const [zone]=await tx.$queryRaw`SELECT * FROM public."SafeZone" WHERE "centerId"=${device.centerId} FOR UPDATE`;
 if(!zone)return {state:'UNKNOWN',reason:'NO_ZONE_CONFIGURED'};
 const [stored]=await tx.$queryRaw`SELECT checkpoint FROM public."GeofenceState" WHERE "zoneId"=${zone.id} AND "deviceId"=${device.id} FOR UPDATE`;
 let previous=stored?.checkpoint??null;
 const evidence=prototypeGpsEvidence(payload,now);
 let result={state:'UNKNOWN',reason:!zone.active?'ZONE_INACTIVE':evidence.reason,candidate:false,checkpoint:previous?{...previous,pendingState:null,pendingSince:null,armedInside:false}:null};
 const current=await tx.assignment.findFirst({where:{deviceId:device.id,endedAt:null,child:{centerId:device.centerId}}});
 if(zone.active&&evidence.eligible&&assignment&&current?.id===assignment.id&&evidence.observedAt>=zone.effectiveAt){
  if(previous?.bootId===payload.deviceBootId&&payload.gpsSequence<=previous.sequence)result.reason='DUPLICATE_OR_OUT_OF_ORDER';
  else{
   if(previous&&(previous.bootId!==payload.deviceBootId||+now-previous.lastObservedAt>30000))previous={...previous,pendingState:null,pendingSince:null,armedInside:false};
   result=evaluateGeofenceReview({zone,centerId:device.centerId,now:+now,observation:{...payload,deviceId:device.id,childId:assignment.childId,centerId:device.centerId,observedAt:+evidence.observedAt,receivedAt:+now},assignments:[{...assignment,centerId:device.centerId,startedAt:+assignment.startedAt,endedAt:assignment.endedAt?+assignment.endedAt:null}],previous});
   result.candidate=!!(result.candidate&&previous?.armedInside&&previous.scope===result.checkpoint?.scope);
   if(result.checkpoint&&result.reason!=='DUPLICATE_OR_OUT_OF_ORDER')result.checkpoint={...result.checkpoint,bootId:payload.deviceBootId,sequence:payload.gpsSequence,armedInside:result.state==='INSIDE'||!!(previous?.armedInside&&previous.scope===result.checkpoint.scope)};
  }
 }else if(zone.active&&evidence.eligible)result.reason='ASSIGNMENT_OR_ZONE_CHANGED';
 if(result.checkpoint)await tx.$executeRaw`INSERT INTO public."GeofenceState" ("zoneId","deviceId",checkpoint) VALUES (${zone.id},${device.id},${JSON.stringify(result.checkpoint)}::jsonb) ON CONFLICT ("zoneId","deviceId") DO UPDATE SET checkpoint=EXCLUDED.checkpoint,"updatedAt"=clock_timestamp()`;
 await tx.$executeRaw`INSERT INTO public."GeofenceReading" ("eventId","zoneId","zoneRevision",state,reason,"distanceM","observedAt") VALUES (${event.id},${zone.id},${zone.revision},${result.state},${result.reason},${result.comparison?.distanceM??null},${evidence.observedAt})`;
 if(result.candidate)await tx.alert.create({data:{eventId:event.id,kind:'GEOFENCE_OUTSIDE',details:{zone:{id:zone.id,name:zone.name,latitude:zone.latitude,longitude:zone.longitude,radiusM:zone.radiusM,revision:zone.revision},observedAt:evidence.observedAt.toISOString(),receivedAt:now.toISOString(),distanceM:result.comparison.distanceM,evidence:'DEVICE_REPORTED_GNSS_PROTOTYPE_NOT_GUARANTEED_ACCURACY'}}});
 return {state:result.state,reason:result.reason,alertCreated:!!result.candidate};
}
