import { dailyHistory, sampleHistory, previewAvailable } from './activity-history.js';
import { z } from 'zod';
import { fail, dbTime, serial, attendanceDay } from './events.js';
import { activitySchema, policySchema, DEFAULT_ACTIVITY_POLICY, MEASUREMENT_VERSION } from './activity-contract.js';
import { analyzeActivity, bucketParts, localParts, LOOKBACK_DAYS } from './activity-analysis.js';
export async function activityPolicy(db,centerId){const row=await db.activityPolicy.findUnique({where:{centerId}});return row?policySchema.parse(row.settings):{...DEFAULT_ACTIVITY_POLICY};}
export async function ensureActivitySession(tx,attendance,confirmedAt){
 return tx.activityAttendanceSession.upsert({where:{attendanceId_startedAt:{attendanceId:attendance.id,startedAt:confirmedAt}},create:{attendanceId:attendance.id,startedAt:confirmedAt},update:{}});
}
const canonical=p=>JSON.stringify(p,Object.keys(p).filter(k=>k!=='queueAgeMs').sort());
export async function activityView(db,child,now=undefined,{includeHistory=false}={}){
 now=now||await dbTime(db);
 const policy=await activityPolicy(db,child.centerId),day=localParts(now,policy.timezone).day;
 const from=new Date(now.getTime()-LOOKBACK_DAYS*86400000),fromDay=localParts(from,policy.timezone).day;
 const assignment=await db.assignment.findFirst({where:{childId:child.id,endedAt:null,device:{centerId:child.centerId}},include:{device:{select:{hardwareId:true,active:true}}}});
 const [attendance,latest,intervals,sessions,daily,alert,currentSummaries]=await Promise.all([
  db.attendance.findUnique({where:{childId_day:{childId:child.id,day:attendanceDay(now)}}}),
  db.activitySummary.findFirst({where:{childId:child.id,measurementVersion:MEASUREMENT_VERSION,timezone:policy.timezone,...(assignment?{deviceId:assignment.deviceId,startAt:{gte:assignment.startedAt}}:{eligible:true})},orderBy:{endAt:'desc'},include:{device:{select:{hardwareId:true}}}}),
  db.activityInterval.findMany({where:{childId:child.id,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,day:{gte:fromDay,lte:day}},orderBy:[{day:'desc'},{startMinute:'asc'}],take:4400}),
  db.activityAttendanceSession.findMany({where:{attendance:{childId:child.id},startedAt:{gte:new Date(from.getTime()-86400000),lte:now}},include:{attendance:{select:{day:true}}}}),
  db.activityDaily.findMany({where:{childId:child.id,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,day:{gte:fromDay,lte:day}},orderBy:{day:'desc'},take:90}),
  db.alert.findUnique({where:{activityDedupKey:`LOW_ACTIVITY_ADVISORY:${child.id}:${day}:${MEASUREMENT_VERSION}`}}),
  db.activitySummary.findMany({where:{childId:child.id,measurementVersion:MEASUREMENT_VERSION,eligible:true,startAt:{gte:new Date(now.getTime()-(Math.max(60,policy.sustainedMinutes)+30)*60000)},endAt:{lte:now}},select:{deviceId:true,sessionId:true,startAt:true,endAt:true},take:301}),
 ]);
 // Gate attendance retains its existing Colombo day contract. Never extend a
 // session past its last measured minute or its actual operational attendance day.
 const proofs=sessions.length?await db.auditLog.findMany({where:{resourceId:{in:[...new Set(sessions.map(s=>s.attendanceId))]},action:'ATTENDANCE_CONFIRMED_TEACHER'},select:{resourceId:true,createdAt:true}}):[];
 const boundedSessions=sessions.filter(s=>s.lastObservedAt&&proofs.some(p=>p.resourceId===s.attendanceId&&+p.createdAt===+s.startedAt)).map(s=>({...s,endedAt:new Date(Math.min(s.lastObservedAt.getTime(),s.endedAt?.getTime()??Infinity,new Date(`${s.attendance.day}T00:00:00+05:30`).getTime()+86400000))}));
 const analysis=analyzeActivity({policy,now,attendanceStatus:assignment?.device?.active?attendance?.status:null,latest,intervals,sessions:boundedSessions,assignment,currentSummaries});
 return {...analysis,...(includeHistory?{dailyHistory:dailyHistory({child,policy,now,intervals,sessions:boundedSessions})}:{}),latestMeasurement:latest?{scoreMg:latest.movementIntensity===null?null:latest.movementIntensity*1000,validSampleCount:latest.validSampleCount,expectedSampleCount:latest.expectedSampleCount,coveragePercent:100*latest.validSampleCount/latest.expectedSampleCount,sensorStatus:latest.sensorStatus,endAt:latest.endAt,eligible:latest.eligible}:null,lastReceivedAt:latest?.createdAt||null,child:{id:child.id,name:child.name},wearableId:latest?.device.hardwareId||assignment?.device.hardwareId||null,policy,alert:alert?{id:alert.id,status:'RECORDED',createdAt:alert.createdAt,details:alert.details}:null,
  history:daily.map(d=>({day:d.day,scoreMg:d.validSeconds>0?d.movementIntegral/d.validSeconds*1000:null,validMinutes:d.validSeconds/60,observedMinutes:d.observedSeconds/60,partial:true})),
 };
}
// Read projection only. The ingestion path continues calling activityView directly.
export async function activityReadView(db,child,{preview,source='recorded',now}={}){
 if(!['recorded','sample'].includes(source))throw fail(422,'VALIDATION_ERROR','Unknown history source');
 const available=await previewAvailable(db,child,preview);
 if(source==='sample'&&!available)throw fail(404,'NOT_FOUND','Sample history is unavailable for this child');
 const result=await activityView(db,child,now,{includeHistory:true});
 if(source==='sample'){
  const previewNow=preview.day?new Date(`${preview.day}T12:00:00+05:30`):new Date(result.evaluatedAt);
  result.dailyHistory=sampleHistory(child,result.policy,previewNow);
 }
 return {...result,historyPreviewAvailable:available};
}
async function updateAggregates(tx,summary){
 let cursor=summary.startAt.getTime(),end=summary.endAt.getTime();
 while(cursor<end){
  const part=bucketParts(new Date(cursor),summary.timezone),until=Math.min(end,part.utcStart.getTime()+1800000);
  const seconds=(until-cursor)/1000,validSeconds=seconds*summary.validDurationSeconds/60;
  const movementIntegral=(summary.movementIntensity||0)*validSeconds;
  const key={childId:summary.childId,day:part.day,startMinute:part.startMinute,timezone:summary.timezone,measurementVersion:summary.measurementVersion};
  const old=await tx.activityInterval.findUnique({where:{childId_day_startMinute_timezone_measurementVersion:key}});
  await tx.activityInterval.upsert({where:{childId_day_startMinute_timezone_measurementVersion:key},create:{...key,centerId:summary.centerId,utcStart:part.utcStart,validSeconds,movementIntegral,observedSeconds:seconds},update:{validSeconds:{increment:validSeconds},movementIntegral:{increment:movementIntegral},observedSeconds:{increment:seconds},clockAmbiguous:old?.clockAmbiguous||Boolean(old&&old.utcStart.getTime()!==part.utcStart.getTime())}});
  const dailyKey={childId:summary.childId,day:part.day,timezone:summary.timezone,measurementVersion:summary.measurementVersion};
  await tx.activityDaily.upsert({where:{childId_day_timezone_measurementVersion:dailyKey},create:{...dailyKey,centerId:summary.centerId,validSeconds,movementIntegral,observedSeconds:seconds},update:{validSeconds:{increment:validSeconds},movementIntegral:{increment:movementIntegral},observedSeconds:{increment:seconds}}});
  cursor=until;
 }
}
export async function ingestActivity(db,device,input,{evaluate=true}={}){
 const payload=activitySchema.parse(input);
 return serial(db,async tx=>{
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id=${device.id} FOR UPDATE`;
  const current=await tx.device.findUnique({where:{id:device.id}});
  if(!current?.active||current.centerId!==device.centerId||current.tokenHash!==device.tokenHash||payload.deviceId!==current.hardwareId)throw fail(401,'DEVICE_UNAUTHORIZED','Device unauthorized');
  const old=await tx.deviceEvent.findUnique({where:{eventId:payload.eventId}});
  if(old){if(old.deviceId!==device.id||canonical(old.payload)!==canonical(payload))throw fail(409,'EVENT_ID_CONFLICT','Event ID already used');await tx.device.update({where:{id:device.id},data:{lastSeen:await dbTime(tx)}});return {eventId:old.eventId,duplicate:true};}
  const now=await dbTime(tx);
  let boot=await tx.activityBoot.findUnique({where:{deviceId_sessionId:{deviceId:device.id,sessionId:payload.sessionId}}});
  if(!boot)boot=await tx.activityBoot.create({data:{deviceId:device.id,sessionId:payload.sessionId,anchorUptimeMs:BigInt(payload.deviceUptimeMs),anchorAt:new Date(now.getTime()-payload.queueAgeMs)}});
  const endAt=new Date(boot.anchorAt.getTime()+payload.deviceUptimeMs-Number(boot.anchorUptimeMs)),startAt=new Date(endAt.getTime()-60000);
  if(endAt.getTime()>now.getTime()+5000||now.getTime()-endAt.getTime()>86400000)throw fail(422,'ACTIVITY_TIME_INVALID','Activity timing is future or older than 24 hours');
  const assignment=await tx.assignment.findFirst({where:{deviceId:device.id,startedAt:{lte:startAt},OR:[{endedAt:null},{endedAt:{gte:endAt}}],child:{centerId:device.centerId}},include:{child:true}});
  if(!assignment)throw fail(409,'NO_ACTIVITY_ASSIGNMENT','Summary must belong wholly to a known child assignment');
  const child=assignment.child;
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id=${child.id} FOR UPDATE`;
  const repeated=await tx.activitySummary.findUnique({where:{deviceId_sessionId_sequence:{deviceId:device.id,sessionId:payload.sessionId,sequence:payload.sequence}}});
  if(repeated)throw fail(409,'ACTIVITY_SEQUENCE_CONFLICT','Activity sequence already recorded');
  const overlap=await tx.activitySummary.findFirst({where:{childId:child.id,startAt:{lt:endAt},endAt:{gt:startAt},measurementVersion:MEASUREMENT_VERSION}});
  if(overlap)throw fail(409,'ACTIVITY_OVERLAP','Overlapping activity summaries are not counted twice');
  const attendance=await tx.attendance.findUnique({where:{childId_day:{childId:child.id,day:attendanceDay(endAt)}}});
  const confirmation=attendance?await tx.confirmation.findUnique({where:{attendanceId:attendance.id}}):null;
  if(attendance?.status==='PRESENT'&&confirmation)await ensureActivitySession(tx,attendance,confirmation.confirmedAt);
  const sessions=await tx.activityAttendanceSession.findMany({where:{attendance:{childId:child.id},startedAt:{lte:startAt},OR:[{endedAt:null},{endedAt:{gte:endAt}}]},include:{attendance:true},orderBy:{startedAt:'desc'}});
  const session=sessions.find(s=>(s.endedAt||s.attendance.status==='PRESENT')&&s.attendance.day===attendanceDay(startAt)&&s.attendance.day===attendanceDay(new Date(endAt.getTime()-1)));
  const policy=await activityPolicy(tx,device.centerId),day=localParts(startAt,policy.timezone).day;
  const event=await tx.deviceEvent.create({data:{eventId:payload.eventId,eventType:payload.eventType,deviceId:device.id,childId:child.id,beaconId:null,deviceUptimeMs:BigInt(payload.deviceUptimeMs),observedAt:startAt,receivedAt:now,payload}});
  const summary=await tx.activitySummary.create({data:{eventId:event.id,childId:child.id,deviceId:device.id,centerId:device.centerId,attendanceSessionId:session?.id,sessionId:payload.sessionId,sequence:payload.sequence,measurementVersion:payload.measurementVersion,timezone:policy.timezone,day,startAt,endAt,movementIntensity:payload.movementIntensity,validSampleCount:payload.validSampleCount,expectedSampleCount:payload.expectedSampleCount,validDurationSeconds:payload.validDurationSeconds,sensorStatus:payload.sensorStatus,eligible:Boolean(session),createdAt:now}});
  await tx.device.update({where:{id:device.id},data:{lastSeen:now}});
  if(session){
   await tx.activityAttendanceSession.update({where:{id:session.id},data:{lastObservedAt:session.lastObservedAt&&session.lastObservedAt>endAt?session.lastObservedAt:endAt}});
   await updateAggregates(tx,summary);
  }
  let alertCreated=false;
  if(evaluate&&session&&attendance?.status==='PRESENT'&&payload.validSampleCount>0&&endAt.getTime()>=now.getTime()-600000&&payload.queueAgeMs<=600000){
   const view=await activityView(tx,child,now);
   // Do not announce an old closed period as a new current hazard after a backlog.
   if(view.state==='LOW_ACTIVITY'&&new Date(view.latestMeasurement?.endAt).getTime()===endAt.getTime()&&now.getTime()-new Date(view.period.endAt).getTime()<=600000){
    const dedupKey=`LOW_ACTIVITY_ADVISORY:${child.id}:${view.day}:${MEASUREMENT_VERSION}`;
    if(!await tx.alert.findUnique({where:{activityDedupKey:dedupKey}})&&!await tx.alert.findUnique({where:{activityDedupKey:`LOW_ACTIVITY:${child.id}:${view.day}:${MEASUREMENT_VERSION}`}})){
     await tx.alert.create({data:{eventId:event.id,kind:'LOW_ACTIVITY_ADVISORY',activityDedupKey:dedupKey,createdAt:now,details:{currentScoreMg:view.currentScoreMg,baselineScoreMg:view.baselineScoreMg,reductionPercent:view.reductionPercent,coveragePercent:view.coveragePercent,period:view.period,comparisonWindows:view.comparisonWindows,baselineWindow:view.baselineWindow,requiredBaselineDays:view.requiredBaselineDays,timezone:policy.timezone,baselineDayCount:view.baselineDayCount,measurementVersion:MEASUREMENT_VERSION,metric:'MAD',units:'mg',advisory:true,experimental:true}}});alertCreated=true;
    }
   }
  }
  return {eventId:payload.eventId,duplicate:false,eligible:Boolean(session),alertCreated};
 });
}
export function mountActivityRoutes(app,{db,asyncRoute,pageSchema,activityHistoryPreview}){
 app.get('/api/v1/activity/settings',asyncRoute(async(req,res)=>res.json({data:await activityPolicy(db,req.user.centerId)})));
 app.patch('/api/v1/activity/settings',asyncRoute(async(req,res)=>{
  if(req.user.role!=='ADMIN')throw fail(403,'FORBIDDEN','Administrator required');
  const settings=policySchema.parse(req.body);
  if(settings.sustainedMinutes<60)throw fail(422,'VALIDATION_ERROR','Low movement comparisons require at least two consecutive 30-minute periods');
  await serial(db,async tx=>{
   await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${req.user.centerId} FOR UPDATE`;
   await tx.activityPolicy.upsert({where:{centerId:req.user.centerId},create:{centerId:req.user.centerId,settings},update:{settings}});
   await tx.auditLog.create({data:{userId:req.user.id,resourceId:req.user.centerId,action:'ACTIVITY_POLICY_UPDATED'}});
  });res.json({data:settings});
 }));
 app.get('/api/v1/activity/children',asyncRoute(async(req,res)=>{
  const {limit,offset}=pageSchema.extend({limit:z.coerce.number().int().min(1).max(25).default(25)}).parse(req.query);
  const children=await db.child.findMany({where:{centerId:req.user.centerId},take:limit,skip:offset,orderBy:{id:'asc'}});
  const now=await dbTime(db);res.json({data:await Promise.all(children.map(c=>activityReadView(db,c,{now,preview:activityHistoryPreview}))),page:{limit,offset}});
 }));
 async function child(req){const c=await db.child.findFirst({where:{id:req.params.id,centerId:req.user.centerId}});if(!c)throw fail(404,'NOT_FOUND','Child not found');return c;}
 app.get('/api/v1/activity/children/:id',asyncRoute(async(req,res)=>res.json({data:await activityReadView(db,await child(req),{preview:activityHistoryPreview,source:req.query.source||'recorded'})})));
 app.get('/api/v1/activity/children/:id/summaries',asyncRoute(async(req,res)=>{
  const c=await child(req),{limit,offset}=pageSchema.parse(req.query),days=z.coerce.number().int().min(1).max(7).default(1).parse(req.query.days);
  const now=await dbTime(db);
  const rows=await db.activitySummary.findMany({where:{childId:c.id,endAt:{gte:new Date(now.getTime()-days*86400000)}},take:limit,skip:offset,orderBy:{endAt:'desc'},include:{device:{select:{hardwareId:true}}}});
  res.json({data:rows,page:{limit,offset}});
 }));
}
