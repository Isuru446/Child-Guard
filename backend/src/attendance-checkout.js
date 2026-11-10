import { z } from 'zod';
import { attendanceDay, dbTime, fail, identifier, serial } from './events.js';
import { latestReset } from './attendance-reset.js';

export const CHECKOUT_ACTION='ATTENDANCE_CHECKED_OUT:';
export function checkoutView(log) {
 if(!log)return null;
 try {const value=JSON.parse(log.action.slice(CHECKOUT_ACTION.length));return {at:log.createdAt,by:{id:log.userId,username:log.user?.username??null},role:'TEACHER',confirmationAt:value.confirmationAt};}catch{return null;}
}
export async function checkoutAttendance(db,req) {
 if(req.user.role!=='TEACHER')throw fail(403,'FORBIDDEN','A center Teacher must confirm the child has left');
 const id=identifier.parse(req.params.id);
 const body=z.object({confirmedAt:z.string().datetime(),attendanceEpoch:identifier.optional(),departureConfirmed:z.literal(true)}).strict().parse(req.body);
 return serial(db,async tx=>{
  const actor=await tx.user.findUnique({where:{id:req.user.id}});
  if(!actor?.active||actor.role!=='TEACHER'||actor.centerId!==req.user.centerId)throw fail(403,'FORBIDDEN','A center Teacher is required');
  let record=await tx.attendance.findFirst({where:{id,child:{centerId:actor.centerId}}});
  if(!record)throw fail(404,'NOT_FOUND','Attendance record not found');
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${record.childId} FOR UPDATE`;
  record=await tx.attendance.findUnique({where:{id}});
  const now=await dbTime(tx),confirmation=await tx.confirmation.findUnique({where:{attendanceId:id}}),reset=await latestReset(tx,id);
  if(record.day!==attendanceDay(now))throw fail(409,'INVALID_TRANSITION','Only today’s confirmed attendance can be checked out');
  if(!confirmation||confirmation.confirmedAt.toISOString()!==body.confirmedAt||(reset&&body.attendanceEpoch!==reset.id))throw fail(409,'ATTENDANCE_CYCLE_CHANGED','Attendance changed. Refresh before checking out');
  const previous=await tx.auditLog.findFirst({where:{resourceId:id,action:{startsWith:CHECKOUT_ACTION}},orderBy:[{createdAt:'desc'},{id:'desc'}],include:{user:{select:{username:true}}}});
  if(record.status==='CHECKED_OUT'&&checkoutView(previous)?.confirmationAt===body.confirmedAt)return {...record,checkout:checkoutView(previous),duplicate:true};
  if(record.status!=='PRESENT')throw fail(409,'INVALID_TRANSITION','Only a child currently marked Present can be checked out');
  // Never bypass or complete the independent pickup-person/code/handover workflow.
  if(!tx.pickupRequest?.findFirst)throw fail(503,'CHECKOUT_UNAVAILABLE','Check-out is unavailable. Ask the project owner to check Pickup setup');
  const pending=await tx.pickupRequest.findFirst({where:{childId:record.childId,centerId:actor.centerId,day:record.day,status:'PENDING',expiresAt:{gt:now}}});
  if(pending)throw fail(409,'PICKUP_PENDING','Complete or reject the pending pickup request in Pickup before checking out');
  const log=await tx.auditLog.create({data:{userId:actor.id,resourceId:id,createdAt:now,action:CHECKOUT_ACTION+JSON.stringify({confirmationAt:body.confirmedAt,attendanceEpoch:reset?.id??null,from:'PRESENT',to:'CHECKED_OUT',role:'TEACHER'})}});
  await tx.activityAttendanceSession.updateMany({where:{attendanceId:id,endedAt:null},data:{endedAt:now}});
  const result=await tx.attendance.update({where:{id},data:{status:'CHECKED_OUT',gatePassAuthorized:false}});
  return {...result,checkout:{...checkoutView(log),by:{id:actor.id,username:actor.username}},duplicate:false};
 });
}
