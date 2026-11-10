import {tamperSchema,TAMPER_TYPES} from './tamper-contract.js';
import { zoneSessionKey, verifiedDeparture } from './zone-monitoring.js';
import { latestReset } from './attendance-reset.js';
import { z } from 'zod';
import { activitySchema } from './activity-contract.js';
import { prototypeGpsEvidence } from './prototype-gps.js';
import { recordPrototypeGeofence } from './prototype-geofence.js';
export const identifier = z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
const legacyEventSchema = z.object({
 deviceBootId:identifier.max(80).optional(),gpsEvidenceVersion:z.literal('CG_GPS_V1').optional(),gpsObservedAt:z.string().datetime().optional(),gpsFixAgeMs:z.number().int().min(0).max(4294967295).optional(),gpsQueueAgeMs:z.number().int().min(0).max(4294967295).optional(),gpsSequence:z.number().int().min(0).max(4294967295).optional(),gpsHdop:z.number().finite().positive().optional(),gpsSatellites:z.number().int().min(0).max(100).optional(),
 attendanceEpoch: identifier.optional(), eventId: identifier, deviceId: identifier, gateId: identifier.optional(), beaconId: identifier.optional(), beaconUuid:z.string().uuid().transform(v=>v.toLowerCase()).optional(),
 eventType: z.enum(['CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','BLE_PROXIMITY']),
 gpsStatus: z.enum(['GPS_NO_SERIAL','GPS_NO_FIX','GPS_FIX']),
 deviceUptimeMs: z.number().int().min(0).max(4294967295),
 proximity: z.enum(['NEAR','FAR','UNKNOWN']).optional(),
 queueAgeMs: z.number().int().min(0).max(4294967295).optional(),
 rssi: z.number().finite().min(-127).max(0).optional(),
 activityState: z.enum(['UNKNOWN','GYRO_NOT_CALIBRATED','BASELINE_COLLECTION','ACTIVE','INACTIVE','PROLONGED_INACTIVITY']).optional(),
 accelRms: z.number().finite().nonnegative().optional(), gyroRms: z.number().finite().nonnegative().optional(),
 latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
}).strict().superRefine((v,c)=>{
 if(Object.keys(v).some(k=>k.startsWith('gps')&&!['gpsStatus'].includes(k))&&v.eventType!=='GPS_STATUS')c.addIssue({code:'custom',message:'GPS evidence extension is GPS_STATUS only'});
 if(Object.keys(v).some(k=>k.startsWith('gps')&&k!=='gpsStatus')&&!v.gpsEvidenceVersion)c.addIssue({code:'custom',message:'GPS evidence version required'});
 if(v.gpsEvidenceVersion&&(!v.deviceBootId||v.gpsSequence===undefined||v.gpsQueueAgeMs===undefined))c.addIssue({code:'custom',message:'GPS evidence requires boot, sequence and queue age'});
 if(!v.gateId && !v.beaconId) c.addIssue({code:'custom',message:'Beacon identity required'});
 if(v.gateId && v.beaconId && v.gateId!==v.beaconId) c.addIssue({code:'custom',message:'Conflicting beacon identities'});
 if(v.beaconId && !v.beaconUuid) c.addIssue({code:'custom',message:'Explicit beacon identity requires broadcast UUID'});
 if (v.eventType === 'BLE_PROXIMITY') {
  if (!v.proximity || v.queueAgeMs === undefined) c.addIssue({code:'custom',message:'BLE requires proximity and queueAgeMs'});
  if (v.proximity !== 'UNKNOWN' && v.rssi === undefined) c.addIssue({code:'custom',message:'Known proximity requires RSSI'});
  if (v.proximity === 'UNKNOWN' && v.rssi !== undefined) c.addIssue({code:'custom',message:'Unknown proximity must omit RSSI'});
 } else if (v.proximity !== undefined || (v.queueAgeMs !== undefined && !['DANGER_ZONE_NEAR','DANGER_ZONE_EXIT'].includes(v.eventType))) c.addIssue({code:'custom',message:'BLE fields require BLE_PROXIMITY'});
 if ((v.latitude === undefined) !== (v.longitude === undefined) || (v.latitude !== undefined && v.gpsStatus !== 'GPS_FIX')) c.addIssue({code:'custom',message:'Coordinates require a pair and GPS_FIX'});
 if (['CHILD_NEAR_GATE','DANGER_ZONE_NEAR'].includes(v.eventType) && v.rssi === undefined) c.addIssue({code:'custom',message:'Gate observation requires rssi'});
 if (v.eventType === 'ACTIVITY_WINDOW' && [v.activityState,v.accelRms,v.gyroRms].some(x=>x===undefined)) c.addIssue({code:'custom',message:'Activity window requires state and RMS values'});
});
export const eventSchema=z.union([legacyEventSchema,activitySchema,tamperSchema]);
export function fail(status,code,message) { return Object.assign(new Error(message),{status,code}); }
export async function dbTime(tx) { const [row] = await tx.$queryRaw`SELECT clock_timestamp() AS now`; return row.now; }
export function attendanceDay(date) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
export async function serial(db, work) {
 for(let attempt=0; ; attempt++) {
  try { return await db.$transaction(work,{isolationLevel:'Serializable'}); }
  catch(e) { const retryable = ['P2034','P2002'].includes(e.code) || (e.code === 'P2010' && ['40001','40P01'].includes(e.meta?.code)); if (retryable && attempt < 3) continue; throw e; }
 }
}
// Queue age is transport metadata; retries retain the observation identity.
const canonical = value => JSON.stringify(value,Object.keys(value).filter(k=>!['queueAgeMs','gpsQueueAgeMs','beaconMetadata','zoneDeparture'].includes(k)).sort());
export async function ingest(db, device, payload, options) {
 if(TAMPER_TYPES.includes(payload.eventType))return (await import('./tamper.js')).ingestTamper(db,device,payload);
 if(payload.eventType==='ACTIVITY_SUMMARY') return (await import('./activity.js')).ingestActivity(db,device,payload,options);
 return serial(db,async tx=>{
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${device.id} FOR UPDATE`;
  const current = await tx.device.findUnique({where:{id:device.id}});
  if (!current?.active || current.tokenHash !== device.tokenHash || current.centerId!==device.centerId) throw fail(401,'DEVICE_UNAUTHORIZED','Device unauthorized');
  const old = await tx.deviceEvent.findUnique({where:{eventId:payload.eventId}});
  if(old) {
   if(old.deviceId !== device.id || canonical(old.payload)!==canonical(payload)) throw fail(409,'EVENT_ID_CONFLICT','Event ID already used with different content');
   await tx.device.update({where:{id:device.id},data:{lastSeen:await dbTime(tx)}});
   if(payload.eventType==='DANGER_ZONE_NEAR') {
    const alert=await tx.alert.findFirst({where:{eventId:old.id,kind:'DANGER_ZONE_NEAR'}});
    return {eventId:old.eventId,duplicate:true,alertCreated:Boolean(alert),suppressionReason:alert?null:'DUPLICATE_WITHOUT_ALERT'};
   }
   return {eventId:old.eventId,duplicate:true};
  }
  const beacon = await tx.beacon.findFirst({where:{hardwareId:payload.beaconId||payload.gateId,centerId:device.centerId}});
  if(!beacon) throw fail(422,'UNKNOWN_GATE','Gate not registered in device center');
  if(!beacon.active) throw fail(422,'BEACON_INACTIVE','Beacon is inactive');
  if(payload.beaconUuid && payload.beaconUuid!==beacon.serviceUuid) throw fail(422,'BEACON_IDENTITY_MISMATCH','Beacon broadcast identity does not match registration');
  if(beacon.kind!=='GATE' && (!payload.beaconId || !['BLE_PROXIMITY','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST'].includes(payload.eventType))) throw fail(422,'GATE_REQUIRED','Only gate beacons support attendance and gate telemetry');
  if(beacon.kind==='DANGER_ZONE' && ['DANGER_ZONE_NEAR','DANGER_ZONE_EXIT'].includes(payload.eventType) && payload.queueAgeMs===undefined) throw fail(422,'OBSERVATION_TIME_REQUIRED','Danger observations require queue age');
  let assignment = await tx.assignment.findFirst({where:{deviceId:device.id,endedAt:null,child:{centerId:device.centerId}}});
  const gpsNow=payload.eventType==='GPS_STATUS'?await dbTime(tx):null;
  if(payload.eventType==='GPS_STATUS'&&payload.gpsEvidenceVersion){
   const evidence=prototypeGpsEvidence(payload,gpsNow);
   const historical=evidence.eligible?await tx.assignment.findMany({where:{deviceId:device.id,child:{centerId:device.centerId},startedAt:{lte:evidence.observedAt},OR:[{endedAt:null},{endedAt:{gt:evidence.observedAt}}]},take:2}):[];
   assignment=historical.length===1?historical[0]:null;
  }
  const childId = assignment?.childId;
  if(childId) await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId} FOR UPDATE`;
  const now = await dbTime(tx);
  const attendance = childId ? await tx.attendance.findUnique({where:{childId_day:{childId,day:attendanceDay(now)}}}) : null;
  const resetCycle=attendance ? await latestReset(tx,attendance.id) : null;
  if(payload.eventType==='CHILD_NEAR_GATE' && resetCycle) {
   if(payload.attendanceEpoch!==resetCycle.id) throw fail(409,'ATTENDANCE_CYCLE_CHANGED','Arrival belongs to an earlier attendance cycle');
   const far=await tx.deviceEvent.findFirst({where:{deviceId:device.id,childId,beaconId:beacon.id,eventType:'BLE_PROXIMITY',receivedAt:{gt:resetCycle.createdAt},AND:[{payload:{path:['attendanceEpoch'],equals:resetCycle.id}},{payload:{path:['proximity'],equals:'FAR'}}]},orderBy:{receivedAt:'desc'}});
   const observedAt=far ? far.receivedAt.getTime()-(far.payload.queueAgeMs||0) : 0;
   const unknown=far ? await tx.deviceEvent.findFirst({where:{deviceId:device.id,beaconId:beacon.id,receivedAt:{gte:far.receivedAt},OR:[{eventType:'BEACON_SIGNAL_LOST'},{eventType:'BLE_PROXIMITY',payload:{path:['proximity'],equals:'UNKNOWN'}}]}}) : null;
   if(unknown || !far || far.payload.proximity!=='FAR' || observedAt<=resetCycle.createdAt.getTime() || now.getTime()-observedAt>45000 || payload.deviceUptimeMs<Number(far.deviceUptimeMs)) throw fail(409,'NEW_ARRIVAL_REQUIRED','Fresh post-reset FAR evidence is required');
  }
  // Store workflow telemetry, but only eligible arrivals attach to attendance.
  // Snapshot registered labels on identified zones so edits do not relabel old alerts.
  let storedPayload=beacon.kind==='DANGER_ZONE' || beacon.name || beacon.location ? {...payload,beaconMetadata:{name:beacon.name,location:beacon.location,kind:beacon.kind}} : payload;
  const observedAt=new Date(now.getTime()-(payload.queueAgeMs||0));
  if(beacon.kind==='GATE' && payload.eventType==='BLE_PROXIMITY' && payload.proximity==='FAR' && payload.rssi<=beacon.exitRssi) {
   const confirmation=attendance?await tx.confirmation.findUnique({where:{attendanceId:attendance.id}}):null;
   const key=zoneSessionKey({device,assignment,attendance,confirmation,resetCycle,boot:payload.deviceBootId});
   if(key && (payload.queueAgeMs||0)<=45000 && observedAt>confirmation.confirmedAt && observedAt>=assignment.startedAt && (!resetCycle || (payload.attendanceEpoch===resetCycle.id && observedAt>resetCycle.createdAt)))
    storedPayload={...storedPayload,zoneDeparture:{key}};
  }
  const event = await tx.deviceEvent.create({data:{eventId:payload.eventId,eventType:payload.eventType,deviceId:device.id,beaconId:beacon.id,childId,deviceUptimeMs:BigInt(payload.deviceUptimeMs),payload:storedPayload,receivedAt:now,observedAt:payload.gpsEvidenceVersion?prototypeGpsEvidence(payload,now).observedAt:new Date(now.getTime()-(payload.queueAgeMs||0))}});
  await tx.device.update({where:{id:device.id},data:{lastSeen:now}});
  if(payload.eventType==='GPS_STATUS')return {eventId:event.eventId,duplicate:false,geofence:await recordPrototypeGeofence(tx,{device,payload,event,assignment,now})};
  if(childId && payload.eventType==='CHILD_NEAR_GATE' && (!attendance || ['NOT_CHECKED_IN','CHECKIN_PENDING'].includes(attendance.status))) {
   const attendance = await tx.attendance.upsert({where:{childId_day:{childId,day:attendanceDay(now)}},create:{childId,day:attendanceDay(now),status:'CHECKIN_PENDING'},update:{}});
   if(attendance.status==='NOT_CHECKED_IN') await tx.attendance.update({where:{id:attendance.id},data:{status:'CHECKIN_PENDING'}});
   await tx.observation.create({data:{attendanceId:attendance.id,eventId:event.id}});
  }
  // BLE signal loss remains technical evidence; it is not a connectivity alert.
  if(payload.eventType==='DANGER_ZONE_NEAR') {
   const confirmation = attendance ? await tx.confirmation.findUnique({where:{attendanceId:attendance.id}}) : null;
   const scope = {deviceId:device.id,beaconId:beacon.id,childId};
   if(beacon.kind==='DANGER_ZONE') {
    const departure=await verifiedDeparture(tx,{device,assignment,attendance,confirmation,resetCycle,boot:payload.deviceBootId});
    const zoneFar=departure?await tx.deviceEvent.findFirst({where:{...scope,eventType:'BLE_PROXIMITY',observedAt:{gt:departure.observedAt},payload:{path:['proximity'],equals:'FAR'}},orderBy:{observedAt:'desc'}}):null;
    const zoneReset=zoneFar?await tx.deviceEvent.findFirst({where:{...scope,receivedAt:{gte:zoneFar.receivedAt},OR:[{eventType:'BEACON_SIGNAL_LOST'},{eventType:'BLE_PROXIMITY',payload:{path:['proximity'],equals:'UNKNOWN'}}]}}):null;
    const sequenceReason=attendance?.status!=='PRESENT'||!confirmation?'NOT_CONFIRMED_PRESENT':attendance.gatePassAuthorized?'GATE_PASS_AUTHORIZED':!departure?'NO_VERIFIED_DEPARTURE':!zoneFar||zoneFar.payload.deviceBootId!==payload.deviceBootId||zoneFar.payload.beaconUuid!==beacon.serviceUuid||zoneFar.payload.rssi>beacon.exitRssi?'NO_POST_DEPARTURE_ZONE_FAR':now-zoneFar.observedAt>45000||zoneFar.observedAt<assignment.startedAt?'STALE_OBSERVATION':resetCycle&&zoneFar.payload.attendanceEpoch!==resetCycle.id?'ATTENDANCE_CYCLE_CHANGED':null;
    // Resolve evidence at the entry, not at HTTP delivery. A newer NEAR heartbeat
    // can arrive first during retry/batching; it is not a reboot or a new entry.
    // Freshness, boot, thresholds, UNKNOWN cancellation and FAR rearming below
    // still apply to this authenticated, beacon-scoped observation.
    const near=await tx.deviceEvent.findFirst({where:{...scope,eventType:'BLE_PROXIMITY',observedAt:{lte:event.observedAt}},orderBy:[{observedAt:'desc'},{receivedAt:'desc'}]});
    const lastAlert=await tx.alert.findFirst({where:{kind:'DANGER_ZONE_NEAR',event:scope},include:{event:true},orderBy:{createdAt:'desc'}});
    const far=lastAlert ? await tx.deviceEvent.findFirst({where:{...scope,eventType:'BLE_PROXIMITY',observedAt:{gt:lastAlert.event.observedAt},AND:[{payload:{path:['proximity'],equals:'FAR'}},{payload:{path:['beaconUuid'],equals:beacon.serviceUuid}}]},orderBy:{observedAt:'desc'}}) : null;
    const reason=sequenceReason||(zoneReset?'ZONE_SIGNAL_UNKNOWN':null)||dangerZoneSuppression({attendance,confirmation,resetCycle,beacon,near,lastAlert,far,event,payload,now})||(near.observedAt<=zoneFar.observedAt||near.payload.deviceBootId!==payload.deviceBootId||Number(zoneFar.deviceUptimeMs)>payload.deviceUptimeMs||Number(zoneFar.deviceUptimeMs)<Number(departure.deviceUptimeMs)||Number(near.deviceUptimeMs)<Number(zoneFar.deviceUptimeMs)?'NO_LATER_ZONE_APPROACH':null);
    if(!reason) await tx.alert.create({data:{eventId:event.id,kind:payload.eventType,details:{workflow:'SESSION_DEPARTURE_ZONE_FAR_NEAR_V2',gateEventId:departure.id,zoneFarEventId:zoneFar.id,zoneNearEventId:near.id}}});
    return {eventId:event.eventId,duplicate:false,alertCreated:!reason,suppressionReason:reason};
   }
   const far = childId ? await tx.deviceEvent.findFirst({where:{...scope,eventType:'BLE_PROXIMITY',payload:{path:['proximity'],equals:'FAR'}},orderBy:{receivedAt:'desc'}}) : null;
   const reset = far ? await tx.deviceEvent.findFirst({where:{...scope,receivedAt:{gte:far.receivedAt},OR:[{eventType:'BEACON_SIGNAL_LOST'},{eventType:'BLE_PROXIMITY',payload:{path:['proximity'],equals:'UNKNOWN'}}]},orderBy:{receivedAt:'desc'}}) : null;
   const previousAlert = far ? await tx.alert.findFirst({where:{kind:'DANGER_ZONE_NEAR',event:{...scope,receivedAt:{gte:far.receivedAt}}}}) : null;
   const reason = resetCycle && payload.attendanceEpoch!==resetCycle.id ? 'ATTENDANCE_CYCLE_CHANGED' : gateDangerSuppression({attendance,confirmation,far,reset,previousAlert,payload,now});
   if(!reason) await tx.alert.create({data:{eventId:event.id,kind:payload.eventType}});
   return {eventId:event.eventId,duplicate:false,alertCreated:!reason,suppressionReason:reason};
  }
  return {eventId:event.eventId,duplicate:false};
 });
}

