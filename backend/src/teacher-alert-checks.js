import {createHash} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {serial,dbTime,fail} from './events.js';

export const CHECK_PREFIX='TEACHER_DANGER_CHECKED:';
// AuditLog.id is TEXT with an existing primary key. Length framing prevents ambiguous identities.
export const checkId=(teacher,center,alert)=>CHECK_PREFIX+[teacher,center,alert].map(s=>Buffer.byteLength(s,'utf8')+':'+s).join('');
export const alertScope=teacher=>({device:{centerId:teacher.centerId},child:{centerId:teacher.centerId}});
const eligible=(teacher,childId,boundary)=>({kind:{in:['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN']},event:{...alertScope(teacher),childId},OR:[{createdAt:{lt:boundary.createdAt}},{createdAt:boundary.createdAt,id:{lte:boundary.id}}]});
const digest=ids=>createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
export async function checkedRows(db,teacher,ids){
 if(!ids.length)return new Map();
 const rows=await db.auditLog.findMany({where:{id:{in:ids.map(id=>checkId(teacher.id,teacher.centerId,id))},userId:teacher.id,action:{startsWith:CHECK_PREFIX}},select:{id:true,resourceId:true,userId:true,createdAt:true,action:true},take:ids.length});
 if(rows.some(log=>!log.action.startsWith(CHECK_PREFIX)||log.id!==checkId(teacher.id,teacher.centerId,log.resourceId)))throw fail(503,'CHECK_STORAGE_INVALID','Notification check history needs review');
 return new Map(rows.map(log=>[log.resourceId,log]));
}
export async function uncheckedPrefix(db,teacher,boundary,childId){
 const result=[];
 for(let skip=0;;skip+=250){
  const rows=await db.alert.findMany({where:eligible(teacher,childId,boundary),select:{id:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:250});
  const checked=await checkedRows(db,teacher,rows.map(r=>r.id));
  result.push(...rows.filter(row=>!checked.has(row.id)).map(row=>row.id));
  if(rows.length<250)return result;
 }
}
export async function reviewFor(db,teacher,boundary,childId,secret){
 const ids=await uncheckedPrefix(db,teacher,boundary,childId);
 return {uncheckedCount:ids.length,reviewToken:secret&&ids.length?jwt.sign({purpose:'teacher-danger-review',centerId:teacher.centerId,childId,boundaryId:boundary.id,digest:digest(ids)},secret,{subject:teacher.id,issuer:'childguard',audience:'childguard-teacher-danger-review',algorithm:'HS256',expiresIn:'30m'}):null};
}
export function connectionReview(teacher,boundary,childId,secret){
 return {reviewToken:secret?jwt.sign({purpose:'teacher-connection-review',centerId:teacher.centerId,childId,boundaryId:boundary.id,digest:digest([boundary.id])},secret,{subject:teacher.id,issuer:'childguard',audience:'childguard-teacher-danger-review',algorithm:'HS256',expiresIn:'30m'}):null};
}
export async function dangerGroupIds(db,teacher,{limit,offset}){
 // DISTINCT ON happens BEFORE the outer LIMIT: a child's repeated events cannot hide other children.
 return db.$queryRaw`WITH unchecked_groups AS (
  SELECT DISTINCT ON (e."childId") a.id,a."createdAt",e."childId"
  FROM public."Alert" a JOIN public."DeviceEvent" e ON e.id=a."eventId"
  JOIN public."Device" d ON d.id=e."deviceId" JOIN public."Child" c ON c.id=e."childId"
  WHERE a.kind IN ('DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN') AND d."centerId"=${teacher.centerId} AND c."centerId"=${teacher.centerId}
  AND NOT EXISTS (SELECT 1 FROM public."AuditLog" l WHERE l.id=
   'TEACHER_DANGER_CHECKED:' || octet_length(${teacher.id}::text)::text || ':' || ${teacher.id}::text ||
   octet_length(${teacher.centerId}::text)::text || ':' || ${teacher.centerId}::text || octet_length(a.id)::text || ':' || a.id
   AND l."userId"=${teacher.id} AND l."resourceId"=a.id AND left(l.action,length('TEACHER_DANGER_CHECKED:'))='TEACHER_DANGER_CHECKED:')
  ORDER BY e."childId",a."createdAt" DESC,a.id DESC
 ) SELECT id,"childId","createdAt" FROM unchecked_groups ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
}
export async function checkTeacherDanger(db,req,secret){
 if(req.user?.role!=='TEACHER'||!req.user.centerId)throw fail(403,'FORBIDDEN','Teacher required');
 const id=z.string().uuid().parse(req.params.id),body=z.object({reviewToken:z.string().min(1).max(4096)}).strict().parse(req.body);
 return serial(db,async tx=>{
  const teacher=await tx.user.findUnique({where:{id:req.user.id}});
  if(!teacher?.active||teacher.role!=='TEACHER'||teacher.centerId!==req.user.centerId)throw fail(403,'FORBIDDEN','Active center Teacher required');
  const boundary=await tx.alert.findFirst({where:{id,kind:{in:['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN','WEARABLE_CONNECTION_LOST']},event:alertScope(teacher)},select:{id:true,kind:true,createdAt:true,event:{select:{childId:true}}}});
  if(!boundary)throw fail(404,'NOT_FOUND','Notification not found');
  const connection=boundary.kind==='WEARABLE_CONNECTION_LOST';
  let token;try{token=jwt.verify(body.reviewToken,secret,{algorithms:['HS256'],issuer:'childguard',audience:'childguard-teacher-danger-review',subject:teacher.id});}catch{throw fail(409,'ALERT_REVIEW_CHANGED','Refresh notifications before checking this group');}
  if(token.purpose!==(connection?'teacher-connection-review':'teacher-danger-review')||token.centerId!==teacher.centerId||token.childId!==boundary.event.childId||token.boundaryId!==id)throw fail(409,'ALERT_REVIEW_CHANGED','Refresh notifications before checking this group');
  const prior=await checkedRows(tx,teacher,[id]);
  if(prior.has(id))return {checkedByMe:true,checkedAt:prior.get(id).createdAt,duplicate:true};
  const ids=connection?[id]:await uncheckedPrefix(tx,teacher,boundary,boundary.event.childId);
  // Freeze the reviewed set. Late commits, equal-time inserts or another check cannot silently extend it.
  if(!ids.length||digest(ids)!==token.digest)throw fail(409,'ALERT_REVIEW_CHANGED','New or changed alerts are available. Refresh before checking');
  const now=await dbTime(tx);
  for(let offset=0;offset<ids.length;offset+=250)await tx.auditLog.createMany({data:ids.slice(offset,offset+250).map(alert=>({id:checkId(teacher.id,teacher.centerId,alert),userId:teacher.id,resourceId:alert,action:CHECK_PREFIX+id,createdAt:now}))});
  return {checkedByMe:true,checkedAt:now,checkedCount:ids.length,duplicate:false};
 });
}
