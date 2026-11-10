import {CONNECTION_LOST,connectionDetails} from './wearable-connection.js';
import {checkedRows,reviewFor,dangerGroupIds,connectionReview} from './teacher-alert-checks.js';
import {z} from 'zod';
import {fail} from './events.js';
import {monitoringEvent,monitoringEventFields} from './device-monitoring.js';
export function teacherOnly(req){if(req.user?.role!=='TEACHER'||!req.user.centerId)throw fail(403,'FORBIDDEN','Center Teacher required');}
export async function teacherAlerts(db,req,{reviewSecret,selectedIds}={}){
 teacherOnly(req);
 const q=z.object({review:z.literal('false').optional(),kind:z.literal('DANGER_ZONE_NEAR').optional(),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
 const centerId=req.user.centerId;
 const rows=await db.alert.findMany({where:{NOT:{kind:'BEACON_SIGNAL_LOST'},...(selectedIds?{id:{in:selectedIds}}:{}),...(q.kind?{kind:q.kind}:{}),event:{device:{centerId},child:{centerId}}},select:{id:true,kind:true,createdAt:true,details:true,event:{select:{...monitoringEventFields,device:{select:{hardwareId:true,centerId:true}},beacon:{select:{id:true,hardwareId:true,centerId:true,kind:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit,skip:q.offset});
 const checks=await checkedRows(db,req.user,rows.filter(r=>['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN',CONNECTION_LOST].includes(r.kind)).map(r=>r.id));
 return Promise.all(rows.map(async row=>{
  if(row.event.device?.centerId!==centerId||row.event.child?.centerId!==centerId)throw fail(503,'ALERT_SCOPE_INVALID','Alert scope requires review');
  const event=monitoringEvent(row.event,centerId),b=row.event.beacon,snapshot=row.event.payload?.beaconMetadata;
  const check=checks.get(row.id),checkable=['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN',CONNECTION_LOST].includes(row.kind),review=q.review!=='false'&&['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN'].includes(row.kind)&&!check?await reviewFor(db,req.user,row,event.recordedChild.id,reviewSecret):q.review!=='false'&&row.kind===CONNECTION_LOST&&!check?connectionReview(req.user,row,event.recordedChild.id,reviewSecret):{};
  return {connection:row.kind===CONNECTION_LOST?connectionDetails(row.details):null,details:row.kind==='LOW_ACTIVITY_ADVISORY'?row.details:row.kind==='GEOFENCE_OUTSIDE'?{zone:{name:typeof row.details?.zone?.name==='string'?row.details.zone.name:null}}:null,...review,checkedByMe:Boolean(check),checkedAt:check?.createdAt??null,canCheck:checkable&&!check&&Boolean(review.reviewToken),id:row.id,kind:row.kind,state:'RECORDED',createdAt:row.createdAt,child:event.recordedChild,
   event:{...event,device:{hardwareId:row.event.device.hardwareId},beacon:b?.centerId===centerId?{hardwareId:b.hardwareId,kind:b.kind,name:typeof snapshot?.name==='string'?snapshot.name:null,location:typeof snapshot?.location==='string'?snapshot.location:null}:null}};
 }));
}

export async function teacherDangerGroups(db,req,{reviewSecret}={}){
 teacherOnly(req);
 const q=z.object({limit:z.coerce.number().int().min(1).max(25).default(5),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
 if(!reviewSecret)throw fail(503,'UNAVAILABLE','Notification checking is unavailable');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const ids=await dangerGroupIds(tx,req.user,q);
  if(!ids.length)return [];
  const rows=await teacherAlerts(tx,{...req,query:{limit:ids.length,offset:0}},{reviewSecret,selectedIds:ids.map(r=>r.id)});
  const result=ids.map(group=>rows.find(r=>r.id===group.id)).filter(Boolean).map(row=>({...row,latestAlertId:row.id}));
  return result;
 },{isolationLevel:'RepeatableRead'});
}