// Conservative server guard; BLE telemetry itself never generates a danger alert.
export function gateDangerSuppression({attendance,confirmation,far,reset,previousAlert,payload,now}) {
 if(attendance?.status!=='PRESENT' || !confirmation) return 'NOT_CONFIRMED_PRESENT';
 if(attendance.gatePassAuthorized) return 'GATE_PASS_AUTHORIZED';
 if(!far) return 'NO_CONFIRMED_FAR';
 const farAt = far.receivedAt.getTime() - (far.payload.queueAgeMs || 0);
 if(farAt <= confirmation.confirmedAt.getTime()) return 'FAR_PRECEDES_CONFIRMATION';
 if(now.getTime()-farAt>45000 || (payload.queueAgeMs || 0)>45000) return 'STALE_OBSERVATION';
 if(payload.deviceUptimeMs<Number(far.deviceUptimeMs)) return 'DEVICE_SESSION_CHANGED';
 if(reset) return 'SIGNAL_UNKNOWN';
 if(previousAlert) return 'APPROACH_ALREADY_REPORTED';
 return null;
}

// Called after same-boot gate FAR / zone FAR ordering checks above.
// Only a confirmed FAR rearms an alerted approach.
export function dangerZoneSuppression({attendance,confirmation,resetCycle,beacon,near,lastAlert,far,event,payload,now}) {
 if(attendance?.status!=='PRESENT' || !confirmation) return 'NOT_CONFIRMED_PRESENT';
 if(resetCycle && payload.attendanceEpoch!==resetCycle.id) return 'ATTENDANCE_CYCLE_CHANGED';
 if(event.observedAt<=confirmation.confirmedAt || (payload.queueAgeMs||0)>45000) return 'STALE_OBSERVATION';
 if(near && payload.deviceUptimeMs<Number(near.deviceUptimeMs)) return 'DEVICE_SESSION_CHANGED';
 if(!near || near.observedAt>event.observedAt || (resetCycle && near.payload.attendanceEpoch!==resetCycle.id) || near.payload.proximity!=='NEAR' || near.payload.rssi<beacon.entryRssi || now-near.observedAt>45000 || near.payload.beaconUuid!==beacon.serviceUuid || payload.rssi<beacon.entryRssi) return 'NO_FRESH_NEAR';
 if(lastAlert && lastAlert.createdAt>=confirmation.confirmedAt && (!far || far.observedAt>event.observedAt)) return 'APPROACH_ALREADY_REPORTED';
 return null;
}
