import {TAMPER_TYPES} from './tamper-contract.js';
import {createTransportManager,mountBusDeviceRoutes,mountBusAdminRoutes} from './bus-transport.js';
import {mountRfidReaderRoutes,mountRfidAdminRoutes} from './rfid.js';
import {hydrateConfirmations,rfidInstalled} from './rfid-storage.js';
import { previewConfiguration } from './activity-history.js';
import {recordDeviceCommunication,communicationState} from './wearable-connection.js';
import {mobileLocation} from './mobile-telemetry.js';
import {changeAbsence,teacherAttendanceRoster} from './attendance-absence.js';
import { checkoutAttendance, CHECKOUT_ACTION, checkoutView } from './attendance-checkout.js';
import { verifiedDeparture } from './zone-monitoring.js';
import { registrationValidationFields } from './registration-validation.js';
import { registrationLoginStatus,findLoginUser } from './registration-login.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { eventSchema, identifier, fail, dbTime, attendanceDay, serial, ingest } from './events.js';
import { mountActivityRoutes, ensureActivitySession } from './activity.js';
import { mountBeaconRoutes, deviceBeaconStates, latestObservation } from './beacons.js';
import { latestReset, RESET_ACTION, ABSENCE_CORRECTION, resetEnabled } from './attendance-reset.js';
import { mountMobileRoutes } from './mobile.js';
import { mountPickupRoutes } from './pickup.js';
import { mountAccountRoutes } from './accounts.js';
import { mountRegistrationPublic, mountRegistrationPrivate } from './registration.js';
import { mountWearableManagement, deviceInventoryQuery, inventoryScope, deviceAssignmentView } from './wearable-management.js';
import { monitoringContext, monitoringDevice, readMonitoringHistory, monitoringEvent, monitoringEventFields } from './device-monitoring.js';
import { readAttendanceMonitoring } from './attendance-monitoring.js';
import { readSafetyAlerts } from './safety-monitoring.js';
import { mountGeofenceFoundation } from './geofence-routes.js';
import { createMonitoringHub, mountMonitoringStream, notifyCommittedTelemetry } from './monitoring-events.js';
import { classifyBackendFailure, developmentFailureLocations } from './failure-diagnostics.js';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
const userView = u => ({id:u.id,username:u.username,role:u.role,centerId:u.centerId});
const asyncRoute = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const jsonEvent = e => e ? {...e,...(e.beacon && e.payload.beaconMetadata ? {beacon:{...e.beacon,...e.payload.beaconMetadata}} : {}),deviceUptimeMs:Number(e.deviceUptimeMs)} : null;
export function createApp({db,jwtSecret,rfidLookupKey=process.env.RFID_UID_HMAC_KEY,adminAuthRouter=null,corsOrigins=[],logger=console,environment=process.env.NODE_ENV,enableDevAttendanceReset=process.env.ENABLE_DEV_ATTENDANCE_RESET,registrationEnabled=process.env.ENABLE_REGISTRATION==='true',publicRegistrationCenterIds=(process.env.PUBLIC_REGISTRATION_CENTER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean),mediaRoot,connectionMonitor,monitoringHub=createMonitoringHub(),transportManager=createTransportManager()}) {
 if(!jwtSecret || jwtSecret.length<32 || jwtSecret.startsWith('REPLACE_')) throw new Error('Configure a random JWT_SECRET of at least 32 characters');
 const activityHistoryPreview=previewConfiguration(environment);
 const devResetEnabled=resetEnabled(environment,enableDevAttendanceReset);
 const app=express();
 app.disable('x-powered-by'); app.use(helmet());
 const committed=async(device,payload,result)=>{
  try{await notifyCommittedTelemetry(db,monitoringHub,device,payload,result);return true;}catch{logger.error({code:'MONITORING_NOTIFICATION_FAILED'});return false;}
 };
 const receive=async(device,payload,options)=>{
  const started=performance.now();const result=await ingest(db,device,payload,options);const committedAt=performance.now();
  const notificationAttemptSucceeded=await committed(device,payload,result);
  if(process.env.CHILDGUARD_LATENCY_DEBUG==='true')logger.info?.({phase:'telemetry_committed',eventType:payload.eventType,beaconId:payload.beaconId??payload.gateId??null,eventId:result.eventId,ingestMs:committedAt-started,notifyMs:performance.now()-committedAt,notificationAttemptSucceeded,duplicate:result.duplicate,alertCreated:result.alertCreated??result.geofence?.alertCreated??false,suppressionReason:result.suppressionReason??result.geofence?.reason??null});
  return result;
 };
 app.use((req,res,next)=>{
  res.on('finish',()=>{
   if(res.statusCode<300 && req.user?.centerId && req.method==='POST' && (/^\/api\/v1\/attendance\/[^/]+\/(confirm|reset|checkout|absence\/correct)\/?$/.test(req.path)||req.path==='/api/v1/attendance/absence'))monitoringHub.publish(req.user.centerId,{topics:['attendance','devices']});
   if(res.statusCode<300 && req.user?.centerId && req.method==='POST' && /^\/api\/v1\/mobile\/pickups\/requests(?:\/|$)/.test(req.path))monitoringHub.publish(req.user.centerId,{topics:['pickups']});
  });next();
 });
 app.use(cors({origin:corsOrigins})); app.use(express.json({limit:'32kb'}));
 app.get('/api/health',asyncRoute(async(req,res)=>{await db.$queryRaw`SELECT 1`; res.json({data:{status:'ok'}});}));
 mountRegistrationPublic(app,{db,asyncRoute,enabled:registrationEnabled,publicCenterIds:z.array(z.string().uuid()).parse(publicRegistrationCenterIds),mediaRoot});
 const rfid=mountRfidReaderRoutes(app,{db,asyncRoute,hub:monitoringHub,key:rfidLookupKey});
 const deviceAuth=asyncRoute(async(req,res,next)=>{
  req.backendStage='device_auth_lookup';
  const deviceId=identifier.parse(req.method==='GET'?req.query.deviceId:req.body.deviceId);
  const device=await db.device.findUnique({where:{hardwareId:deviceId}});
  const supplied=req.get('X-Device-Token');
  const hash=tokenHash(supplied||'');
  if(!device?.active || !supplied || !timingSafeEqual(Buffer.from(hash),Buffer.from(device.tokenHash))) throw fail(401,'DEVICE_UNAUTHORIZED','Device unauthorized');
  req.device=device;req.backendStage='device_authenticated';next();
 });
 const eventRate=rateLimit({windowMs:60000,limit:240,keyGenerator:req=>req.device.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Device telemetry rate exceeded'}}});
 mountBusDeviceRoutes(app,{db,deviceAuth,eventRate,asyncRoute,manager:transportManager,hub:monitoringHub});
 app.post('/api/events',deviceAuth,eventRate,asyncRoute(async(req,res)=>{
  req.backendStage='event_validation';const payload=eventSchema.parse(req.body);req.backendStage='event_ingestion';const result=await receive(req.device,payload);req.backendStage='event_response';
  res.status(result.duplicate?200:201).json({data:result});
 }));
 app.post('/api/events/batch',deviceAuth,eventRate,asyncRoute(async(req,res)=>{
  req.backendStage='batch_validation';const batch=z.object({deviceId:identifier,events:z.array(eventSchema).min(1).max(16)}).strict().parse(req.body);
  if(batch.events.some(p=>p.deviceId!==req.device.hardwareId || (p.eventType!=='ACTIVITY_SUMMARY' && !TAMPER_TYPES.includes(p.eventType) && (!p.beaconId || !['BLE_PROXIMITY','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST'].includes(p.eventType))))) throw fail(422,'INVALID_BATCH','Batch accepts only same-device activity summaries or explicit beacon events');
  const results=[];
  const lastActivity=batch.events.findLastIndex(p=>p.eventType==='ACTIVITY_SUMMARY');
  for(let index=0;index<batch.events.length;index++){
   const payload=batch.events[index];
   // Evaluate after the final activity entry, so earlier minutes cannot alert
   // before an unavailable/recovered newest sensor period in the same batch.
   try{req.backendStage='batch_event_ingestion';const result=await receive(req.device,payload,{evaluate:index===lastActivity});results.push({...result,status:result.duplicate?200:201});}
   catch(e){if(!e.status) throw e;results.push({eventId:payload.eventId,status:e.status,error:{code:e.code,message:e.message}});}
  }
  res.json({data:results});
 }));
 app.get('/api/gate/state',deviceAuth,asyncRoute(async(req,res)=>{
  const gateId=identifier.parse(req.query.gateId);
  const gate=await db.beacon.findFirst({where:{hardwareId:gateId,centerId:req.device.centerId,kind:'GATE'}});
  if(!gate) throw fail(422,'UNKNOWN_GATE','Gate not registered in device center');
  if(!gate.active) throw fail(422,'BEACON_INACTIVE','Gate is inactive');
  const now=await dbTime(db); const day=attendanceDay(now);
  const assignment=await db.assignment.findFirst({where:{deviceId:req.device.id,endedAt:null,child:{centerId:req.device.centerId}}});
  const state=assignment ? await db.attendance.findUnique({where:{childId_day:{childId:assignment.childId,day}}}) : null;
  const reset=state ? await latestReset(db,state.id) : null;
  const boot=identifier.max(80).optional().parse(req.query.deviceBootId);
  const confirmation=boot&&state?.status==='PRESENT'?await db.confirmation.findUnique({where:{attendanceId:state.id}}):null;
  const departure=await verifiedDeparture(db,{device:req.device,assignment,attendance:state,confirmation,resetCycle:reset,boot});
  await recordDeviceCommunication(db,req.device);
  res.json({tamperAssignmentId:assignment?.id??null,tamperMonitoringActive:Boolean(req.device.active&&assignment),zoneMonitoringArmed:Boolean(departure),zoneDepartureUptimeMs:departure?Number(departure.deviceUptimeMs):0,zoneMonitoringSession:departure?createHash('sha256').update(departure.payload.zoneDeparture.key).digest('hex'):'',...(reset ? {attendanceEpoch:reset.id} : {}),attendanceStatus:state?.status||'NOT_CHECKED_IN',gatePassAuthorized:state?.gatePassAuthorized||false,attendanceDay:day});
 }));
 const dummyHash=bcrypt.hashSync('invalid-credential-placeholder',12);
 if(adminAuthRouter) app.use(adminAuthRouter);
 else {
 app.post('/api/v1/auth/login',rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Try again later'}}}),asyncRoute(async(req,res)=>{
  const body=z.object({username:z.string().trim().min(1).max(254),password:z.string().min(1).max(200)}).strict().parse(req.body);
  const user=await findLoginUser(db,body.username);
  if(!user){const application=await registrationLoginStatus(db,body.username,body.password,dummyHash);if(application)throw fail(403,application.code,application.message);throw fail(401,'INVALID_CREDENTIALS','Invalid credentials');}
  const valid=await bcrypt.compare(body.password,user.passwordHash||dummyHash);
  if(!valid||!user?.active||!['ADMIN','TEACHER','PARENT'].includes(user.role)) throw fail(401,'INVALID_CREDENTIALS','Invalid credentials');
  const token=jwt.sign({},jwtSecret,{subject:user.id,expiresIn:'1h',issuer:'childguard',audience:'childguard-app',algorithm:'HS256'});
  res.json({data:{token,user:userView(user),expiresIn:3600}});
 }));
 app.use('/api/v1',asyncRoute(async(req,res,next)=>{
  let claims; try { claims=jwt.verify((req.get('Authorization')||'').replace(/^Bearer /,''),jwtSecret,{algorithms:['HS256'],issuer:'childguard',audience:'childguard-app'}); }
  catch { throw fail(401,'UNAUTHENTICATED','Sign in required'); }
  const user=await db.user.findUnique({where:{id:claims.sub}});
  if(!user?.active) throw fail(401,'UNAUTHENTICATED','Sign in required');
  req.user=user;req.authTransport='legacy-mobile';
  req.validateMobileStream=async()=>{
   const header=req.get('Authorization')||'';
   let claims;try{claims=jwt.verify(header.replace(/^Bearer /,''),jwtSecret,{algorithms:['HS256'],issuer:'childguard',audience:'childguard-app'});}catch{throw fail(401,'UNAUTHENTICATED','Sign in required');}
   const current=await db.user.findUnique({where:{id:claims.sub}});
   if(!current?.active||!['PARENT','TEACHER'].includes(current.role))throw fail(401,'UNAUTHENTICATED','Sign in required');
   return {user:userView(current),expiresAt:typeof claims.exp==='number'?claims.exp*1000:null};
  };next();
 }));
 } // Cookie admission failures never fall through to legacy Admin JWT admission.
 mountGeofenceFoundation(app,{db,asyncRoute});
 app.get('/api/v1/auth/me',(req,res)=>res.json({data:{...userView(req.user),devAttendanceResetEnabled:devResetEnabled && req.user.role==='ADMIN'}}));
 mountMonitoringStream(app,{hub:monitoringHub,asyncRoute});
 mountBusAdminRoutes(app,{db,asyncRoute,manager:transportManager,hub:monitoringHub});
 mountRfidAdminRoutes(app,{db,asyncRoute,ready:rfid.ready});
 mountMobileRoutes(app,{db,asyncRoute,registrationEnabled,monitoringHub,jwtSecret,activityHistoryPreview,transportManager});
 mountPickupRoutes(app,{db,asyncRoute,codeTtlMinutes:process.env.PICKUP_CODE_TTL_MINUTES??60});
 mountAccountRoutes(app,{db,asyncRoute,registrationEnabled});
 mountRegistrationPrivate(app,{db,asyncRoute,enabled:registrationEnabled,mediaRoot});
 mountWearableManagement(app,{db,asyncRoute,hashDeviceToken:tokenHash});
 app.use('/api/v1',(req,res,next)=>['ADMIN','TEACHER'].includes(req.user.role)?next():next(fail(403,'FORBIDDEN','Role not permitted')));
 app.get('/api/v1/admin/children/:id/location',asyncRoute(async(req,res)=>{
  if(req.user.role!=='ADMIN'||req.authTransport!=='admin-cookie')throw fail(403,'FORBIDDEN','Admin session required');
  const id=z.string().uuid().parse(req.params.id);
  const child=await db.child.findFirst({where:{id,centerId:req.user.centerId},select:{id:true,name:true,centerId:true}});
  if(!child)throw fail(404,'NOT_FOUND','Child not found');
  const result=await mobileLocation(db,child);
  const d=result.device;
  const gps={...result.gpsMonitoring};
  // The shared telemetry window is 24 hours. A child-location read may still
  // display an older genuine fix, never substituted from another child/device.
  if(d&&!gps.lastValidLocation){
   const [saved]=await db.deviceEvent.findMany({where:{deviceId:d.id,childId:child.id,device:{centerId:child.centerId},receivedAt:{lte:new Date(result.serverTime)},AND:[{payload:{path:['gpsStatus'],equals:'GPS_FIX'}},{payload:{path:['latitude'],gte:-90,lte:90}},{payload:{path:['longitude'],gte:-180,lte:180}}]},select:monitoringEventFields,orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{receivedAt:'desc'},{id:'desc'}],take:1});
   const e=saved?monitoringEvent(saved,child.centerId):null;
   if(e&&typeof e.payload.latitude==='number'&&Number.isFinite(e.payload.latitude)&&Math.abs(e.payload.latitude)<=90&&typeof e.payload.longitude==='number'&&Number.isFinite(e.payload.longitude)&&Math.abs(e.payload.longitude)<=180)gps.lastValidLocation={latitude:e.payload.latitude,longitude:e.payload.longitude,observedAt:e.observedAt,receivedAt:e.receivedAt,timingBasis:e.timingBasis,recordedChildId:child.id,state:'HISTORICAL'};
  }
  if(gps.lastValidLocation&&d?.connectionState!=='ONLINE')gps.lastValidLocation={...gps.lastValidLocation,state:'HISTORICAL'};
  res.set('Cache-Control','no-store').json({data:{child:{id:child.id,name:child.name},device:d?{id:d.id,hardwareId:d.hardwareId,active:d.active,lastSeen:d.lastSeen,connectionState:d.connectionState}:null,gpsMonitoring:gps,geofence:result.geofence,configurationAvailable:result.configurationAvailable,serverTime:result.serverTime}});
 }));
 const pageSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0)});
 mountBeaconRoutes(app,{db,asyncRoute,deviceAuth,pageSchema});
 mountActivityRoutes(app,{db,asyncRoute,pageSchema,activityHistoryPreview});
 async function status(device) {
  const events=await db.deviceEvent.findMany({where:{deviceId:device.id},orderBy:[{receivedAt:'desc'},{id:'desc'}],take:1});
  const latestOf=async types=>jsonEvent(await db.deviceEvent.findFirst({where:{deviceId:device.id,eventType:{in:types}},orderBy:[{receivedAt:'desc'},{id:'desc'}]}));
  const gate=await db.beacon.findFirst({where:{centerId:device.centerId,kind:'GATE'},orderBy:{hardwareId:'asc'}});
  const ble = gate ? jsonEvent(await latestObservation(db,{deviceId:device.id,beaconId:gate.id})) : null;
  const observedAt = ble ? new Date(ble.receivedAt).getTime() - ble.payload.queueAgeMs : null;
  const bleState = {beaconType:ble ? 'Gate / Attendance + Danger Zone' : null,gateId:ble ? gate.hardwareId : null, proximity:ble?.payload.proximity ?? 'UNKNOWN', rssi:ble?.payload.rssi ?? null, observedAt:observedAt === null ? null : new Date(observedAt).toISOString(), receivedAt:ble?.receivedAt ?? null, stale:observedAt === null || Date.now()-observedAt>45000, staleAfterMs:45000};
  return {beaconStates:await deviceBeaconStates(db,device),bleState,id:device.id,hardwareId:device.hardwareId,active:device.active,lastSeen:device.lastSeen,connectionState:communicationState(device),batteryPercent:null,latestEvent:jsonEvent(events[0]),gps:await latestOf(['GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','CHILD_NEAR_GATE']),ble:await latestOf(['CHILD_NEAR_GATE','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST']),mpu6050:await latestOf(['ACTIVITY_SUMMARY','ACTIVITY_WINDOW','ACTIVITY_SAMPLE_GAP'])};
 }
 app.get('/api/v1/monitoring/connection-status',asyncRoute(async(req,res)=>res.set('Cache-Control','no-store').json({data:connectionMonitor?.status()??{state:'UNAVAILABLE',lastSuccessfulCheckAt:null}})));
 app.get('/api/v1/devices',asyncRoute(async(req,res)=>{
  const q=deviceInventoryQuery.parse(req.query),{limit,offset}=q;
  if(q.management&&limit>25)throw fail(422,'VALIDATION_ERROR','Monitoring pages contain at most 25 devices');
  const scope=inventoryScope(req,q);
  const devices=await db.device.findMany({where:scope,take:limit,skip:offset,orderBy:{hardwareId:'asc'}});
  const context=q.management?await monitoringContext(db,req.user.centerId):null;
  res.set('Cache-Control','no-store').json({data:await Promise.all(devices.map(async d=>q.management?{...await monitoringDevice(db,d,context),...await deviceAssignmentView(db,d)}:await status(d))),page:{limit,offset}});
 }));
 app.get('/api/v1/devices/:id',asyncRoute(async(req,res)=>{
  const q=z.object({management:z.literal('true').optional()}).strict().parse(req.query);
  if(q.management){inventoryScope(req,q);z.string().uuid().parse(req.params.id);}
  const d=await db.device.findFirst({where:{id:req.params.id,centerId:req.user.centerId}});
  if(!d) throw fail(404,'NOT_FOUND','Device not found');
  const context=q.management?await monitoringContext(db,req.user.centerId):null;
  res.set('Cache-Control','no-store').json({data:q.management?{...await monitoringDevice(db,d,context),...await deviceAssignmentView(db,d,true)}:await status(d)});
 }));
 app.get('/api/v1/events',asyncRoute(async(req,res)=>{
  if(req.query.management!==undefined)return res.set('Cache-Control','no-store').json({data:await readMonitoringHistory(db,req)});
  const {limit,offset}=pageSchema.parse(req.query);
  const deviceId=req.query.deviceId===undefined?undefined:identifier.parse(req.query.deviceId);
  const events=await db.deviceEvent.findMany({where:{device:{centerId:req.user.centerId},deviceId},orderBy:[{receivedAt:'desc'},{id:'desc'}],take:limit,skip:offset});
  res.json({data:events.map(jsonEvent),page:{limit,offset}});
 }));
 app.get('/api/v1/attendance/roster',asyncRoute(async(req,res)=>res.set('Cache-Control','no-store').json(await teacherAttendanceRoster(db,req))));
 app.post('/api/v1/attendance/absence',asyncRoute(async(req,res)=>res.json({data:await changeAbsence(db,req)})));
 app.post('/api/v1/attendance/:id/absence/correct',asyncRoute(async(req,res)=>res.json({data:await changeAbsence(db,req,true)})));
 app.get('/api/v1/attendance/pending-count',asyncRoute(async(req,res)=>{
  const day=attendanceDay(await dbTime(db));
  const count=await db.attendance.count({where:{day,status:'CHECKIN_PENDING',child:{centerId:req.user.centerId}}});
  res.json({data:{count,day}});
 }));
 app.get('/api/v1/attendance',asyncRoute(async(req,res)=>{
  if(req.query.management!==undefined)return res.set('Cache-Control','no-store').json({data:await readAttendanceMonitoring(db,req,{devResetEnabled})});
  const day=attendanceDay(await dbTime(db));
  const {limit,offset}=pageSchema.parse({limit:req.query.limit??100,offset:req.query.offset});
  const status=z.enum(['NOT_CHECKED_IN','CHECKIN_PENDING','PRESENT','CHECKED_OUT','ABSENT']).optional().parse(req.query.status);
  const rows=await db.attendance.findMany({where:{day,status,child:{centerId:req.user.centerId}},include:{child:{select:{id:true,name:true}},observations:{orderBy:{event:{receivedAt:'asc'}},take:1,include:{event:{include:{device:{select:{hardwareId:true}},beacon:{select:{hardwareId:true}}}}}},confirmations:{include:{user:{select:{id:true,username:true,role:true}}}}},take:limit,skip:offset,orderBy:{id:'asc'}});
  await hydrateConfirmations(db,rows);
  const audits=await db.auditLog.findMany({where:{resourceId:{in:rows.map(a=>a.id)},action:{in:['ATTENDANCE_CONFIRMED_ADMIN','ATTENDANCE_CONFIRMED_TEACHER']}}});
  const history=await db.auditLog.findMany({where:{resourceId:{in:rows.map(a=>a.id)},action:{startsWith:'ATTENDANCE_CONFIRMATION_SNAPSHOT:'}},include:{user:{select:{id:true,username:true}}},orderBy:{createdAt:'asc'}});
  const resets=await db.auditLog.findMany({where:{resourceId:{in:rows.map(a=>a.id)},action:{in:[RESET_ACTION,ABSENCE_CORRECTION]}},include:{user:{select:{id:true,username:true}}},orderBy:{createdAt:'desc'}});
  await Promise.all(rows.map(async a=>{const reset=resets.find(r=>r.resourceId===a.id);if(reset) {a.originalArrival=a.observations[0] ? {...a.observations[0],event:jsonEvent(a.observations[0].event)} : null;a.observations=await db.observation.findMany({where:{attendanceId:a.id,event:{receivedAt:{gt:reset.createdAt}}},take:1,orderBy:{event:{receivedAt:'asc'}},include:{event:{include:{device:{select:{hardwareId:true}},beacon:{select:{hardwareId:true}}}}}});}}));
  const checkoutLogs=rows.length?await db.auditLog.findMany({where:{resourceId:{in:rows.map(a=>a.id)},action:{startsWith:CHECKOUT_ACTION}},include:{user:{select:{username:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}]}):[];
  const pendingPickups=req.user.role==='TEACHER'&&db.pickupRequest?.findMany?await db.pickupRequest.findMany({where:{centerId:req.user.centerId,childId:{in:rows.map(a=>a.childId)},day,status:'PENDING',expiresAt:{gt:await dbTime(db)}},select:{childId:true}}):[];
  res.json({data:rows.map(a=>({...a,checkout:a.status==='CHECKED_OUT'?checkoutView(checkoutLogs.find(log=>log.resourceId===a.id)):null,canCheckout:req.user.role==='TEACHER'&&a.status==='PRESENT'&&a.confirmations.length>0&&Boolean(db.pickupRequest?.findMany)&&!pendingPickups.some(p=>p.childId===a.childId),checkoutBlockedByPickup:pendingPickups.some(p=>p.childId===a.childId),attendanceEpoch:resets.find(r=>r.resourceId===a.id)?.id,confirmationHistory:history.filter(r=>r.resourceId===a.id).map(r=>({user:r.user,...JSON.parse(r.action.slice('ATTENDANCE_CONFIRMATION_SNAPSHOT:'.length))})),canReset:devResetEnabled && req.user.role==='ADMIN' && a.status==='PRESENT' && a.confirmations[0]?.method!=='RFID_CARD',resetHistory:resets.filter(r=>r.resourceId===a.id).map(r=>({id:r.id,userId:r.userId,user:r.user,createdAt:r.createdAt})),canConfirm:req.user.role==='TEACHER'&&a.status==='CHECKIN_PENDING',observations:a.observations.map(o=>({...o,event:jsonEvent(o.event)})),confirmations:a.confirmations.map(c=>({...c,roleAtConfirmation:audits.find(log=>log.resourceId===a.id&&log.userId===c.userId&&log.createdAt.getTime()===c.confirmedAt.getTime())?.action.replace('ATTENDANCE_CONFIRMED_','')??null}))})),day,page:{limit,offset}});
 }));
 app.post('/api/v1/attendance/:id/checkout',asyncRoute(async(req,res)=>res.json({data:await checkoutAttendance(db,req)})));
 app.post('/api/v1/attendance/:id/confirm',asyncRoute(async(req,res)=>{
  if(req.user.role!=='TEACHER')throw fail(403,'FORBIDDEN','Teacher physical-presence confirmation required');
  identifier.parse(req.params.id);
  const body=z.object({attendanceEpoch:identifier.optional()}).strict().parse(req.body||{});
  const result=await serial(db,async tx=>{
   const actor=await tx.user.findUnique({where:{id:req.user.id}});
   if(!actor?.active||actor.role!=='TEACHER'||actor.centerId!==req.user.centerId)throw fail(403,'FORBIDDEN','Authorized center Teacher required');
   let a=await tx.attendance.findFirst({where:{id:req.params.id,child:{centerId:req.user.centerId}}});
   if(!a) throw fail(404,'NOT_FOUND','Attendance not found');
   await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${a.childId} FOR UPDATE`;
   a=await tx.attendance.findUnique({where:{id:a.id}});
   const now=await dbTime(tx);
   if(a.day!==attendanceDay(now)) throw fail(409,'INVALID_TRANSITION','Only todayÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s pending arrival can be confirmed');
   const reset=await latestReset(tx,a.id);
   if(reset && body.attendanceEpoch!==reset.id) throw fail(409,'ATTENDANCE_CYCLE_CHANGED','Refresh attendance before approving');
   const existing=await tx.confirmation.findUnique({where:{attendanceId:a.id}});
   if(a.status==='PRESENT' && existing) return a; // Safe retry/concurrent approval.
   if(a.status!=='CHECKIN_PENDING' || (existing && !reset)) throw fail(409,'INVALID_TRANSITION','Only todayÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s pending arrival can be confirmed');
   const methodFields=await rfidInstalled(tx)?{method:'TEACHER',readerId:null,rfidCardId:null,rfidScanId:null}:{};
   await tx.confirmation.upsert({where:{attendanceId:a.id},create:{attendanceId:a.id,userId:req.user.id,confirmedAt:now,...methodFields},update:{userId:req.user.id,confirmedAt:now,...methodFields}});
   await ensureActivitySession(tx,a,now);
   // Immutable role snapshot in the existing audit record; never impersonate a teacher.
   await tx.auditLog.create({data:{userId:req.user.id,action:`ATTENDANCE_CONFIRMED_${req.user.role}`,resourceId:a.id,createdAt:now}});
   return tx.attendance.update({where:{id:a.id},data:{status:'PRESENT'}});
  });
  res.json({data:result});
 }));
 app.post('/api/v1/attendance/:id/reset',asyncRoute(async(req,res)=>{
  if(!devResetEnabled) throw fail(403,'DEV_RESET_DISABLED','Development attendance reset is disabled');
  if(req.user.role!=='ADMIN') throw fail(403,'FORBIDDEN','Administrator required');
  const body=z.object({confirmedAt:z.string().datetime()}).strict().parse(req.body);
  const result=await serial(db,async tx=>{
   let a=await tx.attendance.findFirst({where:{id:req.params.id,child:{centerId:req.user.centerId}}});
   if(!a) throw fail(404,'NOT_FOUND','Attendance not found');
   await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${a.childId} FOR UPDATE`;
   a=await tx.attendance.findUnique({where:{id:a.id}});
   const now=await dbTime(tx), confirmation=await tx.confirmation.findUnique({where:{attendanceId:a.id}});
   if(confirmation?.method==='RFID_CARD')throw fail(409,'RFID_RESET_UNSUPPORTED','RFID confirmation cannot use the Teacher development reset');
   if(a.day!==attendanceDay(now) || !confirmation || confirmation.confirmedAt.toISOString()!==body.confirmedAt) throw fail(409,'INVALID_TRANSITION','Refresh todayÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s confirmed attendance before resetting');
   const reset=await latestReset(tx,a.id);
   if(a.status==='NOT_CHECKED_IN' && reset) return a;
   if(a.status!=='PRESENT') throw fail(409,'INVALID_TRANSITION','Only confirmed PRESENT attendance can be reset');
   await tx.auditLog.create({data:{userId:confirmation.userId,resourceId:a.id,action:'ATTENDANCE_CONFIRMATION_SNAPSHOT:'+JSON.stringify({confirmationId:confirmation.id,userId:confirmation.userId,confirmedAt:confirmation.confirmedAt.toISOString()}),createdAt:confirmation.confirmedAt}});
   await tx.auditLog.create({data:{userId:req.user.id,resourceId:a.id,action:RESET_ACTION,createdAt:now}});
   await tx.activityAttendanceSession.updateMany({where:{attendanceId:a.id,endedAt:null},data:{endedAt:now}});
   return tx.attendance.update({where:{id:a.id},data:{status:'NOT_CHECKED_IN',gatePassAuthorized:false}});
  });
  res.json({data:result});
 }));
 app.get('/api/v1/alerts',asyncRoute(async(req,res)=>{
  if(req.query.management!==undefined)return res.set('Cache-Control','no-store').json({data:await readSafetyAlerts(db,req)});
  const {limit,offset}=pageSchema.parse({limit:req.query.limit??100,offset:req.query.offset});
  const alerts=await db.alert.findMany({where:{event:{device:{centerId:req.user.centerId}}},include:{event:{include:{child:{select:{id:true,name:true}},device:{select:{hardwareId:true}},beacon:{select:{hardwareId:true,name:true,location:true,kind:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit,skip:offset});
  res.json({data:alerts.map(a=>({...a,status:'RECORDED',event:jsonEvent(a.event)})),page:{limit,offset}});
 }));
 app.use((req,res,next)=>next(fail(404,'NOT_FOUND','Endpoint not found')));
 app.use((err,req,res,next)=>{ // eslint-disable-line no-unused-vars
  const diagnostics=classifyBackendFailure(err);
  if(environment==='development'&&['event_ingestion','batch_event_ingestion'].includes(req.backendStage))logger.error({code:'INGESTION_EXCEPTION_LOCATION',stage:req.backendStage,causes:JSON.stringify(developmentFailureLocations(err))});
  const classifiedDatabaseFailure=diagnostics.kind!=='UNCLASSIFIED';
  const status=err instanceof ZodError?422:err.type==='entity.parse.failed'?400:err.status||(classifiedDatabaseFailure?diagnostics.httpStatus:503);
  const code=err instanceof ZodError?'VALIDATION_ERROR':err.type==='entity.parse.failed'?'INVALID_JSON':err.code&&err.status?err.code:classifiedDatabaseFailure?diagnostics.responseCode:'SERVICE_UNAVAILABLE';
  if(status>=500) logger.error({code:err.code==='P2010'||diagnostics.sqlState==='42501'?'DATABASE_PERMISSION_FAILURE':diagnostics.kind==='DATABASE_UNAVAILABLE'?'DATABASE_UNAVAILABLE':'REQUEST_FAILED',method:req.method,endpoint:typeof req.route?.path==='string'?req.route.path:'unmatched',stage:req.backendStage??'request_pipeline',failureClass:diagnostics.kind,prismaCode:diagnostics.prismaCode,sqlState:diagnostics.sqlState});
  if(err.code==='CENTER_UNAVAILABLE' && err.status===422) return res.status(422).json({error:{code:err.code,message:'Select an available center.',fields:{centerId:'This center is unavailable for public registration. Refresh the center list.'}}});
  if(err instanceof ZodError && ['/api/v1/registration','/api/v1/registration/resubmit'].includes(req.path)) {
   return res.status(422).json({error:{code,message:'Check the highlighted registration fields.',fields:registrationValidationFields(err)}});
  }
  const safeServerMessage=diagnostics.kind.startsWith('DATABASE_')&&diagnostics.kind!=='DATABASE_UNAVAILABLE'?'Service configuration error':'Service temporarily unavailable';
  res.status(status).json({error:{code,message:status>=500?safeServerMessage:err instanceof ZodError?'Invalid request payload':err.type==='entity.parse.failed'?'Malformed JSON':err.message}});
 });
 return app;
}
