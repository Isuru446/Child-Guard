import {recordDeviceCommunication} from './wearable-connection.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { dbTime, fail, identifier, serial } from './events.js';
export const GATE_ID='CG-GATE-01';
export const GATE_UUID='7b700001-24a6-4a25-9d3b-21c547a10001';
export const MAX_BEACONS=8;
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const fields={name:z.string().trim().min(1).max(100),location:z.string().trim().min(1).max(150),description:z.string().trim().max(500).default(''),entryRssi:z.number().finite().min(-127).max(0),exitRssi:z.number().finite().min(-127).max(0),attendanceRssi:z.number().finite().min(-127).max(0).nullable().default(null),active:z.boolean(),serviceUuid:uuid};
export const registrationSchema=z.object({hardwareId:identifier.max(48),kind:z.enum(['GATE','DANGER_ZONE']),...fields}).strict();
export const editSchema=z.object({...fields,identityChangeAcknowledged:z.boolean().optional()}).strict();
function thresholds(b){
 if(b.exitRssi>b.entryRssi-3 || (b.kind==='GATE' && (b.attendanceRssi===null || b.attendanceRssi<b.entryRssi)) || (b.kind==='DANGER_ZONE' && b.attendanceRssi!==null)) throw fail(422,'INVALID_THRESHOLDS','Exit must be at least 3 dBm below entry; attendance is gate-only and must be at least entry');
}
export async function activeConfiguration(db,centerId){
 const beacons=await db.beacon.findMany({where:{centerId,active:true},take:MAX_BEACONS+1,orderBy:{hardwareId:'asc'}});
 if(beacons.length>MAX_BEACONS) throw fail(409,'CONFIG_TOO_LARGE',`Maximum ${MAX_BEACONS} active beacons`);
 if(beacons.filter(b=>b.kind==='GATE').length!==1 || beacons.some(b=>!['GATE','DANGER_ZONE'].includes(b.kind)||!uuid.safeParse(b.serviceUuid).success || (b.kind==='GATE' && (b.hardwareId!==GATE_ID || b.serviceUuid!==GATE_UUID)))) throw fail(409,'CONFIG_INVALID','Registered beacon configuration requires administrator review');
 for(const b of beacons) thresholds(b);
 const list=beacons.map(b=>({beaconId:b.hardwareId,serviceUuid:b.serviceUuid,kind:b.kind,entryRssi:b.entryRssi,exitRssi:b.exitRssi,attendanceRssi:b.attendanceRssi}));
 return {revision:createHash('sha256').update(JSON.stringify(list)).digest('hex'),maxBeacons:MAX_BEACONS,refreshAfterMs:60000,validForMs:300000,beacons:list};
}
const eventView=e=>e?{...e,deviceUptimeMs:Number(e.deviceUptimeMs)}:null;
export async function latestObservation(db,where){
 return db.deviceEvent.findFirst({where:{...where,eventType:'BLE_PROXIMITY'},orderBy:[{observedAt:'desc'},{receivedAt:'desc'},{id:'desc'}],include:{device:{select:{hardwareId:true}}}});
}
export function proximityView(event,active=true){
 const observedAt=event?.observedAt ?? (event ? new Date(event.receivedAt.getTime()-(event.payload.queueAgeMs||0)) : null);
 const age=observedAt?Date.now()-observedAt.getTime():NaN;
 const stale=!Number.isFinite(age)||age<0||age>45000;
 return {proximity:active && !stale ? event?.payload.proximity || 'UNKNOWN' : 'UNKNOWN',reportedProximity:event?.payload.proximity||'UNKNOWN',rssi:event?.payload.rssi??null,observedAt,receivedAt:event?.receivedAt??null,stale,staleAfterMs:45000,wearableId:event?.device?.hardwareId??null};
}
async function currentObservation(db,b,deviceId){return latestObservation(db,{beaconId:b.id,...(deviceId?{deviceId}:{}),...(b.kind==='DANGER_ZONE'?{payload:{path:['beaconUuid'],equals:b.serviceUuid}}:{})});}
export async function beaconView(db,b){return {...b,registrationStatus:b.serviceUuid?'REGISTERED':'IDENTITY_REQUIRED',observation:proximityView(await currentObservation(db,b),b.active)};}
export function mountBeaconRoutes(app,{db,asyncRoute,deviceAuth,pageSchema}){
 app.get('/api/device/beacons',deviceAuth,asyncRoute(async(req,res)=>{const data=await activeConfiguration(db,req.device.centerId);await recordDeviceCommunication(db,req.device);res.set('Cache-Control','no-store').json({data});}));
 // JWT middleware is already mounted by the caller before these /api/v1 routes.
 const admin=(req,res,next)=>req.user.role==='ADMIN'?next():next(fail(403,'FORBIDDEN','Administrator required'));
 app.get('/api/v1/beacons',asyncRoute(async(req,res)=>{
  const {limit,offset}=pageSchema.parse(req.query);
  const rows=await db.beacon.findMany({where:{centerId:req.user.centerId},take:limit,skip:offset,orderBy:{hardwareId:'asc'}});
  res.json({data:await Promise.all(rows.map(b=>beaconView(db,b))),page:{limit,offset}});
 }));
 // Independent of pagination and active status: an inactive gate still owns its identity.
 app.get('/api/v1/beacons/gate-registration',admin,asyncRoute(async(req,res)=>{
  const gate=await db.beacon.findFirst({where:{centerId:req.user.centerId,kind:'GATE'},select:{id:true,hardwareId:true,serviceUuid:true,active:true,name:true,location:true}});
  res.set('Cache-Control','no-store');res.json({data:{gate,hardwareId:GATE_ID,serviceUuid:GATE_UUID}});
 }));
 app.get('/api/v1/beacons/:id',asyncRoute(async(req,res)=>{
  const b=await db.beacon.findFirst({where:{id:req.params.id,centerId:req.user.centerId}});
  if(!b) throw fail(404,'NOT_FOUND','Beacon not found');res.json({data:await beaconView(db,b)});
 }));
 app.get('/api/v1/beacons/:id/events',asyncRoute(async(req,res)=>{
  const b=await db.beacon.findFirst({where:{id:req.params.id,centerId:req.user.centerId}});
  if(!b) throw fail(404,'NOT_FOUND','Beacon not found');
  const {limit,offset}=pageSchema.parse(req.query);
  const eventType=z.enum(['BLE_PROXIMITY','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','CHILD_NEAR_GATE']).optional().parse(req.query.eventType);
  const rows=await db.deviceEvent.findMany({where:{beaconId:b.id,eventType},orderBy:{receivedAt:'desc'},take:limit,skip:offset});
  res.json({data:rows.map(eventView),page:{limit,offset}});
 }));
 app.post('/api/v1/beacons',admin,asyncRoute(async(req,res)=>{
  const body=registrationSchema.parse(req.body);thresholds(body);
  if(body.kind==='GATE' && (body.hardwareId!==GATE_ID || body.serviceUuid!==GATE_UUID || !body.active)) throw fail(422,'INVALID_GATE_IDENTITY','First gate must be active and match the provisioned CG-GATE-01 ID and broadcast UUID');
  if(body.kind==='DANGER_ZONE' && (body.hardwareId===GATE_ID || body.serviceUuid===GATE_UUID)) throw fail(409,'GATE_PROTECTED','Gate identity is reserved for the primary gate');
  const row=await save(req,null,body);res.status(201).json({data:row});
 }));
 app.patch('/api/v1/beacons/:id',admin,asyncRoute(async(req,res)=>{
  const body=editSchema.parse(req.body);res.json({data:await save(req,req.params.id,body)});
 }));
 async function save(req,id,body){
  try{return await serial(db,async tx=>{
   await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${req.user.centerId} FOR UPDATE`;
   const old=id ? await tx.beacon.findFirst({where:{id,centerId:req.user.centerId}}) : null;
   if(id && !old) throw fail(404,'NOT_FOUND','Beacon not found');
   if(!id && body.kind==='GATE' && await tx.beacon.findFirst({where:{centerId:req.user.centerId,kind:'GATE'}})) throw fail(409,'GATE_EXISTS','This center already has a gate, including inactive gates; review the existing registration');
   if(!id && await tx.beacon.findFirst({where:{OR:[{hardwareId:body.hardwareId},{serviceUuid:body.serviceUuid}]}})) throw fail(409,'BEACON_CONFLICT','Beacon ID or service UUID is already registered');
   const merged={...old,...body};thresholds(merged);
   if(merged.kind==='DANGER_ZONE' && body.serviceUuid===GATE_UUID) throw fail(409,'GATE_PROTECTED','Gate UUID is reserved');
   if(old?.kind==='GATE' && (!body.active || body.serviceUuid!==GATE_UUID || old.hardwareId!==GATE_ID)) throw fail(409,'GATE_PROTECTED','Primary gate identity and activation are protected');
   if(old && old.serviceUuid!==body.serviceUuid && !body.identityChangeAcknowledged) throw fail(409,'PROVISIONING_ACK_REQUIRED','Confirm physical beacon reprovisioning before changing its UUID');
   if(!old?.active && body.active && await tx.beacon.count({where:{centerId:req.user.centerId,active:true}})>=MAX_BEACONS) throw fail(409,'CONFIG_TOO_LARGE',`Maximum ${MAX_BEACONS} active beacons`);
   const {identityChangeAcknowledged,...data}=body;void identityChangeAcknowledged;
   const now=await dbTime(tx);
   const row=old ? await tx.beacon.update({where:{id:old.id},data:{...data,updatedById:req.user.id,updatedAt:now}}) : await tx.beacon.create({data:{...data,centerId:req.user.centerId,createdById:req.user.id,updatedById:req.user.id,createdAt:now,updatedAt:now}});
   await tx.auditLog.create({data:{userId:req.user.id,resourceId:row.id,action:old?'BEACON_UPDATED':'BEACON_REGISTERED',createdAt:now}});
   return row;
  });}catch(e){if(e.code==='P2002') throw fail(409,'BEACON_CONFLICT','Beacon ID or service UUID is already registered');throw e;}
 }
}
// Observations are independent per registered beacon; an unobserved row is UNKNOWN.
export async function deviceBeaconStates(db,device){
 const beacons=await db.beacon.findMany({where:{centerId:device.centerId,active:true},orderBy:{hardwareId:'asc'},take:MAX_BEACONS});
 return Promise.all(beacons.map(async b=>({beaconId:b.hardwareId,name:b.name,location:b.location,kind:b.kind,serviceUuid:b.serviceUuid,...proximityView(await currentObservation(db,b,device.id),device.active)})));
}
