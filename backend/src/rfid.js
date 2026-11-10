import {createHash,createHmac,randomBytes} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {attendanceDay,dbTime,fail,serial} from './events.js';
import {ensureActivitySession} from './activity.js';
import {rfidInstalled} from './rfid-storage.js';

const id=z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
export const normalizeUid=value=>{
 if(typeof value!=='string'||!/^([0-9a-f]{8}|[0-9a-f]{14}|[0-9a-f]{20})$/i.test(value))throw fail(422,'INVALID_CARD_UID','Use a supported 4, 7 or 10 byte ISO14443A UID');
 return value.toUpperCase();
};
export const scanSchema=z.object({eventId:id,cardUid:z.string().max(20).transform(normalizeUid),readerBootId:id.max(80),scanSequence:z.number().int().positive().max(2147483647),modeVersion:z.number().int().nonnegative().max(2147483647),enrollmentId:z.string().uuid().nullable().default(null)}).strict();
const digest=token=>createHash('sha256').update(token).digest('hex');
export const uidLookup=(uid,key)=>{if(typeof key!=='string'||key.length<32)throw fail(503,'RFID_UNAVAILABLE','Configure a stable private RFID lookup key');return createHmac('sha256',key).update(normalizeUid(uid)).digest('hex');};
const windowMinutes=date=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(v=>[v.type,v.value]));return Number(p.hour)*60+Number(p.minute);};
const readerSelect={id:true,hardwareId:true,centerId:true,active:true,lastSeen:true,startMinute:true,endMinute:true};
const cardSelect={id:true,status:true,maskedUid:true,uidLength:true,issuedAt:true,revokedAt:true,reason:true,issuedBy:{select:{username:true}},reader:{select:{hardwareId:true}}};
const authorize=async(tx,user)=>{const actor=await tx.user.findUnique({where:{id:user.id}});if(!actor?.active||actor.role!=='ADMIN'||actor.centerId!==user.centerId)throw fail(403,'FORBIDDEN','Active center Admin required');return actor;};
const lockReader=async(tx,id)=>{await tx.$queryRaw`SELECT id FROM "RfidReader" WHERE id=${id} FOR UPDATE`;};
const lockChild=async(tx,id)=>{await tx.$queryRaw`SELECT id FROM "Child" WHERE id=${id} FOR UPDATE`;};

