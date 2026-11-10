import {absenceEvidence,absenceAvailable} from './attendance-absence.js';
import {hydrateConfirmations} from './rfid-storage.js';
import { CHECKOUT_ACTION, checkoutView } from './attendance-checkout.js';
import { z } from 'zod';
import { attendanceDay, dbTime, fail } from './events.js';
import { RESET_ACTION,ABSENCE_CORRECTION } from './attendance-reset.js';
const states=['NOT_CHECKED_IN','CHECKIN_PENDING','PRESENT','CHECKED_OUT','ABSENT'];
const stamp=value=>value?new Date(value).toISOString():null;
const childFields={id:true,name:true,centerId:true};
const fields={id:true,childId:true,day:true,status:true,child:{select:childFields},
 confirmations:{select:{id:true,userId:true,confirmedAt:true,user:{select:{id:true,username:true,centerId:true}}}},
 observations:{orderBy:{event:{receivedAt:'desc'}},take:50,select:{event:{select:{id:true,eventId:true,eventType:true,childId:true,receivedAt:true,observedAt:true,device:{select:{id:true,hardwareId:true,centerId:true}},beacon:{select:{hardwareId:true,centerId:true}}}}}}};
export async function readAttendanceMonitoring(db,req,{devResetEnabled=false}={}) {
 if(req.user.role!=='ADMIN')throw fail(403,'FORBIDDEN','Administrator required');
 const q=z.object({management:z.literal('true'),view:z.enum(['roster','history']).default('roster'),day:z.string().date().optional(),from:z.string().date().optional(),to:z.string().date().optional(),status:z.enum([...states,'NO_RECORD']).optional(),childId:z.string().uuid().optional(),search:z.string().trim().max(100).optional(),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
 const now=await dbTime(db),today=attendanceDay(now),day=q.day??today,centerId=req.user.centerId;
 if(day>today)throw fail(422,'VALIDATION_ERROR','Future attendance is unavailable');
 const from=q.view==='history'?(q.from??day):day,to=q.view==='history'?(q.to??day):day;
 if(from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>30)throw fail(422,'VALIDATION_ERROR','Select at most 31 center-local dates');
 if(q.view==='history'&&q.status==='NO_RECORD')throw fail(422,'VALIDATION_ERROR','Missing records are not attendance history');
 const period=q.view==='history'?{gte:from,lte:to}:day;
 const [rosterCount,grouped]=await Promise.all([db.child.count({where:{centerId}}),db.attendance.groupBy({by:['day','status'],where:{day:period,child:{centerId}},_count:{_all:true}})]);
 const counts=Object.fromEntries(states.map(s=>[s,0]));for(const g of grouped)counts[g.status]=(counts[g.status]??0)+g._count._all;
 const summary={...counts,NO_RECORD:q.view==='roster'?Math.max(0,rosterCount-Object.values(counts).reduce((a,b)=>a+b,0)):null,rosterCount};
 const name={...(q.childId?{id:q.childId}:{}),...(q.search?{name:{contains:q.search,mode:'insensitive'}}:{})};
 let records,children,hasMore;
 if(q.view==='roster'){
  children=await db.child.findMany({where:{centerId,...name,...(q.status?{attendance:q.status==='NO_RECORD'?{none:{day}}:{some:{day,status:q.status}}}:{})},select:{...childFields,attendance:{where:{day},select:fields,take:1}},orderBy:[{name:'asc'},{id:'asc'}],take:q.limit+1,skip:q.offset});
  hasMore=children.length>q.limit;children=children.slice(0,q.limit);records=children.flatMap(c=>c.attendance);
 }else{
  records=await db.attendance.findMany({where:{day:period,child:{centerId,...name},...(q.status?{status:q.status}:{})},select:fields,orderBy:[{day:'desc'},{id:'asc'}],take:q.limit+1,skip:q.offset});
  hasMore=records.length>q.limit;records=records.slice(0,q.limit);children=records.map(r=>r.child);
 }
 const childIds=[...new Set(children.map(c=>c.id))],recordIds=records.map(r=>r.id);
 await hydrateConfirmations(db,records);
 const absenceHistory=await absenceEvidence(db,recordIds);
 const [assignments,audits]=await Promise.all([
  childIds.length?db.assignment.findMany({where:{childId:{in:childIds},endedAt:null,child:{centerId},device:{centerId}},select:{id:true,childId:true,device:{select:{id:true,hardwareId:true,active:true}}},take:q.limit}):[],
  recordIds.length?db.auditLog.findMany({where:{resourceId:{in:recordIds},OR:[{action:{in:['ATTENDANCE_CONFIRMED_ADMIN','ATTENDANCE_CONFIRMED_TEACHER',RESET_ACTION,ABSENCE_CORRECTION]}},{action:{startsWith:'ATTENDANCE_CONFIRMATION_SNAPSHOT:'}},{action:{startsWith:CHECKOUT_ACTION}}]},select:{id:true,resourceId:true,userId:true,action:true,createdAt:true,user:{select:{id:true,username:true,centerId:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:500}):[],
 ]);
 function view(record,child){
  const logs=record?audits.filter(a=>a.resourceId===record.id):[],reset=logs.find(a=>[RESET_ACTION,ABSENCE_CORRECTION].includes(a.action));
  const observations=(record?.observations??[]).map(o=>o.event).filter(e=>e.childId===child.id&&e.eventType==='CHILD_NEAR_GATE'&&e.device.centerId===centerId&&e.beacon?.centerId===centerId).sort((a,b)=>a.receivedAt-b.receivedAt);
  const arrival=(reset?observations.find(e=>e.receivedAt>reset.createdAt):observations[0])??null;
  const role=(id,time)=>logs.find(a=>a.userId===id&&+a.createdAt===+new Date(time)&&a.action.startsWith('ATTENDANCE_CONFIRMED_'))?.action.slice('ATTENDANCE_CONFIRMED_'.length)??null;
  const confirmations=(record?.confirmations??[]).filter(c=>c.method==='RFID_CARD'?c.reader?.centerId===centerId:c.user?.centerId===centerId).map(c=>({id:c.id,userId:c.userId,username:c.user?.username??null,method:c.method??'TEACHER',reader:c.reader?{hardwareId:c.reader.hardwareId}:null,confirmedAt:stamp(c.confirmedAt),roleAtConfirmation:role(c.userId,c.confirmedAt)}));
  const archived=logs.filter(a=>a.action.startsWith('ATTENDANCE_CONFIRMATION_SNAPSHOT:')&&a.user?.centerId===centerId).flatMap(a=>{try{const value=JSON.parse(a.action.slice('ATTENDANCE_CONFIRMATION_SNAPSHOT:'.length));return [{userId:a.userId,username:a.user.username,confirmedAt:stamp(value.confirmedAt),roleAtConfirmation:role(a.userId,value.confirmedAt)}];}catch{return [];}});
  const previous=[...new Map([...confirmations.filter(()=>record?.status!=='PRESENT'&&record?.status!=='CHECKED_OUT'),...archived].map(c=>[c.userId+':'+c.confirmedAt,c])).values()];
  return {id:record?.id??child.id,attendanceId:record?.id??null,child:{id:child.id,name:child.name},day:record?.day??day,status:record?.status??'NO_RECORD',
   absenceHistory:absenceHistory.filter(a=>a.attendanceId===record?.id),
   currentAssignment:assignments.find(a=>a.childId===child.id)??null,
   arrival:arrival?{eventId:arrival.eventId,receivedAt:stamp(arrival.receivedAt),observedAt:stamp(arrival.observedAt),wearable:arrival.device.hardwareId,gate:arrival.beacon.hardwareId,timingNote:'Receipt-based legacy arrival; sensor observation age is not supplied'}:null,
   confirmation:record?.status==='PRESENT'||record?.status==='CHECKED_OUT'?confirmations[0]??null:null,
   checkout:record?.status==='CHECKED_OUT'?checkoutView(logs.find(a=>a.action.startsWith(CHECKOUT_ACTION)&&a.user?.centerId===centerId)):null,
   previousConfirmations:previous,
   resets:logs.filter(a=>a.action===RESET_ACTION&&a.user?.centerId===centerId).map(a=>({id:a.id,username:a.user.username,createdAt:stamp(a.createdAt)})),canConfirm:false,confirmationClosed:record?.status==='CHECKIN_PENDING'&&record.day!==today,
   canReset:devResetEnabled&&record?.day===today&&record?.status==='PRESENT'&&confirmations.length>0&&confirmations[0].method!=='RFID_CARD',confirmations};
 }
 const rows=q.view==='roster'?children.map(c=>view(c.attendance[0],c)):records.map(r=>view(r,r.child));
 return {rows,summary,absenceAvailable:await absenceAvailable(db),days:grouped.map(g=>({day:g.day,status:g.status,count:g._count._all})),day,today,from,to,timezone:'Asia/Colombo',serverTime:now.toISOString(),hasMore,limit:q.limit,offset:q.offset,auditHistoryMayBeTruncated:audits.length===500,observationLimitPerRecord:50,rosterNote:'Current center roster; enrollment start dates are not stored. Missing records do not establish absence.'};
}
