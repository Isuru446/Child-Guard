// Volatile, single-process university prototype. Never writes Prisma records.
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {attendanceDay,fail,identifier} from './events.js';

export const BUS_UUID='7b70b001-24a6-4a25-9d3b-21c547a10001';
export const transportPolicy=Object.freeze({reportFreshMs:10000,maxQueueMs:2000,boardingReports:3,boardingSpanMs:8000,exitMs:35000,reboardMs:15000,historyMs:12*3600000,maxCenters:32,maxStates:512,maxHistory:64,maxSeen:128});
export function busConfiguration(env=process.env){
 const enabled=env.ENABLE_BUS_TRANSPORT==='true';
 const config={enabled,centerId:env.BUS_TRANSPORT_CENTER_ID??'',busId:env.BUS_ID||'CG-BUS-01',beaconId:env.BUS_BEACON_ID||'CG-BUS-BEACON-01',beaconUuid:(env.BUS_BEACON_UUID||BUS_UUID).toLowerCase(),entryRssi:Number(env.BUS_ENTRY_RSSI??-63),exitRssi:Number(env.BUS_EXIT_RSSI??-72),historyMs:Number(env.BUS_HISTORY_TTL_MS??transportPolicy.historyMs)};
 if(enabled&&(!z.string().uuid().safeParse(config.centerId).success||!z.string().uuid().safeParse(config.beaconUuid).success||config.beaconUuid==='7b700001-24a6-4a25-9d3b-21c547a10001'||![config.busId,config.beaconId].every(v=>identifier.safeParse(v).success)))throw Error('Bus transport requires a valid private center and distinct BLE identity');
 if(enabled&&(!Number.isFinite(config.entryRssi)||!Number.isFinite(config.exitRssi)||config.entryRssi>0||config.exitRssi< -127||config.exitRssi>config.entryRssi-3||!Number.isInteger(config.historyMs)||config.historyMs<60000||config.historyMs>86400000))throw Error('Invalid bus thresholds or retention');
 if(enabled&&(config.beaconId==='CG-GATE-01'||config.beaconUuid==='00000000-0000-0000-0000-000000000000'))throw Error('Bus identity must be distinct and nonzero');
 return config;
}
export const busReportSchema=z.object({deviceId:identifier,eventId:identifier,deviceBootId:identifier.max(80),sequence:z.number().int().nonnegative().max(4294967295),deviceUptimeMs:z.number().int().nonnegative().max(4294967295),sessionEpoch:z.string().max(80),assignmentId:z.string().uuid(),busId:identifier,beaconId:identifier,beaconUuid:z.string().uuid(),queueAgeMs:z.number().int().min(0).max(4294967295),proximity:z.enum(['NEAR','FAR','UNKNOWN']),rssi:z.number().finite().min(-127).max(0).optional(),lastSeenAgeMs:z.number().int().nonnegative().max(4294967295).nullable(),scannerHealthy:z.boolean(),scanWindowMs:z.number().int().min(0).max(60000),healthyScanMs:z.number().int().min(0).max(60000),maxScanGapMs:z.number().int().min(0).max(60000)}).strict().superRefine((p,c)=>{
 if((p.proximity==='UNKNOWN'&&p.rssi!==undefined)||(p.proximity!=='UNKNOWN'&&(p.rssi===undefined||p.lastSeenAgeMs===null||p.lastSeenAgeMs>4000))||p.healthyScanMs>p.scanWindowMs)c.addIssue({code:'custom',message:'Invalid bus scan evidence'});
});
export function createTransportManager({config=busConfiguration(),clock=Date.now,policy={...transportPolicy,historyMs:config.historyMs??transportPolicy.historyMs}}={}){
 const sessions=new Map(),states=new Map();
 const enabled=center=>config.enabled&&center===config.centerId;
 const key=(center,assignment)=>`${center}/${assignment.id}`;
 function clean(){
  const now=clock(),day=attendanceDay(new Date(now));
  for(const [center,s] of sessions)if(s.day!==day)sessions.delete(center);
  for(const [k,s] of states){
   if(s.day!==day||now-s.receivedAt>policy.historyMs){states.delete(k);continue;}
   s.notifications=s.notifications.filter(n=>now-Date.parse(n.createdAt)<=policy.historyMs);
  }
 }
 function session(center){clean();return sessions.get(center)??null;}
 function activate(center){
  clean();if(!enabled(center))throw fail(409,'TRANSPORT_DISABLED','Bus transport is not configured for this center');
  if(sessions.has(center))return sessions.get(center);
  if(sessions.size>=policy.maxCenters)throw fail(503,'TRANSPORT_CAPACITY','Temporary transport capacity reached');
  const s={epoch:randomUUID(),day:attendanceDay(new Date(clock())),activatedAt:new Date(clock()).toISOString()};sessions.set(center,s);return s;
 }
 function notify(s,kind,now){
 const row={id:randomUUID(),kind,createdAt:new Date(now).toISOString(),child:{id:s.childId,name:s.childName},details:{source:'VOLATILE_BLE_INFERENCE',busId:config.busId,beaconId:config.beaconId,wearableId:s.wearableId,temporary:true}};
  s.notifications.push(row);s.notifications=s.notifications.slice(-policy.maxHistory);return row;
 }
 function ingest(center,assignment,device,p){
  clean();const now=clock(),active=session(center);
  if(!enabled(center)||p.busId!==config.busId||p.beaconId!==config.beaconId||p.beaconUuid!==config.beaconUuid)throw fail(422,'BUS_IDENTITY_INVALID','Bus identity is not configured for this center');
  if(!assignment||assignment.id!==p.assignmentId||assignment.child?.centerId!==center||device.centerId!==center||!device.active)throw fail(409,'ASSIGNMENT_CHANGED','Current wearable assignment is required');
  if(p.sessionEpoch!==(active?.epoch??''))throw fail(409,'TRANSPORT_SESSION_CHANGED','Refresh the transport session');
  const k=key(center,assignment);let s=states.get(k);
  const digest=createHash('sha256').update(JSON.stringify({...p,queueAgeMs:0})).digest('hex');
  const seen=s?.seen.get(p.eventId);
  if(seen){if(seen.digest!==digest)throw fail(409,'EVENT_ID_CONFLICT','Event identity changed');return {...seen.result,duplicate:true,notification:null};}
  if(p.queueAgeMs>policy.maxQueueMs)throw fail(422,'STALE_TRANSPORT_REPORT','Bus report is too old');
  if(s?.retiredBoots.has(p.deviceBootId))throw fail(409,'OLD_BOOT','Old wearable boot');
  if(s&&s.boot===p.deviceBootId&&(p.sequence<=s.sequence||p.deviceUptimeMs<=s.uptime))throw fail(409,'OUT_OF_ORDER','Old scan report');
  if(!s){
   if(states.size>=policy.maxStates)throw fail(503,'TRANSPORT_CAPACITY','Temporary transport capacity reached');
   s={centerId:center,assignmentId:assignment.id,childId:assignment.childId,childName:assignment.child.name,deviceId:device.id,wearableId:device.hardwareId,day:attendanceDay(new Date(now)),phase:'WAITING_FOR_BOARDING',lastConfirmedState:null,notifications:[],seen:new Map(),retiredBoots:new Set(),needsNear:false};states.set(k,s);
  }
  // A recent network connection is not proof that a missing scan window was healthy.
  const interrupted=!!s.boot&&(s.boot!==p.deviceBootId||now<s.receivedAt||now-s.receivedAt>Math.min(policy.reportFreshMs,p.scanWindowMs+1000));
  if(s.boot&&s.boot!==p.deviceBootId){if(s.retiredBoots.size>=16)throw fail(409,'BOOT_LIMIT','Daily transport boot limit reached; monitoring is unconfirmed');s.retiredBoots.add(s.boot);}
  if(s.epoch!==(active?.epoch??'')){s.epoch=active?.epoch??'';s.phase='WAITING_FOR_BOARDING';s.lastConfirmedState=null;s.boardedAt=null;s.exitedAt=null;s.needsNear=false;s.candidateAt=null;s.nearReports=0;}
  const healthy=p.scannerHealthy&&p.scanWindowMs>=4000&&p.scanWindowMs<=7000&&p.healthyScanMs>=p.scanWindowMs-500&&p.maxScanGapMs<=1000;
  if(interrupted||!healthy){s.candidateAt=null;s.nearReports=0;s.needsNear=s.lastConfirmedState==='ON_BOARD';s.phase='CONNECTION_UNKNOWN';}
  Object.assign(s,{boot:p.deviceBootId,sequence:p.sequence,uptime:p.deviceUptimeMs,receivedAt:now,healthy,proximity:p.proximity,rssi:p.rssi??null});
  if(p.lastSeenAgeMs!==null)s.lastDetectionAt=now-p.queueAgeMs-p.lastSeenAgeMs;
  if(healthy)s.lastHealthyAt=now;
  let notification=null;
  if(!active){s.phase='DISARMED';s.candidateAt=null;s.nearReports=0;}
  else if(healthy){
   const near=p.proximity==='NEAR'&&p.rssi>=config.entryRssi&&p.lastSeenAgeMs<=2000;
   const away=p.proximity==='FAR'&&p.rssi<=config.exitRssi||p.proximity==='UNKNOWN'&&p.lastSeenAgeMs!==null&&p.lastSeenAgeMs>=4000;
   if(near){
    if(s.lastConfirmedState==='ON_BOARD'){s.phase='ON_BOARD';s.needsNear=false;s.candidateAt=null;s.nearReports=0;}
    else if(!s.exitedAt||now-Date.parse(s.exitedAt)>=policy.reboardMs){
     if(s.phase!=='BOARDING_CANDIDATE'){s.candidateAt=now;s.nearReports=0;}
     s.phase='BOARDING_CANDIDATE';s.nearReports++;
     if(s.nearReports>=policy.boardingReports&&now-s.candidateAt>=policy.boardingSpanMs){s.phase=s.lastConfirmedState='ON_BOARD';s.boardedAt=new Date(now).toISOString();s.candidateAt=null;notification=notify(s,'BUS_BOARDED',now);}
    }
   }else if(s.lastConfirmedState==='ON_BOARD'&&!s.needsNear&&away){
    if(s.phase!=='EXIT_CANDIDATE')s.candidateAt=now;
    s.phase='EXIT_CANDIDATE';
    if(now-s.candidateAt>=policy.exitMs){s.phase=s.lastConfirmedState='OFF_BOARD';s.exitedAt=new Date(now).toISOString();s.candidateAt=null;notification=notify(s,'BUS_EXIT_INFERRED',now);}
   }else if(s.lastConfirmedState!=='ON_BOARD'){s.phase=s.lastConfirmedState==='OFF_BOARD'?'OFF_BOARD':'WAITING_FOR_BOARDING';s.candidateAt=null;s.nearReports=0;}
   else if(!away){s.candidateAt=null;s.phase=s.needsNear?'CONNECTION_UNKNOWN':'ON_BOARD';}
  }
  const result={eventId:p.eventId,duplicate:false,state:s.phase,notification};s.seen.set(p.eventId,{digest,result:{...result,notification:null}});while(s.seen.size>policy.maxSeen)s.seen.delete(s.seen.keys().next().value);
  return result;
 }
 function view(center,assignment){
  const active=session(center),s=states.get(key(center,assignment)),now=clock();
  const fresh=!!s&&now>=s.receivedAt&&now-s.receivedAt<=policy.reportFreshMs;
  const signalFresh=fresh&&s.healthy&&s.lastDetectionAt!==undefined&&now>=s.lastDetectionAt&&now-s.lastDetectionAt<=policy.reportFreshMs;
  const current=s?.epoch===(active?.epoch??'');
  return {child:{id:assignment.childId,name:assignment.child.name},wearableId:assignment.device.hardwareId,busId:config.busId,beaconId:config.beaconId,state:!active?'DISARMED':!s||!current?'WAITING_FOR_BOARDING':!fresh?'CONNECTION_UNKNOWN':s.phase,lastConfirmedState:current?s?.lastConfirmedState??null:null,connection:fresh?'RECENT_REPORT':'CONNECTION_UNKNOWN',proximity:signalFresh?s.proximity:'UNKNOWN',rssi:signalFresh&&s.proximity!=='UNKNOWN'?s.rssi:null,lastDetectionAt:s?.lastDetectionAt?new Date(s.lastDetectionAt).toISOString():null,lastHealthyScanAt:s?.lastHealthyAt?new Date(s.lastHealthyAt).toISOString():null,lastReportAt:s?new Date(s.receivedAt).toISOString():null,boardedAt:current?s?.boardedAt??null:null,exitedAt:current?s?.exitedAt??null:null};
 }
 function notifications(center,childId){clean();return [...states.values()].filter(s=>s.centerId===center&&s.childId===childId).flatMap(s=>s.notifications).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,policy.maxHistory);}
 return {config,policy,enabled,session,activate,ingest,view,notifications};
}

