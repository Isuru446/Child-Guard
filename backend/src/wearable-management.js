import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { identifier, fail, serial, dbTime } from './events.js';

const uuid=z.string().uuid();
const publicFields={id:true,hardwareId:true,centerId:true,active:true,lastSeen:true};
export {communicationState as managementCommunicationState} from './wearable-connection.js';
export const deviceInventoryQuery=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0),management:z.literal('true').optional(),search:z.string().trim().max(100).optional(),state:z.enum(['ACTIVE','INACTIVE']).optional(),assignment:z.enum(['ASSIGNED','UNASSIGNED']).optional()}).strict();
export function inventoryScope(req,q) {
 if((q.management||q.search||q.state||q.assignment)&&req.user.role!=='ADMIN')throw fail(403,'FORBIDDEN','Administrator required');
 if((q.search||q.state||q.assignment)&&!q.management)throw fail(422,'VALIDATION_ERROR','Management view required');
 return {centerId:req.user.centerId,...(q.search?{hardwareId:{contains:q.search,mode:'insensitive'}}:{}),...(q.state?{active:q.state==='ACTIVE'}:{}),...(q.assignment?{assignments:{[q.assignment==='ASSIGNED'?'some':'none']:{endedAt:null}}}:{})};
}
export async function deviceAssignmentView(db,device,history=false) {
 const select={id:true,childId:true,child:{select:{id:true,name:true}},startedAt:true,endedAt:true};
 const where={deviceId:device.id,child:{centerId:device.centerId}};
 const current=await db.assignment.findMany({where:{...where,endedAt:null},select,take:2});
 if(current.length>1)throw fail(503,'ASSIGNMENT_STATE_INVALID','Assignment state requires review');
 return {currentAssignment:current[0]??null,...(history?{assignmentHistory:await db.assignment.findMany({where,select,orderBy:[{startedAt:'desc'},{id:'desc'}],take:50})}:{})};
}
export function mountWearableManagement(app,{db,asyncRoute,hashDeviceToken}) {
 const admin=(req,res,next)=>req.user.role==='ADMIN'?next():next(fail(403,'FORBIDDEN','Administrator required'));
 app.use('/api/v1/admin/devices',admin,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const writes=rateLimit({windowMs:60000,limit:20,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Device administration rate exceeded'}}});
 const audit=(tx,req,id,action)=>tx.auditLog.create({data:{userId:req.user.id,resourceId:id,action}});
 const conflict=()=>fail(409,'ASSIGNMENT_CONFLICT','Assignments changed or conflict. Refresh and review; unassign conflicting belts explicitly first');
 async function device(tx,id,centerId,active) {
  const row=await tx.device.findFirst({where:{id,centerId,...(active?{active:true}:{})},select:publicFields});
  if(!row)throw fail(404,'NOT_FOUND','Device unavailable in your center');return row;
 }
 async function child(tx,id,centerId) {
  const row=await tx.child.findFirst({where:{id,centerId,guardians:{some:{user:{centerId,role:'PARENT',active:true}}}},select:{id:true}});
  if(!row)throw fail(404,'NOT_FOUND','Child with an active verified Parent is required in your center');return row;
 }
 app.post('/api/v1/admin/devices',writes,asyncRoute(async(req,res)=>{
  // Supplied privately from the belt's existing provisioning. Never returned,
  // rotated, logged or used to take over an already registered hardware ID.
  const body=z.object({hardwareId:identifier,deviceToken:z.string().regex(/^[\x21-\x7e]{32,256}$/)}).strict().parse(req.body);
  const tokenHash=hashDeviceToken(body.deviceToken);
  try {
   const row=await serial(db,async tx=>{
    if(await tx.device.findFirst({where:{OR:[{hardwareId:body.hardwareId},{tokenHash}]},select:{id:true}}))throw fail(409,'DEVICE_UNAVAILABLE','Hardware identity or credential is unavailable');
    const row=await tx.device.create({data:{hardwareId:body.hardwareId,tokenHash,centerId:req.user.centerId,active:true},select:publicFields});
    await audit(tx,req,row.id,'DEVICE_REGISTERED');return row;
   });res.status(201).json({data:row});
  }catch(error){if(error.code==='P2002')throw fail(409,'DEVICE_UNAVAILABLE','Hardware identity or credential is unavailable');throw error;}
 }));
 app.patch('/api/v1/admin/devices/:id/status',writes,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=z.object({active:z.boolean(),expectedActive:z.boolean()}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   const current=await device(tx,id,req.user.centerId);
   if(current.active!==body.expectedActive)throw fail(409,'DEVICE_CHANGED','Device status changed. Refresh before editing');
   if(!body.active&&await tx.assignment.count({where:{deviceId:id,endedAt:null}}))throw fail(409,'ASSIGNED','Unassign the belt explicitly before deactivating it');
   const row=await tx.device.update({where:{id},data:{active:body.active},select:publicFields});
   await audit(tx,req,id,body.active?'DEVICE_ACTIVATED':'DEVICE_DEACTIVATED');return row;
  });res.json({data:row});
 }));
 app.post('/api/v1/admin/devices/:id/assignment',writes,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=z.object({childId:uuid,assignmentAcknowledged:z.literal(true)}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   await device(tx,id,req.user.centerId,true);await child(tx,body.childId,req.user.centerId);
   if(await tx.assignment.count({where:{endedAt:null,OR:[{deviceId:id},{childId:body.childId}]}}))throw conflict();
   const row=await tx.assignment.create({data:{deviceId:id,childId:body.childId,startedAt:await dbTime(tx)},select:{id:true,childId:true,startedAt:true}});
   await audit(tx,req,id,`WEARABLE_ASSIGNED:${body.childId}`);return row;
  });res.status(201).json({data:row});
 }));
 app.post('/api/v1/admin/devices/:id/unassign',writes,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=z.object({expectedAssignmentId:uuid,unassignAcknowledged:z.literal(true)}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   await device(tx,id,req.user.centerId);
   const previous=await tx.assignment.findFirst({where:{id:body.expectedAssignmentId,deviceId:id,endedAt:null,child:{centerId:req.user.centerId}}});
   if(!previous)throw conflict();
   const now=await dbTime(tx);
   await tx.assignment.update({where:{id:previous.id},data:{endedAt:now}});
   await audit(tx,req,id,`DEVICE_UNASSIGNED:${previous.id}`);return {id:previous.id,childId:previous.childId,endedAt:now};
  });res.json({data:row});
 }));
 // Existing transfer endpoint/body and one-history-row replacement semantics.
 app.post('/api/v1/admin/devices/:id/transfer',writes,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=z.object({expectedAssignmentId:uuid,childId:uuid,transferAcknowledged:z.literal(true)}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   await device(tx,id,req.user.centerId,true);await child(tx,body.childId,req.user.centerId);
   const previous=await tx.assignment.findFirst({where:{id:body.expectedAssignmentId,endedAt:null,device:{centerId:req.user.centerId},child:{centerId:req.user.centerId}}});
   const source=await tx.assignment.findFirst({where:{deviceId:id,endedAt:null}});
   const destination=await tx.assignment.findFirst({where:{childId:body.childId,endedAt:null}});
   if(!previous||(previous.deviceId!==id&&previous.childId!==body.childId)||(previous.deviceId===id&&previous.childId===body.childId)||(source&&source.id!==previous.id)||(destination&&destination.id!==previous.id))throw conflict();
   const now=await dbTime(tx);
   await tx.assignment.update({where:{id:previous.id},data:{endedAt:now}});
   const next=await tx.assignment.create({data:{deviceId:id,childId:body.childId,startedAt:now},select:{id:true,childId:true,startedAt:true}});
   await audit(tx,req,id,`DEVICE_TRANSFERRED:${previous.id}:${next.id}`);return next;
  });res.json({data:row});
 }));
}
