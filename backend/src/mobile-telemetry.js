import {tamperStatus} from './tamper.js';
import { monitoringEvent, monitoringEventFields } from './device-monitoring.js';
import { managementCommunicationState } from './wearable-management.js';
import { geofenceInstalled } from './prototype-geofence.js';

// Restrict the recorded child as well as the current assignment: a transferred
// belt must never reveal its previous child's GPS or sensor history.
export async function mobileDevice(db,child,now=Date.now()) {
 const assignment=await db.assignment.findFirst({where:{childId:child.id,endedAt:null,device:{centerId:child.centerId}},select:{device:{select:{id:true,hardwareId:true,active:true,lastSeen:true}}}});
 const device=assignment?.device;if(!device)return null;
 const where={deviceId:device.id,childId:child.id,device:{centerId:child.centerId},receivedAt:{gte:new Date(now-86400000),lte:new Date(now)}};
 const [rows,fixes]=await Promise.all([
  db.deviceEvent.findMany({where,select:monitoringEventFields,orderBy:[{receivedAt:'desc'},{id:'desc'}],take:50}),
  db.deviceEvent.findMany({where:{...where,AND:[{payload:{path:['gpsStatus'],equals:'GPS_FIX'}},{payload:{path:['latitude'],gte:-90,lte:90}},{payload:{path:['longitude'],gte:-180,lte:180}}]},select:monitoringEventFields,orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{receivedAt:'desc'},{id:'desc'}],take:1}),
 ]);
 const events=rows.map(row=>monitoringEvent(row,child.centerId));
 const report=events.find(e=>['GPS_FIX','GPS_NO_FIX','GPS_NO_SERIAL'].includes(e.payload.gpsStatus));
 const fix=fixes[0]?monitoringEvent(fixes[0],child.centerId):null;
 const valid=fix&&typeof fix.payload.latitude==='number'&&typeof fix.payload.longitude==='number';
 const age=valid&&fix.observedAt?now-Date.parse(fix.observedAt):NaN;
 const location=valid?{latitude:fix.payload.latitude,longitude:fix.payload.longitude,observedAt:fix.observedAt,receivedAt:fix.receivedAt,timingBasis:fix.timingBasis,recordedChildId:child.id,
  state:!Number.isFinite(age)||age<0?'UNKNOWN_TIME':device.active&&age<=60000&&report?.payload.gpsStatus==='GPS_FIX'&&report.observedAt&&fix.observedAt>=report.observedAt?'RECENT':'HISTORICAL'}:null;
 const seen=new Set();const beaconStates=[];
 for(const row of rows){
  if(!row.beacon||row.beacon.centerId!==child.centerId||seen.has(row.beacon.id)||!['BLE_PROXIMITY','BEACON_SIGNAL_LOST'].includes(row.eventType))continue;
  seen.add(row.beacon.id);const event=monitoringEvent(row,child.centerId),elapsed=event.observedAt?now-Date.parse(event.observedAt):NaN;
  const fresh=Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=45000&&device.active;
  beaconStates.push({beaconId:row.beacon.hardwareId,proximity:fresh&&event.eventType==='BLE_PROXIMITY'?event.payload.proximity??'UNKNOWN':'UNKNOWN',rssi:event.payload.rssi??null,observedAt:event.observedAt,stale:!fresh});
 }
 return {...device,tamper:await tamperStatus(db,{...device,centerId:child.centerId},{childId:child.id,now}),connectionState:managementCommunicationState(device,now),batteryPercent:null,serverTime:new Date(now).toISOString(),
  gpsMonitoring:{latestStatus:report?.payload.gpsStatus??'NOT_REPORTED',lastValidLocation:location,staleAfterMs:60000},
  latestTelemetry:events[0]??null,beaconStates};
}
export async function mobileLocation(db,child) {
 const device=await mobileDevice(db,child);let geofence=null,configurationAvailable=false;
 if(await geofenceInstalled(db)){
  configurationAvailable=true;
  const rows=await db.$queryRaw`SELECT id,name,latitude,longitude,"radiusM",active,revision FROM public."SafeZone" WHERE "centerId"=${child.centerId} LIMIT 1`;
  geofence=rows[0]??null;
 }
 return {child:{id:child.id,name:child.name},device,gpsMonitoring:device?.gpsMonitoring??{latestStatus:'NOT_REPORTED',lastValidLocation:null,staleAfterMs:60000},geofence,configurationAvailable,serverTime:new Date().toISOString()};
}
