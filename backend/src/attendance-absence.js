import {CHECKOUT_ACTION,checkoutView} from './attendance-checkout.js';
import {hydrateConfirmations} from './rfid-storage.js';
import {z} from 'zod';
import {attendanceDay,dbTime,fail,serial,identifier} from './events.js';
import {latestReset,ABSENCE_CORRECTION,RESET_ACTION} from './attendance-reset.js';

export const ABSENCE_ACTION='ATTENDANCE_ABSENT:';
export async function absenceAvailable(db){
 // Both the installed generated client and the database must support the enum.
 if(!db._runtimeDataModel?.enums?.AttendanceStatus?.values?.some(v=>(v.name??v)==='ABSENT'))return false;
 const rows=await db.$queryRaw`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='AttendanceStatus' AND e.enumlabel='ABSENT'`;
 return rows.some(r=>r.enumlabel==='ABSENT');
}
const evidenceView=log=>({id:log.id,attendanceId:log.resourceId,type:log.action===ABSENCE_CORRECTION?'CORRECTED':'ABSENT',at:log.createdAt,by:{id:log.userId,username:log.user?.username??null}});
export async function absenceEvidence(db,ids){
 if(!ids.length)return [];
 const logs=await db.auditLog.findMany({where:{resourceId:{in:ids},OR:[{action:{startsWith:ABSENCE_ACTION}},{action:ABSENCE_CORRECTION}]},include:{user:{select:{username:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 return logs.map(evidenceView);
}
const markBody=z.object({childId:z.string().uuid(),day:z.string().date(),attendanceId:z.string().uuid().nullable(),expectedStatus:z.enum(['NO_RECORD','NOT_CHECKED_IN']),attendanceEpoch:identifier.optional(),confirmed:z.literal(true),reason:z.string().trim().max(200).optional()}).strict();
const correctionBody=z.object({day:z.string().date(),absenceId:z.string().uuid(),confirmed:z.literal(true)}).strict();
async function currentAbsence(db,id){const epoch=await latestReset(db,id);return db.auditLog.findFirst({where:{resourceId:id,action:{startsWith:ABSENCE_ACTION+(epoch?.id??'INITIAL')+':'}},orderBy:[{createdAt:'desc'},{id:'desc'}]});}
export async function changeAbsence(db,req,correct=false){
 if(req.user.role!=='TEACHER')throw fail(403,'FORBIDDEN','Only a Teacher can change absence');
 const body=(correct?correctionBody:markBody).parse(req.body);
 const id=correct?z.string().uuid().parse(req.params.id):null;
 if(!await absenceAvailable(db))throw fail(503,'ABSENCE_UNAVAILABLE','Absence recording is awaiting database and client activation');
 return serial(db,async tx=>{
  const actor=await tx.user.findUnique({where:{id:req.user.id}});
  if(!actor?.active||actor.role!=='TEACHER'||actor.centerId!==req.user.centerId)throw fail(403,'FORBIDDEN','A center Teacher is required');
  let record=correct?await tx.attendance.findFirst({where:{id,child:{centerId:actor.centerId}}}):null;
  const childId=correct?record?.childId:body.childId;
  const child=childId?await tx.child.findFirst({where:{id:childId,centerId:actor.centerId}}):null;
  if(!child)throw fail(404,'NOT_FOUND','Child attendance not found');
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId} FOR UPDATE`;
  record=await tx.attendance.findUnique({where:{childId_day:{childId,day:body.day}}});
  const now=await dbTime(tx);
  if(body.day!==attendanceDay(now))throw fail(409,'INVALID_TRANSITION','Only today\'s attendance can be changed');
  if(correct){
   if(record?.id!==id||record.status!=='ABSENT')throw fail(409,'INVALID_TRANSITION','Refresh attendance. This child is not marked absent');
   const latest=await currentAbsence(tx,id);
   if(latest?.id!==body.absenceId)throw fail(409,'ATTENDANCE_CYCLE_CHANGED','Refresh attendance before correcting the absence');
   const previousEpoch=await latestReset(tx,id);
   const epochTime=new Date(Math.max(+now,+latest.createdAt+1,previousEpoch?+previousEpoch.createdAt+1:0));
   await tx.auditLog.create({data:{resourceId:id,userId:actor.id,createdAt:epochTime,action:ABSENCE_CORRECTION}});
   // This audit ID is the new attendance epoch: old queued Gate evidence cannot re-arm it.
   return tx.attendance.update({where:{id},data:{status:'NOT_CHECKED_IN',gatePassAuthorized:false}});
  }
  const reset=record?await latestReset(tx,record.id):null;
  if((record?.id??null)!==body.attendanceId||(record?.status??'NO_RECORD')!==body.expectedStatus||(reset?.id??null)!==(body.attendanceEpoch??null))throw fail(409,'ATTENDANCE_CYCLE_CHANGED','Attendance changed. Refresh before marking absence');
  if(record){const confirmation=await tx.confirmation.findUnique({where:{attendanceId:record.id}});if(confirmation&&(!reset||confirmation.confirmedAt>=reset.createdAt))throw fail(409,'INVALID_TRANSITION','Confirmed attendance cannot be marked absent');}
  if(!tx.pickupRequest?.findFirst)throw fail(503,'ABSENCE_UNAVAILABLE','Pickup storage must be available before recording absence');
  if(await tx.pickupRequest.findFirst({where:{childId,centerId:actor.centerId,day:body.day,status:'PENDING',expiresAt:{gt:now}}}))throw fail(409,'PICKUP_PENDING','Review the pending pickup request before marking absence');
  const saved=record?await tx.attendance.update({where:{id:record.id},data:{status:'ABSENT',gatePassAuthorized:false}}):await tx.attendance.create({data:{childId,day:body.day,status:'ABSENT',gatePassAuthorized:false}});
  await tx.auditLog.create({data:{resourceId:saved.id,userId:actor.id,createdAt:new Date(Math.max(+now,reset?+reset.createdAt+1:0)),action:ABSENCE_ACTION+(reset?.id??'INITIAL')+':'+JSON.stringify({from:body.expectedStatus,to:'ABSENT',reason:body.reason??null,attendanceEpoch:reset?.id??null})}});
  await tx.activityAttendanceSession.updateMany({where:{attendanceId:saved.id,endedAt:null},data:{endedAt:now}});
  return saved;
 });
}
export async function teacherAttendanceRoster(db,req){
 if(req.user.role!=='TEACHER')throw fail(403,'FORBIDDEN','Teacher required');
 const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(100),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
 const now=await dbTime(db),day=attendanceDay(now),available=await absenceAvailable(db);
 const children=await db.child.findMany({where:{centerId:req.user.centerId},orderBy:[{name:'asc'},{id:'asc'}],take:q.limit,skip:q.offset});
 const childIds=children.map(c=>c.id);
 const records=childIds.length?await db.attendance.findMany({where:{childId:{in:childIds},day},include:{confirmations:true}}):[];
 await hydrateConfirmations(db,records);
 const ids=records.map(r=>r.id);
 const logs=ids.length?await db.auditLog.findMany({where:{resourceId:{in:ids},OR:[{action:{in:[RESET_ACTION,ABSENCE_CORRECTION]}},{action:{startsWith:ABSENCE_ACTION}},{action:{startsWith:CHECKOUT_ACTION}}]},include:{user:{select:{username:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}]}):[];
 const pending=childIds.length&&db.pickupRequest?.findMany?await db.pickupRequest.findMany({where:{childId:{in:childIds},centerId:req.user.centerId,day,status:'PENDING',expiresAt:{gt:now}},select:{childId:true}}):[];
 const pickupReadable=Boolean(db.pickupRequest?.findMany);
 const data=children.map(child=>{
  const record=records.find(r=>r.childId===child.id),audit=record?logs.filter(l=>l.resourceId===record.id):[];
  const epoch=audit.find(l=>[RESET_ACTION,ABSENCE_CORRECTION].includes(l.action));
  const absence=record?.status==='ABSENT'?audit.find(l=>l.action.startsWith(ABSENCE_ACTION+(epoch?.id??'INITIAL')+':')):null;
  const history=audit.filter(l=>l.action.startsWith(ABSENCE_ACTION)||l.action===ABSENCE_CORRECTION).map(evidenceView);
  const checkout=record?.status==='CHECKED_OUT'?checkoutView(audit.find(l=>l.action.startsWith(CHECKOUT_ACTION))):null;
  const pickup=pending.some(p=>p.childId===child.id);
  const canMarkAbsent=available&&pickupReadable&&!pickup&&!record?.confirmations?.some(c=>!epoch||new Date(c.confirmedAt)>=new Date(epoch.createdAt))&&['NO_RECORD','NOT_CHECKED_IN'].includes(record?.status??'NO_RECORD');
  return {...record,childId:child.id,checkout,absenceId:absence?.id,id:record?.id??child.id,attendanceId:record?.id??null,child:{id:child.id,name:child.name},day,status:record?.status??'NO_RECORD',attendanceEpoch:epoch?.id,confirmations:record?.confirmations??[],absenceHistory:history,canConfirm:record?.status==='CHECKIN_PENDING',canCheckout:record?.status==='PRESENT'&&Boolean(record.confirmations?.length)&&pickupReadable&&!pickup,checkoutBlockedByPickup:pickup,canMarkAbsent,canCorrectAbsence:available&&record?.status==='ABSENT'&&Boolean(absence),absenceAvailable:available};
 });
 return {data,page:q,day};
}
