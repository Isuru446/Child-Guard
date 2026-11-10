import { tamperSchema, TAMPER_TYPES } from './tamper-contract.js';
import { dbTime, fail, serial } from './events.js';
import { tracedTamperTransaction } from './failure-diagnostics.js';

const canonical=p=>JSON.stringify(p,Object.keys(p).filter(k=>!['queueAgeMs','timingUncertain'].includes(k)).sort());
// A single current marker is maintained under the Device row lock. Raw
// observations remain immutable; this JSON marker is read-model metadata.
const acceptedWhere={eventType:{in:TAMPER_TYPES},payload:{path:['tamperCurrent'],equals:true}};
export async function ingestTamper(db,device,input){
 const p=tamperSchema.parse(input);
 return serial(db,async raw=>{
  const tx=tracedTamperTransaction(raw);
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id=${device.id} FOR UPDATE`;
  const current=await tx.device.findUnique({where:{id:device.id}});
  if(!current?.active||current.centerId!==device.centerId||current.tokenHash!==device.tokenHash||p.deviceId!==device.hardwareId)throw fail(401,'DEVICE_UNAUTHORIZED','Device unauthorized');
  const old=await tx.deviceEvent.findUnique({where:{eventId:p.eventId}});
  if(old){
   const {tamperCurrent,tamperOrderAccepted,tamperAlertEligible,...original}=old.payload;
   if(old.deviceId!==device.id||canonical(original)!==canonical(p))throw fail(409,'EVENT_ID_CONFLICT','Event ID already used');
   await tx.device.update({where:{id:device.id},data:{lastSeen:await dbTime(tx)}});
   return {eventId:p.eventId,duplicate:true};
  }
  const now=await dbTime(tx),observedAt=p.timingUncertain?null:new Date(+now-p.queueAgeMs);
  const fresh=!!observedAt&&p.queueAgeMs<=60000;
  const last=await tx.deviceEvent.findFirst({where:{deviceId:device.id,...acceptedWhere},orderBy:[{receivedAt:'desc'},{id:'desc'}]});
  const previous=last?.payload;
  let ordered=!previous;
  if(previous?.tamperEpoch===p.tamperEpoch){
   if(p.tamperSequence===previous.tamperSequence&&(p.tamperState!==previous.tamperState||p.tamperEpisodeId!==previous.tamperEpisodeId))throw fail(409,'TAMPER_ORDER_CONFLICT','Transition sequence has different content');
   ordered=p.tamperSequence>previous.tamperSequence||p.tamperSequence===previous.tamperSequence&&fresh;
  }else if(previous){
   // NVS reset is a new epoch; only a fresh startup can replace its status.
   ordered=fresh&&p.reason==='STARTUP'&&+observedAt>=+new Date(last.observedAt??last.receivedAt);
  }
  const assignments=await tx.assignment.findMany({where:{deviceId:device.id,child:{centerId:device.centerId},
   ...(observedAt?{startedAt:{lte:observedAt},OR:[{endedAt:null},{endedAt:{gt:observedAt}}]}:{id:p.assignmentId??'unavailable',endedAt:null}),
  },take:2});
  const assignment=assignments.length===1&&(!p.assignmentId||assignments[0].id===p.assignmentId)?assignments[0]:null;
  const childId=assignment?.childId??null;
  if(childId)await tx.$queryRaw`SELECT id FROM "Child" WHERE id=${childId} FOR UPDATE`;
  // Fitting a newly assigned wearable has a short, explicit grace period.
  // Still-open periodic status becomes eligible after this period, never normal.
  const fitting=assignment&&Number.isFinite(+new Date(assignment.startedAt))&&+(observedAt??now)-+new Date(assignment.startedAt)<30000;
  const eligible=!!childId&&!fitting&&p.tamperState==='OPEN'&&
   (p.eventType==='TAMPER_LOOP_OPEN'||ordered&&fresh);
  if(ordered&&last)await tx.deviceEvent.update({where:{id:last.id},data:{payload:{...last.payload,tamperCurrent:false}}});
  const event=await tx.deviceEvent.create({data:{eventId:p.eventId,eventType:p.eventType,deviceId:device.id,childId,beaconId:null,
   deviceUptimeMs:BigInt(p.deviceUptimeMs),receivedAt:now,observedAt,
   payload:{...p,tamperCurrent:ordered,tamperOrderAccepted:ordered,tamperAlertEligible:eligible}}});
  let alertCreated=false;
  if(eligible){
   const exists=await tx.alert.findFirst({where:{kind:'TAMPER_LOOP_OPEN',event:{deviceId:device.id,childId},details:{path:['tamperEpisodeId'],equals:p.tamperEpisodeId}}});
   if(!exists){await tx.alert.create({data:{eventId:event.id,kind:'TAMPER_LOOP_OPEN',createdAt:now,details:{
    tamperEpisodeId:p.tamperEpisodeId,tamperEpoch:p.tamperEpoch,tamperSequence:p.tamperSequence,
    assignmentId:assignment.id,tamperState:'OPEN',observationTime:observedAt?.toISOString()??null,
    timingUncertain:p.timingUncertain,source:'AUTHENTICATED_GPIO_LOOP',
   }}});alertCreated=true;}
  }
  await tx.device.update({where:{id:device.id},data:{lastSeen:now}});
  const related=childId&&p.eventType==='TAMPER_LOOP_RESTORED'?await tx.alert.findMany({where:{kind:'TAMPER_LOOP_OPEN',event:{deviceId:device.id,childId},details:{path:['tamperEpisodeId'],equals:p.tamperEpisodeId}},select:{id:true},take:16}):[];
  return {eventId:p.eventId,duplicate:false,alertCreated,tamperOrderAccepted:ordered,tamperAlertIds:related.map(a=>a.id),
   suppressionReason:!childId?'NO_VERIFIED_ASSIGNMENT':fitting?'FITTING_GRACE':null};
 });
}

export async function tamperStatus(db,device,{childId,now=Date.now()}={}){
 const row=await db.deviceEvent.findFirst({where:{deviceId:device.id,device:{centerId:device.centerId},...acceptedWhere,...(childId?{childId}:{})},orderBy:[{receivedAt:'desc'},{id:'desc'}],select:{eventType:true,payload:true,observedAt:true,receivedAt:true,childId:true}});
 const lastKnownState=row?.payload?.tamperState??'UNKNOWN';
 const observed= row?.observedAt ? +new Date(row.observedAt) : NaN;
 const recent=device.active&&device.lastSeen&&now-+new Date(device.lastSeen)>=0&&now-+new Date(device.lastSeen)<=60000&&Number.isFinite(observed)&&now-observed>=0&&now-observed<=60000;
 // Transition timestamp is distinct from a periodic confirmation timestamp.
 const transition=row?await db.deviceEvent.findFirst({where:{deviceId:device.id,eventType:{in:['TAMPER_LOOP_OPEN','TAMPER_LOOP_RESTORED']},
  AND:[{payload:{path:['tamperEpoch'],equals:row.payload.tamperEpoch}},{payload:{path:['tamperSequence'],equals:row.payload.tamperSequence}}],...(childId?{childId}:{})},orderBy:[{receivedAt:'desc'},{id:'desc'}],select:{observedAt:true,receivedAt:true}}):null;
 return {state:recent?lastKnownState:'UNKNOWN',lastKnownState,stale:!recent,source:'AUTHENTICATED_GPIO_LOOP',
  observedAt:row?.observedAt??null,receivedAt:row?.receivedAt??null,transitionAt:transition?.observedAt??null,
  transitionReceivedAt:transition?.receivedAt??null,staleAfterMs:60000};
}