export function mountBusDeviceRoutes(app,{db,deviceAuth,eventRate,asyncRoute,manager,hub}){
 async function context(device){
  if(await db.beacon.findFirst({where:{centerId:device.centerId,serviceUuid:manager.config.beaconUuid}}))throw fail(409,'BUS_IDENTITY_COLLISION','Bus UUID must not be registered as Gate or danger zone');
  const assignment=await db.assignment.findFirst({where:{deviceId:device.id,endedAt:null,child:{centerId:device.centerId}},include:{child:{select:{id:true,name:true,centerId:true}}}});
  const current=await db.device.findUnique({where:{id:device.id}});
  if(!current?.active||current.centerId!==device.centerId||current.tokenHash!==device.tokenHash)throw fail(401,'DEVICE_UNAUTHORIZED','Current device authority required');
  return assignment;
 }
 app.get('/api/device/transport',deviceAuth,asyncRoute(async(req,res)=>{
  const assignment=await context(req.device),session=manager.session(req.device.centerId),enabled=manager.enabled(req.device.centerId);
   res.set('Cache-Control','no-store').json({data:{enabled:enabled&&!!assignment,assignmentId:assignment?.id??null,sessionEpoch:session?.epoch??'',busId:manager.config.busId,beaconId:manager.config.beaconId,beaconUuid:manager.config.beaconUuid,entryRssi:manager.config.entryRssi,exitRssi:manager.config.exitRssi}});
 }));
 app.post('/api/device/transport/observations',deviceAuth,eventRate,asyncRoute(async(req,res)=>{
  const p=busReportSchema.parse(req.body),assignment=await context(req.device);
  const result=manager.ingest(req.device.centerId,assignment,req.device,p);
  // The synchronous memory transition is complete before publishing invalidation.
  if(!result.duplicate)hub.publish(req.device.centerId,{topics:['transport',...(result.notification?['transport-notifications']:[])]});
  res.json({data:{...result,notification:result.notification?{id:result.notification.id,kind:result.notification.kind}:null}});
 }));
}
export function mountBusAdminRoutes(app,{db,asyncRoute,manager,hub}){
 const admin=req=>{if(req.user?.role!=='ADMIN'||req.authTransport!=='admin-cookie')throw fail(403,'FORBIDDEN','Center Admin cookie session required');};
 app.get('/api/v1/transport',asyncRoute(async(req,res)=>{
  admin(req);const center=req.user.centerId;
  const assignments=await db.assignment.findMany({where:{endedAt:null,child:{centerId:center},device:{centerId:center,active:true}},include:{child:{select:{id:true,name:true,centerId:true}},device:{select:{id:true,hardwareId:true,centerId:true,active:true}}},take:manager.policy.maxStates});
  res.set('Cache-Control','no-store').json({data:{enabled:manager.enabled(center),session:manager.session(center),busId:manager.config.busId,beaconId:manager.config.beaconId,serverTime:new Date().toISOString(),temporary:true,rows:assignments.map(a=>manager.view(center,a))}});
 }));
 app.post('/api/v1/transport/end-daycare',asyncRoute(async(req,res)=>{
  admin(req);z.object({confirm:z.literal(true)}).strict().parse(req.body);
  // Revalidate the existing cookie/role at activation; middleware already checks CSRF.
  const session=await req.validateMonitoringSession();
  if(session.user.role!=='ADMIN'||session.user.centerId!==req.user.centerId)throw fail(403,'FORBIDDEN','Center changed');
  const data=manager.activate(req.user.centerId);hub.publish(req.user.centerId,{topics:['transport']});res.json({data});
 }));
}