export async function processRfidScan(db,reader,input,{key}={}){
 const p=scanSchema.parse(input),hash=uidLookup(p.cardUid,key);
 return serial(db,async tx=>{
  await lockReader(tx,reader.id);
  const current=await tx.rfidReader.findUnique({where:{id:reader.id}});
  if(!current?.active||current.tokenHash!==reader.tokenHash||current.centerId!==reader.centerId)throw fail(401,'READER_UNAUTHORIZED','Reader unavailable');
  const now=await dbTime(tx);
  await tx.rfidReader.update({where:{id:reader.id},data:{lastSeen:now}});
  const old=await tx.rfidScan.findUnique({where:{eventId:p.eventId}});
  if(old){
   if(old.readerId!==reader.id||old.uidHash!==hash||old.readerBootId!==p.readerBootId||old.scanSequence!==p.scanSequence||old.modeVersion!==p.modeVersion||(old.enrollmentId??null)!==p.enrollmentId)throw fail(409,'SCAN_ID_CONFLICT','Scan ID already used');
   return {eventId:p.eventId,result:old.result,duplicate:true,changed:false,attendanceId:old.attendanceId};
  }
  const sequence=await tx.rfidScan.findUnique({where:{readerId_readerBootId_scanSequence:{readerId:reader.id,readerBootId:p.readerBootId,scanSequence:p.scanSequence}}});
  if(sequence)throw fail(409,'SCAN_SEQUENCE_CONFLICT','Scan sequence already used');
  let result,attendance=null,card=null,changed=false;
  const enrollment=await tx.rfidEnrollment.findFirst({where:{readerId:reader.id,status:'PENDING'},orderBy:{createdAt:'desc'}});
  if(p.modeVersion!==current.modeVersion)result='ENROLLMENT_REFRESH_REQUIRED';
  else if(enrollment||p.enrollmentId){
   if(enrollment&&enrollment.expiresAt<=now){await tx.rfidEnrollment.update({where:{id:enrollment.id},data:{status:'EXPIRED'}});result='ENROLLMENT_REJECTED';}
   else if(!enrollment||enrollment.id!==p.enrollmentId)result='ENROLLMENT_REFRESH_REQUIRED';
   else{
    await lockChild(tx,enrollment.childId);
    const child=await tx.child.findFirst({where:{id:enrollment.childId,centerId:reader.centerId}});
    const actor=await tx.user.findUnique({where:{id:enrollment.issuedById}});
    const active=await tx.rfidCard.findFirst({where:{childId:enrollment.childId,status:'ACTIVE'}});
    const collision=await tx.rfidCard.findFirst({where:{uidHash:hash,status:'ACTIVE'}});
    if(!child||enrollment.centerId!==reader.centerId||!actor?.active||actor.role!=='ADMIN'||actor.centerId!==reader.centerId||(active?.id??null)!==enrollment.expectedCardId||collision){
     result='ENROLLMENT_REJECTED';await tx.rfidEnrollment.update({where:{id:enrollment.id},data:{status:'REJECTED'}});
    }else{
     if(active)await tx.rfidCard.update({where:{id:active.id},data:{status:'REPLACED',revokedAt:now,reason:'Replaced by authorized Admin enrollment'}});
     card=await tx.rfidCard.create({data:{uidHash:hash,uidLength:p.cardUid.length/2,maskedUid:'••••'+p.cardUid.slice(-4),childId:child.id,centerId:reader.centerId,issuedById:actor.id,readerId:reader.id,issuedAt:now}});
     await tx.rfidEnrollment.update({where:{id:enrollment.id},data:{status:'SUCCESS',resultCardId:card.id}});
     await tx.auditLog.create({data:{userId:actor.id,resourceId:child.id,action:active?'RFID_CARD_REPLACED':'RFID_CARD_ISSUED',createdAt:now}});
     result='ENROLLMENT_SUCCESS';
    }
   }
  }else{
   card=await tx.rfidCard.findFirst({where:{uidHash:hash,centerId:reader.centerId,status:'ACTIVE'}});
   if(!card){const revoked=await tx.rfidCard.findFirst({where:{uidHash:hash,centerId:reader.centerId},orderBy:{issuedAt:'desc'}});result=revoked?'CARD_REVOKED':'CARD_UNKNOWN';}
   else{
    await lockChild(tx,card.childId);
    const child=await tx.child.findFirst({where:{id:card.childId,centerId:reader.centerId}});
    // Re-read after the shared child lock: revocation/Teacher/other readers may have won.
    card=await tx.rfidCard.findFirst({where:{id:card.id,status:'ACTIVE',centerId:reader.centerId}});
    if(!child||!card)result='CARD_REVOKED';
    else{
     const minute=windowMinutes(now),day=attendanceDay(now);
     attendance=await tx.attendance.findUnique({where:{childId_day:{childId:child.id,day}}});
     if(attendance?.status==='PRESENT')result='ALREADY_PRESENT';
     else if(attendance&& !['CHECKIN_PENDING','NOT_CHECKED_IN'].includes(attendance.status))result='ATTENDANCE_CONFLICT';
     else if(minute<current.startMinute||minute>=current.endMinute)result='OUTSIDE_ATTENDANCE_HOURS';
     else{
      result=attendance?.status==='CHECKIN_PENDING'?'PENDING_CONFIRMED':'PRESENT_RECORDED';
      attendance=attendance?await tx.attendance.update({where:{id:attendance.id},data:{status:'PRESENT'}}):await tx.attendance.create({data:{childId:child.id,day,status:'PRESENT'}});
      changed=true;
     }
    }
   }
  }
  if(['ENROLLMENT_SUCCESS','ENROLLMENT_REJECTED'].includes(result))await tx.rfidReader.update({where:{id:reader.id},data:{modeVersion:current.modeVersion+1}});
  const scan=await tx.rfidScan.create({data:{eventId:p.eventId,actorType:'AUTHENTICATED_RFID_READER',readerId:reader.id,centerId:reader.centerId,readerBootId:p.readerBootId,scanSequence:p.scanSequence,modeVersion:p.modeVersion,uidHash:hash,enrollmentId:p.enrollmentId,attendanceId:attendance?.id??null,cardId:card?.id??null,result,changed,receivedAt:now}});
  if(changed){
   const data={userId:null,method:'RFID_CARD',readerId:reader.id,rfidCardId:card.id,rfidScanId:scan.id,confirmedAt:now};
   await tx.confirmation.upsert({where:{attendanceId:attendance.id},create:{attendanceId:attendance.id,...data},update:data});
   await ensureActivitySession(tx,attendance,now);
  }
  return {eventId:p.eventId,result,changed,duplicate:false,attendanceId:attendance?.id??null,recordedAt:now};
 });
}

