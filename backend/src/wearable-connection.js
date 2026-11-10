import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {attendanceDay,dbTime,serial,fail} from './events.js';

export const CONNECTION_LOST='WEARABLE_CONNECTION_LOST';
export function connectionSettings(env=process.env){
 const integer=(key,fallback,min,max)=>{const value=env[key]===undefined?fallback:Number(env[key]);if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid wearable connection monitoring settings');return value;};
 return {timeoutMs:integer('WEARABLE_CONNECTION_TIMEOUT_MS',120000,60000,3600000),intervalMs:integer('WEARABLE_CONNECTION_CHECK_INTERVAL_MS',30000,1000,60000)};
}
export function communicationState(device,now=Date.now()){
 if(!device.active)return 'INACTIVE';
 const age=now-new Date(device.lastSeen).getTime();
 if(!device.lastSeen||!Number.isFinite(age)||age<0)return 'UNKNOWN';
 const timeout=connectionSettings().timeoutMs;
 return age<=Math.min(60000,timeout)?'ONLINE':age<=timeout?'STALE':'OFFLINE';
}
// Called only after a valid authenticated device read (gate state / configuration). Telemetry updates lastSeen
// inside its existing transaction, including successful retries of the same event.
export async function recordDeviceCommunication(db,device){
 return serial(db,async tx=>{
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id=${device.id} FOR UPDATE`;
  const current=await tx.device.findUnique({where:{id:device.id}});
  if(!current?.active||current.tokenHash!==device.tokenHash||current.centerId!==device.centerId)throw fail(401,'DEVICE_UNAUTHORIZED','Device unauthorized');
  const now=await dbTime(tx);
  if(!current.lastSeen||now>current.lastSeen)await tx.device.update({where:{id:device.id},data:{lastSeen:now}});
 });
}
export const connectionDetails=details=>details?.source==='BACKEND_CONNECTION_MONITOR'?{
 lastCommunicationAt:details.lastCommunicationAt,detectedAt:details.detectedAt,timeoutMs:details.timeoutMs,
}:null;

export async function detectWearableConnection(db,deviceId,{timeoutMs=120000}={}){
 return serial(db,async tx=>{
  // Same lock order as ingestion: device, then child. LastSeen and assignment are
  // re-read inside Serializable; a concurrent reconnection cannot race this decision.
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id=${deviceId} FOR UPDATE`;
  const device=await tx.device.findUnique({where:{id:deviceId}}),now=await dbTime(tx);
  if(!device?.active||!device.lastSeen||now-device.lastSeen<=timeoutMs||device.lastSeen>now)return null;
  const assignments=await tx.assignment.findMany({where:{deviceId,endedAt:null,child:{centerId:device.centerId}},take:2});
  if(assignments.length!==1)return null;
  const assignment=assignments[0];
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id=${assignment.childId} FOR UPDATE`;
  const attendance=await tx.attendance.findUnique({where:{childId_day:{childId:assignment.childId,day:attendanceDay(now)}}});
  if(attendance?.status!=='PRESENT')return null;
  const confirmation=await tx.confirmation.findUnique({where:{attendanceId:attendance.id}});
  if(!confirmation||device.lastSeen<confirmation.confirmedAt||device.lastSeen<assignment.startedAt)return null;
  // Reference real telemetry from this assignment, never invent a device observation.
  // Alert.createdAt/details describe server detection; the linked event is last evidence.
  const event=await tx.deviceEvent.findFirst({where:{deviceId,childId:assignment.childId,receivedAt:{gte:assignment.startedAt,lte:device.lastSeen}},orderBy:[{receivedAt:'desc'},{id:'desc'}]});
  if(!event)return null;
  const key=CONNECTION_LOST+':'+createHash('sha256').update(JSON.stringify([device.id,device.lastSeen.toISOString()])).digest('hex');
  if(await tx.alert.findUnique({where:{activityDedupKey:key}}))return null;
  const alert=await tx.alert.create({data:{eventId:event.id,kind:CONNECTION_LOST,activityDedupKey:key,createdAt:now,details:{source:'BACKEND_CONNECTION_MONITOR',centerId:device.centerId,deviceId,hardwareId:device.hardwareId,childId:assignment.childId,assignmentId:assignment.id,attendanceId:attendance.id,lastCommunicationAt:device.lastSeen.toISOString(),detectedAt:now.toISOString(),timeoutMs}}});
  return {id:alert.id,centerId:device.centerId};
 });
}

// One lightweight loop in the existing API process, no new service. A stalled loop
// or DB error restarts a full timeout grace period; it never backfills outage alerts.
export function createConnectionMonitor({db,hub,logger=console,settings=connectionSettings(),clock=()=>performance.now()}){
 let readyAfter=clock()+settings.timeoutMs,lastTick=clock(),busy=false,timer=null,stopped=false;
 let status={state:'STARTING',lastSuccessfulCheckAt:null};
 async function tick(){
  if(stopped||busy)return;
  busy=true;
  try{
   const monotonic=clock();if(monotonic-lastTick>Math.max(settings.timeoutMs,settings.intervalMs*3))readyAfter=monotonic+settings.timeoutMs;
   lastTick=monotonic;
   const now=await dbTime(db);
   if(monotonic<readyAfter){status={...status,state:'RECOVERING'};return;}
   let skip=0;
   for(;;){
    const devices=await db.device.findMany({where:{active:true},select:{id:true},orderBy:{id:'asc'},take:100,skip});
    for(const device of devices){
     if(stopped)return;
     const alert=await detectWearableConnection(db,device.id,settings);
     if(alert){try{hub.publish(alert.centerId,{topics:['alerts','devices'],alertIds:[alert.id]});}catch{logger.error?.({code:'CONNECTION_NOTIFICATION_FAILED'});}}
    }
    if(devices.length<100)break;skip+=100;
   }
   status={state:'MONITORING',lastSuccessfulCheckAt:now.toISOString()};
  }catch{
   readyAfter=clock()+settings.timeoutMs;status={...status,state:'UNAVAILABLE'};
   logger.error?.({code:'WEARABLE_CONNECTION_MONITOR_UNAVAILABLE'});
  }finally{busy=false;}
 }
 return {tick,status:()=>({...status}),start(){if(timer||stopped)return;timer=setInterval(()=>void tick(),settings.intervalMs);timer.unref?.();void tick();},stop(){stopped=true;clearInterval(timer);timer=null;}};
}
