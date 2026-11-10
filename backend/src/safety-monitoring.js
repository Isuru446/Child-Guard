import {connectionDetails} from './wearable-connection.js';
import { z } from 'zod';
import { attendanceDay, dbTime, fail } from './events.js';
import { monitoringEvent, monitoringEventFields } from './device-monitoring.js';
import { geofenceInstalled } from './prototype-geofence.js';

export const safetyCapabilities=Object.freeze({
 geofence:'BLOCKED_NO_PERSISTED_BOUNDARIES',tamper:'AUTHENTICATED_GPIO_LOOP_V1',
 ble:'RECORDED_EXPERIMENTAL_EVENTS',departureThenZoneApproach:'UNVERIFIED',
 activity:'EXISTING_PERSONALIZED_MOVEMENT_PIPELINE',alertState:'RECORDED_ONLY',acknowledgement:false,dispatch:false,
});
const categories={TAMPER:['TAMPER_LOOP_OPEN'],DANGER:['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN'],BLE_DANGER:['DANGER_ZONE_NEAR'],DEVICE_SIGNAL:['BEACON_SIGNAL_LOST','WEARABLE_CONNECTION_LOST'],ACTIVITY:['LOW_ACTIVITY','LOW_ACTIVITY_ADVISORY'],GEOFENCE:['GEOFENCE_OUTSIDE']};
const stamp=value=>value!==null&&value!==undefined&&Number.isFinite(+new Date(value))?new Date(value).toISOString():null;
const text=value=>typeof value==='string'?value.slice(0,500):null;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
function activityDetails(details){
 if(!details||typeof details!=='object')return null;
 const output={};for(const k of ['currentScoreMg','baselineScoreMg','reductionPercent','coveragePercent','baselineDayCount','requiredBaselineDays'])output[k]=number(details[k]);
 output.baselineWindow=details.baselineWindow?{start:text(details.baselineWindow.start),end:text(details.baselineWindow.end)}:null;
 output.comparisonWindows=Array.isArray(details.comparisonWindows)?details.comparisonWindows.slice(0,8).map(w=>Object.fromEntries(['startMinute','endMinute','currentScoreMg','baselineScoreMg','reductionPercent','coveragePercent','baselineDayCount'].map(k=>[k,number(w?.[k])]))):[];
 output.measurementVersion=text(details.measurementVersion);output.timezone=text(details.timezone);output.followUp=typeof details.followUp==='boolean'?details.followUp:null;
 const p=details.period;output.period=p&&typeof p==='object'?{day:text(p.day),startMinute:number(p.startMinute),endMinute:number(p.endMinute),startAt:stamp(p.startAt),endAt:stamp(p.endAt)}:null;
 return output;
}
function safeZone(event,centerId){
 const b=event.beacon;if(b?.centerId!==centerId)return null;
 const snapshot=event.payload?.beaconMetadata;
 return {id:b.id,hardwareId:b.hardwareId,kind:['GATE','DANGER_ZONE'].includes(snapshot?.kind)?snapshot.kind:b.kind,
  name:text(snapshot?.name)??null,location:text(snapshot?.location)??null,labelsSource:snapshot?'EVENT_SNAPSHOT':'NOT_RECORDED',
  observedUuid:text(event.payload?.beaconUuid),currentUuid:b.serviceUuid??null,identityChanged:typeof event.payload?.beaconUuid==='string'&&event.payload.beaconUuid!==b.serviceUuid};
}
export function safetyAlertView(row,centerId,now) {
 if(!centerId||row.event?.device?.centerId!==centerId||(row.event.childId&&row.event.child?.centerId!==centerId)||(row.event.beaconId&&row.event.beacon?.centerId!==centerId))throw fail(503,'ALERT_SCOPE_INVALID','Alert scope requires review');
 const event=monitoringEvent(row.event,centerId),p=event.payload;
 const valid=p.gpsStatus==='GPS_FIX'&&typeof p.latitude==='number'&&typeof p.longitude==='number';
 const age=event.observedAt?now-Date.parse(event.observedAt):NaN;
 const category=Object.entries(categories).find(([key,kinds])=>key!=='DANGER'&&kinds.includes(row.kind))?.[0]??'OTHER';
 return {connection:row.kind==='WEARABLE_CONNECTION_LOST'?connectionDetails(row.details):null,id:row.id,kind:row.kind,category,state:'RECORDED',severity:row.kind==='TAMPER_LOOP_OPEN'?'DANGER':null,createdAt:stamp(row.createdAt),
  event:{...event,device:{id:row.event.device.id,hardwareId:row.event.device.hardwareId},zone:row.kind==='WEARABLE_CONNECTION_LOST'?null:safeZone(row.event,centerId)},
  location:valid&&row.kind!=='WEARABLE_CONNECTION_LOST'?{latitude:p.latitude,longitude:p.longitude,observedAt:event.observedAt,receivedAt:event.receivedAt,timingBasis:event.timingBasis,source:'THIS_RECORDED_EVENT',freshness:Number.isFinite(age)&&age>=0&&age<=60000?'RECENT_RECORDED_OBSERVATION':'HISTORICAL_OR_UNKNOWN_TIME'}:null,
  activity:['LOW_ACTIVITY','LOW_ACTIVITY_ADVISORY'].includes(row.kind)?activityDetails(row.details):null,
  geofence:row.kind==='GEOFENCE_OUTSIDE'&&row.details?.zone?{name:text(row.details.zone.name),radiusM:number(row.details.zone.radiusM),latitude:number(row.details.zone.latitude),longitude:number(row.details.zone.longitude),revision:number(row.details.zone.revision),distanceM:number(row.details.distanceM)}:null,
  assessment:row.kind==='TAMPER_LOOP_OPEN'?{verification:'AUTHENTICATED_GPIO_LOOP',note:`${event.recordedChild?.name??'The child'}'s wearable tamper loop was disconnected. Please check the child and ensure the wearable is attached correctly. Reconnection does not dismiss this incident.`}:row.kind==='WEARABLE_CONNECTION_LOST'?{verification:'BACKEND_COMMUNICATION_TIMEOUT',note:'No accepted authenticated communication was received within the monitoring timeout. The cause is unknown; reviewing this warning does not restore communication or establish child safety.'}:row.kind==='GEOFENCE_OUTSIDE'?{verification:'CLASSROOM_PROTOTYPE',note:'Consecutive qualified device-reported GNSS positions were outside the configured circle after recent inside observations. GPS error and physical safety are not guaranteed.'}:row.kind==='DANGER_ZONE_NEAR'?{verification:['GATE_FAR_ZONE_FAR_NEAR_V1','SESSION_DEPARTURE_ZONE_FAR_NEAR_V2'].includes(row.details?.workflow)?'BACKEND_SEQUENCE_VALIDATED':'UNVERIFIED',note:'Recorded BLE prototype event. New ordinary-zone alerts require trusted Teacher/RFID-confirmed PRESENT and same-session verified Gate departure then fresh same-boot zone FAR-to-NEAR; continuing Gate coverage is not required. Older records do not establish this sequence; neither is independent proof of an emergency.'}:row.kind==='BEACON_SIGNAL_LOST'?{verification:'DIAGNOSTIC_ONLY',note:'Recorded beacon signal loss. It does not establish tampering, departure or an emergency.'}:['LOW_ACTIVITY','LOW_ACTIVITY_ADVISORY'].includes(row.kind)?{verification:'MOVEMENT_OBSERVATION',note:'Stored personalized movement comparison, not a medical diagnosis or confirmed safety incident.'}:{verification:'UNVERIFIED',note:'Stored category only; no independent incident classification is available.'},
 };
}
export async function readSafetyAlerts(db,req) {
 if(req.user?.role!=='ADMIN'||!req.user.centerId)throw fail(403,'FORBIDDEN','Center administrator required');
 const q=z.object({management:z.literal('true'),category:z.enum(['BLE_DANGER','DEVICE_SIGNAL','ACTIVITY','GEOFENCE','TAMPER','DANGER']).optional(),state:z.literal('RECORDED').optional(),childId:z.string().uuid().optional(),search:z.string().trim().max(100).optional(),from:z.string().date().optional(),to:z.string().date().optional(),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
 const now=await dbTime(db),today=attendanceDay(now),from=q.from??new Date(Date.parse(today+'T00:00:00Z')-6*86400000).toISOString().slice(0,10),to=q.to??today;
 if(from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>30)throw fail(422,'VALIDATION_ERROR','Choose at most 31 center-local recorded dates');
 const centerId=req.user.centerId;
 const where={event:{device:{centerId},AND:[{OR:[{childId:null},{child:{centerId}}]},{OR:[{beaconId:null},{beacon:{centerId}}]}],...(q.childId?{child:{id:q.childId,centerId}}:{})},createdAt:{gte:new Date(from+'T00:00:00+05:30'),lt:new Date(Date.parse(to+'T00:00:00+05:30')+86400000),lte:now},...(q.category?{kind:{in:categories[q.category]}}:{}),
  ...(q.search?{OR:[{kind:{contains:q.search,mode:'insensitive'}},{event:{device:{hardwareId:{contains:q.search,mode:'insensitive'}}}},{event:{child:{centerId,name:{contains:q.search,mode:'insensitive'}}}}]}:{})};
 const selectEvent={...monitoringEventFields,device:{select:{id:true,hardwareId:true,centerId:true}},beacon:{select:{id:true,hardwareId:true,centerId:true,kind:true,serviceUuid:true}}};delete selectEvent.alerts;
 const [rows,total]=await Promise.all([
  db.alert.findMany({where,select:{id:true,kind:true,createdAt:true,details:true,event:{select:selectEvent}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit+1,skip:q.offset}),db.alert.count({where}),
 ]);
 return {rows:rows.slice(0,q.limit).map(r=>safetyAlertView(r,centerId,+now)),total,hasMore:rows.length>q.limit,limit:q.limit,offset:q.offset,from,to,today,timezone:'Asia/Colombo',serverTime:now.toISOString(),capabilities:{...safetyCapabilities,geofence:await geofenceInstalled(db)?'CLASSROOM_PROTOTYPE_FRESH_GNSS_ONLY':'BLOCKED_MIGRATION_REQUIRED',departureThenZoneApproach:'ENFORCED_SESSION_DEPARTURE_FRESH_SAME_BOOT_ZONE_FAR_NEAR'}};
}