export function mountRfidReaderRoutes(app,{db,asyncRoute,hub,key}){
 const ready=async()=>{if(typeof key!=='string'||key.length<32||key.startsWith('REPLACE')||!await rfidInstalled(db))throw fail(503,'RFID_UNAVAILABLE','RFID setup requires reviewed migration, generated client and configured lookup key');};
 const auth=asyncRoute(async(req,res,next)=>{
  const token=req.get('X-RFID-Reader-Token');
  if(!token||token.length>256)throw fail(401,'READER_UNAUTHORIZED','Reader authentication required');
  await ready();
  const reader=await db.rfidReader.findUnique({where:{tokenHash:digest(token)}});
  if(!reader?.active)throw fail(401,'READER_UNAUTHORIZED','Reader authentication required');
  req.rfidReader=reader;next();
 });
 const limit=rateLimit({windowMs:60000,limit:180,keyGenerator:req=>req.rfidReader.id,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/v1/rfid-reader/state',auth,limit,asyncRoute(async(req,res)=>{
  const data=await serial(db,async tx=>{
   await lockReader(tx,req.rfidReader.id);const r=await tx.rfidReader.findUnique({where:{id:req.rfidReader.id}});
   if(!r?.active||r.tokenHash!==req.rfidReader.tokenHash)throw fail(401,'READER_UNAUTHORIZED','Reader disabled');
   const now=await dbTime(tx);await tx.rfidReader.update({where:{id:r.id},data:{lastSeen:now}});
   let session=await tx.rfidEnrollment.findFirst({where:{readerId:r.id,status:'PENDING'}}),modeVersion=r.modeVersion;
   if(session&&session.expiresAt<=now){await tx.rfidEnrollment.update({where:{id:session.id},data:{status:'EXPIRED'}});modeVersion++;await tx.rfidReader.update({where:{id:r.id},data:{modeVersion}});session=null;}
   return {hardwareId:r.hardwareId,modeVersion,enrollmentId:session?.id??null,expiresAt:session?.expiresAt??null,serverTime:now};
  });res.set('Cache-Control','no-store').json({data});
 }));
 app.post('/api/v1/rfid-reader/scans',auth,limit,asyncRoute(async(req,res)=>{
  const data=await processRfidScan(db,req.rfidReader,req.body,{key});
  // processRfidScan has committed here. Enrollment is not an attendance change,
  // but Admin readers must invalidate their card view as soon as it finishes.
  if(data.changed)hub.publish(req.rfidReader.centerId,{topics:['attendance','devices']});
  else if(!data.duplicate&&['ENROLLMENT_SUCCESS','ENROLLMENT_REJECTED'].includes(data.result))hub.publish(req.rfidReader.centerId,{topics:['devices']});
  res.set('Cache-Control','no-store').status(data.duplicate?200:201).json({data});
 }));
 return {ready};
}

