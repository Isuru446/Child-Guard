import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { fail, serial } from './events.js';
import {tamperStatus} from './tamper.js';
import {rfidInstalled} from './rfid-storage.js';

const uuid=z.string().uuid();
const date=z.string().date();
const birthDate=date.refine(value=>value<=new Date().toISOString().slice(0,10));
const fields={name:z.string().trim().min(2).max(150),dateOfBirth:birthDate.nullable().optional(),groupName:z.string().trim().max(80).nullable().optional()};
const createSchema=z.object(fields).strict();
const expected=z.object({name:z.string().max(150),dateOfBirth:date.nullable(),groupName:z.string().max(80).nullable()}).strict();
const editSchema=z.object({...fields,expected}).strict();
const snapshot=row=>({name:row.name,dateOfBirth:row.dateOfBirth?row.dateOfBirth.toISOString().slice(0,10):null,groupName:row.groupName??null});
export const duplicateChildWhere=(centerId,name,dateOfBirth)=>({centerId,name:{equals:name,mode:'insensitive'},...(dateOfBirth?{OR:[{dateOfBirth},{dateOfBirth:null}]}:{})});
const childFields={id:true,name:true,dateOfBirth:true,groupName:true};
const visibleRelations=centerId=>({
 guardians:{where:{user:{centerId}},select:{user:{select:{id:true,username:true,role:true,active:true,profile:{select:{fullName:true}}}}}},
 assignments:{where:{endedAt:null,device:{centerId}},select:{id:true,startedAt:true,device:{select:{id:true,hardwareId:true,active:true,lastSeen:true,centerId:true}}}},
});
export function mountChildRoutes(app,{db,asyncRoute}) {
 const admin=(req,res,next)=>req.user.role==='ADMIN'?next():next(fail(403,'FORBIDDEN','Administrator required'));
 app.use('/api/v1/admin/children',admin,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const writes=rateLimit({windowMs:60000,limit:20,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Child administration rate exceeded'}}});
 const audit=(tx,req,id,action)=>tx.auditLog.create({data:{userId:req.user.id,resourceId:id,action}});
 app.get('/api/v1/admin/children',asyncRoute(async(req,res)=>{
  const q=z.object({search:z.string().trim().max(100).optional(),group:z.string().trim().max(80).optional(),guardian:z.enum(['LINKED','UNLINKED']).optional(),limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
  const centerId=req.user.centerId;
  const rows=await db.child.findMany({where:{centerId,...(q.search?{name:{contains:q.search,mode:'insensitive'}}:{}),...(q.group?{groupName:{equals:q.group,mode:'insensitive'}}:{}),...(q.guardian?{guardians:{[q.guardian==='LINKED'?'some':'none']:{user:{centerId}}}}:{})},select:{...childFields,...visibleRelations(centerId)},orderBy:[{name:'asc'},{id:'asc'}],take:q.limit,skip:q.offset});
  const ready=await rfidInstalled(db);
  const cards=ready&&rows.length?await db.rfidCard.findMany({where:{childId:{in:rows.map(r=>r.id)},centerId,status:'ACTIVE'},select:{childId:true}}):[];
  res.json({data:rows.map(r=>({...r,rfidStatus:ready?(cards.some(c=>c.childId===r.id)?'ASSIGNED':'NOT_ASSIGNED'):'SETUP_PENDING'})),page:{limit:q.limit,offset:q.offset}});
 }));
 app.get('/api/v1/admin/children/:id',asyncRoute(async(req,res)=>{
  const row=await db.child.findFirst({where:{id:uuid.parse(req.params.id),centerId:req.user.centerId},select:{...childFields,...visibleRelations(req.user.centerId),enrollmentRequests:{where:{centerId:req.user.centerId},select:{id:true,status:true,reviewedAt:true},orderBy:{createdAt:'desc'},take:25}}});
  if(!row)throw fail(404,'NOT_FOUND','Child unavailable');
  for(const a of row.assignments??[])a.device.tamper=await tamperStatus(db,a.device,{childId:row.id});
  res.json({data:row});
 }));
 app.post('/api/v1/admin/children',writes,asyncRoute(async(req,res)=>{
  const body=createSchema.parse(req.body),data={name:body.name,dateOfBirth:body.dateOfBirth?new Date(body.dateOfBirth+'T00:00:00Z'):null,groupName:body.groupName??null,centerId:req.user.centerId};
  const row=await serial(db,async tx=>{
   // Serializable predicate read prevents simultaneous duplicate enrollments.
   // A match requires human review; it never merges children or infers kinship.
   if(await tx.child.count({where:duplicateChildWhere(data.centerId,data.name,data.dateOfBirth)}))throw fail(409,'DUPLICATE_REVIEW','Review the existing child before enrolling another matching record');
   const row=await tx.child.create({data,select:childFields});
   await audit(tx,req,row.id,'CHILD_ENROLLED');return row;
  });
  res.status(201).json({data:row});
 }));
 // The existing edit route now requires the previously read field snapshot.
 app.patch('/api/v1/admin/children/:id',writes,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=editSchema.parse(req.body);
  const row=await serial(db,async tx=>{
   const current=await tx.child.findFirst({where:{id,centerId:req.user.centerId},select:childFields});
   if(!current)throw fail(404,'NOT_FOUND','Child unavailable');
   if(Object.entries(snapshot(current)).some(([key,value])=>value!==body.expected[key]))throw fail(409,'CHILD_CHANGED','Child details changed; reload before editing');
   const data={name:body.name,...(body.dateOfBirth!==undefined?{dateOfBirth:body.dateOfBirth?new Date(body.dateOfBirth+'T00:00:00Z'):null}:{}),...(body.groupName!==undefined?{groupName:body.groupName}:{})};
   const nextBirth=data.dateOfBirth===undefined?current.dateOfBirth:data.dateOfBirth;
   if(current.name!==data.name||snapshot(current).dateOfBirth!==(nextBirth?nextBirth.toISOString().slice(0,10):null)){
    if(await tx.child.count({where:{...duplicateChildWhere(req.user.centerId,data.name,nextBirth),id:{not:id}}}))throw fail(409,'DUPLICATE_REVIEW','Review the existing child before using matching details');
   }
   const result=await tx.child.update({where:{id},data,select:childFields});
   await audit(tx,req,id,'CHILD_DETAILS_UPDATED');return result;
  });
  res.json({data:row});
 }));
}
