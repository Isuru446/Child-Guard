import {tamperStatus} from './tamper.js';
import { z } from 'zod';
import { fail } from './events.js';
import { MAX_BEACONS } from './beacons.js';
import { managementCommunicationState } from './wearable-management.js';

export const MONITORING_WINDOW_MS=86400000;
export const MONITORING_EVENTS=50;
const gpsStates=['GPS_FIX','GPS_NO_FIX','GPS_NO_SERIAL'];
const types=['TAMPER_LOOP_OPEN','TAMPER_LOOP_RESTORED','TAMPER_LOOP_STATUS','CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','BLE_PROXIMITY','ACTIVITY_SUMMARY'];
const orderBy=[{receivedAt:'desc'},{id:'desc'}];
const eventFields={id:true,eventId:true,eventType:true,childId:true,receivedAt:true,observedAt:true,payload:true,
 child:{select:{id:true,name:true,centerId:true}},beacon:{select:{id:true,hardwareId:true,centerId:true}},
 alerts:{select:{id:true,kind:true,createdAt:true},take:5}};
export const monitoringEventFields=eventFields;
const stamp=value=>value===null||value===undefined?null:Number.isFinite(+new Date(value))?new Date(value).toISOString():null;
const validFix=p=>p?.gpsStatus==='GPS_FIX'&&typeof p.latitude==='number'&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&typeof p.longitude==='number'&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
function observationTime(row) {
 if(row.payload?.tamperVersion&&row.payload.timingUncertain)return {observedAt:null,timingBasis:'REBOOT_TIMING_UNCERTAIN'};
 if(row.payload?.gpsEvidenceVersion&&!row.observedAt)return {observedAt:null,timingBasis:'UNQUALIFIED_GPS_EVIDENCE'};
 const receipt=stamp(row.receivedAt);if(!receipt)return {observedAt:null,timingBasis:'UNKNOWN'};
 if(row.observedAt!==null&&row.observedAt!==undefined){const observedAt=stamp(row.observedAt);return observedAt&&observedAt<=receipt?{observedAt,timingBasis:'STORED_OBSERVATION'}:{observedAt:null,timingBasis:'INVALID_OBSERVATION'};}
 const age=row.payload?.queueAgeMs;
 if(Number.isFinite(age)&&age>=0)return {observedAt:stamp(+new Date(receipt)-age),timingBasis:'RECEIPT_MINUS_QUEUE_AGE'};
 if(age!==undefined)return {observedAt:null,timingBasis:'INVALID_QUEUE_AGE'};
 return {observedAt:receipt,timingBasis:'RECEIPT_TIME'};
}
export function monitoringEvent(row,centerId) {
 const p=row.payload??{},payload={};
 const allowed={gpsEvidenceVersion:['CG_GPS_V1'],gpsStatus:gpsStates,proximity:['NEAR','FAR','UNKNOWN'],activityState:['UNKNOWN','GYRO_NOT_CALIBRATED','BASELINE_COLLECTION','ACTIVE','INACTIVE','PROLONGED_INACTIVITY'],sensorStatus:['OK','PARTIAL','UNAVAILABLE'],measurementVersion:['MAD_G_V1_25HZ_5S']};
 for(const [key,values] of Object.entries(allowed))if(values.includes(p[key]))payload[key]=p[key];
 if(typeof p.beaconUuid==='string'&&/^[a-f0-9-]{36}$/i.test(p.beaconUuid))payload.beaconUuid=p.beaconUuid;
 for(const key of ['rssi','accelRms','gyroRms','movementIntensity','validSampleCount','expectedSampleCount','validDurationSeconds','queueAgeMs','gpsHdop','gpsSatellites','gpsFixAgeMs','gpsQueueAgeMs'])if(typeof p[key]==='number'&&Number.isFinite(p[key]))payload[key]=p[key];
 if(validFix(p)){payload.latitude=p.latitude;payload.longitude=p.longitude;}
 for(const key of ['tamperState','tamperVersion','tamperEpisodeId','reason'])if(typeof p[key]==='string')payload[key]=p[key];
 if(typeof p.timingUncertain==='boolean')payload.timingUncertain=p.timingUncertain;
 const child=row.child?.centerId===centerId?{id:row.child.id,name:row.child.name}:null;
 const beacon=row.beacon?.centerId===centerId?{id:row.beacon.id,hardwareId:row.beacon.hardwareId}:null;
 return {id:row.id,eventId:row.eventId,eventType:row.eventType,receivedAt:stamp(row.receivedAt),...observationTime(row),payload,
  recordedChild:child,recordedChildId:child?.id??null,attribution:child?'STORED_CHILD':row.childId?'CHILD_UNAVAILABLE':'UNASSIGNED',beacon,
  alerts:(row.alerts??[]).map(a=>({id:a.id,kind:a.kind,createdAt:stamp(a.createdAt)}))};
}
export async function monitoringContext(db,centerId,now=Date.now()) {
 const beacons=await db.beacon.findMany({where:{centerId,active:true},select:{id:true,hardwareId:true,name:true,location:true,kind:true,serviceUuid:true},orderBy:{hardwareId:'asc'},take:MAX_BEACONS});
 return {centerId,now,beacons,windowStart:new Date(now-MONITORING_WINDOW_MS),until:new Date(now)};
}
const eventScope=(device,context)=>({deviceId:device.id,device:{centerId:context.centerId},receivedAt:{gte:context.windowStart,lte:context.until}});
export async function monitoringDevice(db,device,context) {
 const where=eventScope(device,context);
 const [rows,fixes]=await Promise.all([
  db.deviceEvent.findMany({where,select:eventFields,orderBy,take:MONITORING_EVENTS}),
  db.deviceEvent.findMany({where:{...where,AND:[{payload:{path:['gpsStatus'],equals:'GPS_FIX'}},{payload:{path:['latitude'],gte:-90,lte:90}},{payload:{path:['longitude'],gte:-180,lte:180}}]},select:eventFields,orderBy:[{observedAt:{sort:'desc',nulls:'last'}},...orderBy],take:1}),
 ]);
 const events=rows.map(r=>monitoringEvent(r,context.centerId));
 const report=events.find(e=>gpsStates.includes(e.payload.gpsStatus))??null;
 const valid=fixes[0]&&validFix(fixes[0].payload)?monitoringEvent(fixes[0],context.centerId):null;
 const age=valid?.observedAt?context.now-Date.parse(valid.observedAt):NaN;
 const location=valid?{latitude:valid.payload.latitude,longitude:valid.payload.longitude,receivedAt:valid.receivedAt,observedAt:valid.observedAt,timingBasis:valid.timingBasis,recordedChild:valid.recordedChild,recordedChildId:valid.recordedChildId,attribution:valid.attribution,
  state:!Number.isFinite(age)||age<0?'UNKNOWN_TIME':device.active&&age<=60000&&report?.payload.gpsStatus==='GPS_FIX'&&report.observedAt&&valid.observedAt>=report.observedAt?'RECENT':'HISTORICAL'}:null;
 const beaconStates=context.beacons.map(b=>{
  const observation=events.find(e=>e.beacon?.id===b.id&&['BLE_PROXIMITY','BEACON_SIGNAL_LOST'].includes(e.eventType)&&(b.kind!=='DANGER_ZONE'||e.payload.beaconUuid===b.serviceUuid));
  const elapsed=observation?.observedAt?context.now-Date.parse(observation.observedAt):NaN;
  const stale=!Number.isFinite(elapsed)||elapsed<0||elapsed>45000;
  return {beaconId:b.hardwareId,name:b.name,location:b.location,kind:b.kind,serviceUuid:b.serviceUuid,
   proximity:device.active&&!stale&&observation?.eventType==='BLE_PROXIMITY'?observation.payload.proximity??'UNKNOWN':'UNKNOWN',reportedProximity:observation?.eventType==='BLE_PROXIMITY'?observation.payload.proximity??'UNKNOWN':'UNKNOWN',rssi:observation?.payload.rssi??null,
   observedAt:observation?.observedAt??null,receivedAt:observation?.receivedAt??null,stale,staleAfterMs:45000};
 });
 const gate=beaconStates.find(b=>b.kind==='GATE');
 return {tamper:await tamperStatus(db,device,{now:context.now}),id:device.id,hardwareId:device.hardwareId,centerId:device.centerId,active:device.active,lastSeen:device.lastSeen,connectionState:managementCommunicationState(device,context.now),batteryPercent:null,
  latestEvent:events[0]??null,gps:report,gpsMonitoring:{latestStatus:report?.payload.gpsStatus??'NOT_REPORTED',statusReceivedAt:report?.receivedAt??null,lastValidLocation:location,staleAfterMs:60000},
  ble:events.find(e=>['CHILD_NEAR_GATE','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','BLE_PROXIMITY'].includes(e.eventType))??null,
  mpu6050:events.find(e=>['ACTIVITY_SUMMARY','ACTIVITY_WINDOW','ACTIVITY_SAMPLE_GAP'].includes(e.eventType))??null,beaconStates,
  bleState:{gateId:gate?.beaconId??null,beaconType:gate?'Gate / Attendance + Danger Zone':null,proximity:gate?.proximity??'UNKNOWN',rssi:gate?.rssi??null,observedAt:gate?.observedAt??null,receivedAt:gate?.receivedAt??null,stale:gate?.stale??true,staleAfterMs:45000},
  monitoring:{serverTime:context.until.toISOString(),windowStart:context.windowStart.toISOString(),recentEventLimit:MONITORING_EVENTS,locationWindowHours:24}};
}
export async function readMonitoringHistory(db,req,now=Date.now()) {
 if(req.user.role!=='ADMIN')throw fail(403,'FORBIDDEN','Administrator required');
 const q=z.object({management:z.literal('true'),deviceId:z.string().uuid(),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0),until:z.string().datetime().optional(),eventType:z.enum(types).optional()}).strict().parse(req.query);
 const until=q.until?Date.parse(q.until):now;
 if(until>now||until<now-MONITORING_WINDOW_MS)throw fail(422,'VALIDATION_ERROR','Use a current monitoring snapshot');
 const device=await db.device.findFirst({where:{id:q.deviceId,centerId:req.user.centerId},select:{id:true,hardwareId:true,centerId:true}});
 if(!device)throw fail(404,'NOT_FOUND','Device unavailable');
 const windowStart=new Date(until-MONITORING_WINDOW_MS);
 const rows=await db.deviceEvent.findMany({where:{deviceId:device.id,device:{centerId:req.user.centerId},receivedAt:{gte:windowStart,lte:new Date(until)},...(q.eventType?{eventType:q.eventType}:{})},select:eventFields,orderBy,take:q.limit+1,skip:q.offset});
 return {deviceId:device.id,hardwareId:device.hardwareId,events:rows.slice(0,q.limit).map(e=>monitoringEvent(e,req.user.centerId)),hasMore:rows.length>q.limit,limit:q.limit,offset:q.offset,until:new Date(until).toISOString(),windowStart:windowStart.toISOString(),serverTime:new Date(now).toISOString()};
}