export function mountRfidAdminRoutes(app,{db,asyncRoute,ready}){
 const admin=asyncRoute(async(req,res,next)=>{if(req.user?.role!=='ADMIN'||req.authTransport!=='admin-cookie')throw fail(403,'FORBIDDEN','Center Admin cookie session required');await ready();next();});
 app.use('/api/v1/admin/rfid',admin);
 app.get('/api/v1/admin/rfid/readers',asyncRoute(async(req,res)=>{
  const now=await dbTime(db);const rows=await db.rfidReader.findMany({where:{centerId:req.user.centerId},select:readerSelect,orderBy:{hardwareId:'asc'},take:100});
  res.set('Cache-Control','no-store').json({data:rows.map(r=>({...r,online:r.active&&r.lastSeen&&now-r.lastSeen>=0&&now-r.lastSeen<=60000,serverTime:now}))});
 }));
 app.post('/api/v1/admin/rfid/readers',asyncRoute(async(req,res)=>{
  const p=z.object({hardwareId:id,startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440)}).strict().refine(p=>p.startMinute<p.endMinute).parse(req.body);
  const token=randomBytes(32).toString('hex');
  const row=await serial(db,async tx=>{await authorize(tx,req.user);if(await tx.rfidReader.findUnique({where:{hardwareId:p.hardwareId}}))throw fail(409,'READER_ID_UNAVAILABLE','Choose an unused reader public ID');return tx.rfidReader.create({data:{...p,centerId:req.user.centerId,createdById:req.user.id,tokenHash:digest(token)},select:readerSelect});});
  res.set('Cache-Control','no-store').status(201).json({data:{...row,provisioningToken:token}});
 }));
 app.patch('/api/v1/admin/rfid/readers/:id',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),p=z.object({active:z.boolean(),expectedActive:z.boolean()}).strict().parse(req.body);
  const row=await serial(db,async tx=>{await authorize(tx,req.user);await lockReader(tx,id);const reader=await tx.rfidReader.findFirst({where:{id,centerId:req.user.centerId}});if(!reader)throw fail(404,'NOT_FOUND','Reader not found');if(reader.active!==p.expectedActive)throw fail(409,'READER_CHANGED','Refresh reader before changing status');return tx.rfidReader.update({where:{id},data:{active:p.active,modeVersion:reader.modeVersion+1},select:readerSelect});});
  res.json({data:row});
 }));
 app.get('/api/v1/admin/rfid/children/:id',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  if(!await db.child.findFirst({where:{id,centerId:req.user.centerId}}))throw fail(404,'NOT_FOUND','Child not found');
  // Keep GET read-only within the existing Admin session boundary. If enrollment
  // commits during the reads, retry rather than pairing SUCCESS with old cards.
  const latest=()=>db.rfidEnrollment.findFirst({where:{childId:id,centerId:req.user.centerId},orderBy:{createdAt:'desc'}});
  for(let attempt=0;attempt<3;attempt++){
   const before=await latest();
   const cards=await db.rfidCard.findMany({where:{childId:id,centerId:req.user.centerId},select:cardSelect,orderBy:{issuedAt:'desc'},take:25});
   const enrollment=await latest();
   if(before?.id!==enrollment?.id||before?.status!==enrollment?.status)continue;
   const now=await dbTime(db);
   return res.set('Cache-Control','no-store').json({data:{cards,enrollment:enrollment?{id:enrollment.id,readerId:enrollment.readerId,status:enrollment.status==='PENDING'&&enrollment.expiresAt<=now?'EXPIRED':enrollment.status,expiresAt:enrollment.expiresAt}:null}});
  }
  throw fail(409,'RFID_STATE_CHANGED','Card enrollment changed while loading. Retry card status.');
 }));
 app.post('/api/v1/admin/rfid/children/:id/enrollment',asyncRoute(async(req,res)=>{
  const childId=z.string().uuid().parse(req.params.id),p=z.object({readerId:z.string().uuid(),mode:z.enum(['ISSUE','REPLACE'])}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   await authorize(tx,req.user);await lockReader(tx,p.readerId);await lockChild(tx,childId);const now=await dbTime(tx);
   const reader=await tx.rfidReader.findFirst({where:{id:p.readerId,centerId:req.user.centerId,active:true}}),child=await tx.child.findFirst({where:{id:childId,centerId:req.user.centerId}});
   if(!reader||!child)throw fail(404,'NOT_FOUND','Child or active reader unavailable');
   await tx.rfidEnrollment.updateMany({where:{centerId:req.user.centerId,status:'PENDING',expiresAt:{lte:now}},data:{status:'EXPIRED'}});
   if(await tx.rfidEnrollment.findFirst({where:{status:'PENDING',OR:[{readerId:reader.id},{childId}]}}))throw fail(409,'ENROLLMENT_BUSY','A card enrollment is already waiting; cancel it or wait for expiry');
   const active=await tx.rfidCard.findFirst({where:{childId,status:'ACTIVE'}});
   if((p.mode==='ISSUE'&&active)||(p.mode==='REPLACE'&&!active))throw fail(409,'CARD_CHANGED','Refresh the current card before issuing or replacing');
   await tx.rfidReader.update({where:{id:reader.id},data:{modeVersion:reader.modeVersion+1}});
   return tx.rfidEnrollment.create({data:{readerId:reader.id,childId,centerId:req.user.centerId,issuedById:req.user.id,expectedCardId:active?.id??null,expiresAt:new Date(+now+60000)}});
  });res.json({data:{id:row.id,status:row.status,expiresAt:row.expiresAt}});
 }));
 app.post('/api/v1/admin/rfid/enrollments/:id/cancel',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const data=await serial(db,async tx=>{await authorize(tx,req.user);const e=await tx.rfidEnrollment.findFirst({where:{id,centerId:req.user.centerId}});if(!e)throw fail(404,'NOT_FOUND','Enrollment not found');await lockReader(tx,e.readerId);const result=await tx.rfidEnrollment.updateMany({where:{id,status:'PENDING'},data:{status:'CANCELLED'}});if(result.count){const reader=await tx.rfidReader.findUnique({where:{id:e.readerId}});await tx.rfidReader.update({where:{id:reader.id},data:{modeVersion:reader.modeVersion+1}});}return {cancelled:result.count>0};});res.json({data});
 }));
 app.post('/api/v1/admin/rfid/children/:id/revoke',asyncRoute(async(req,res)=>{
  const childId=z.string().uuid().parse(req.params.id),p=z.object({cardId:z.string().uuid(),reason:z.string().trim().min(3).max(200)}).strict().parse(req.body);
  const data=await serial(db,async tx=>{await authorize(tx,req.user);await lockChild(tx,childId);if(!await tx.child.findFirst({where:{id:childId,centerId:req.user.centerId}}))throw fail(404,'NOT_FOUND','Child not found');const card=await tx.rfidCard.findFirst({where:{id:p.cardId,childId,centerId:req.user.centerId,status:'ACTIVE'}});if(!card)throw fail(409,'CARD_CHANGED','Card assignment changed; refresh');await tx.rfidCard.update({where:{id:card.id},data:{status:'REVOKED',revokedAt:await dbTime(tx),reason:p.reason}});await tx.auditLog.create({data:{userId:req.user.id,resourceId:childId,action:'RFID_CARD_REVOKED'}});return {revoked:true};});res.json({data});
 }));
}
