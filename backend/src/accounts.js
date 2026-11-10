import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { fail, serial, attendanceDay } from './events.js';
import { profileDetailsSchema } from './registration.js';

const ids = z.array(z.string().uuid()).max(100).refine(values => new Set(values).size === values.length);
const createSchema = z.object({
 username: z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9._@+-]+$/),
 password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
 role: z.enum(['PARENT', 'TEACHER']),
 childIds: ids.default([]),
}).strict().superRefine((value, context) => {
 if (value.role === 'PARENT' && value.childIds.length === 0) context.addIssue({code:'custom',message:'Parent requires at least one approved child',path:['childIds']});
 if (value.role === 'TEACHER' && value.childIds.length !== 0) context.addIssue({code:'custom',message:'Teachers use center membership, not Guardian links',path:['childIds']});
});
const userView = user => ({id:user.id,username:user.username,role:user.role,centerId:user.centerId,active:user.active});

// Mounted after session authentication. Only the authenticated administrator's center is
// accepted; clients cannot assign centerId, ADMIN, active, hashes or audit actors.
export function mountAccountRoutes(app, {db, asyncRoute, registrationEnabled=false}) {
 app.use('/api/v1/admin', (req,res,next) => req.user.role === 'ADMIN' ? next() : next(fail(403,'FORBIDDEN','Administrator required')));
 app.get('/api/v1/admin/safety-summary',asyncRoute(async(req,res)=>{
  const centerId=req.user.centerId;
  const [alerts,pendingAttendance]=await Promise.all([db.alert.count({where:{event:{device:{centerId}}}}),db.attendance.count({where:{child:{centerId},day:attendanceDay(new Date()),status:'CHECKIN_PENDING'}})]);
  res.set('Cache-Control','no-store').json({data:{alerts,pendingAttendance}});
 }));
 app.get('/api/v1/admin/overview',asyncRoute(async(req,res)=>{
  const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month??new Date().toISOString().slice(0,7));
  const start=`${month}-01`,end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10),centerId=req.user.centerId;
  const [children,attendance,childCount,teachers,devices,alerts,beacons,onlineDevices,activeBeacons,pendingRequests]=await Promise.all([
   db.child.findMany({where:{centerId},select:{id:true,name:true},take:1000}),
   db.attendance.findMany({where:{child:{centerId},day:{gte:start,lt:end}},select:{id:true,childId:true,day:true,status:true},take:10000}),
   db.child.count({where:{centerId}}),db.user.count({where:{centerId,role:'TEACHER'}}),db.device.count({where:{centerId}}),db.alert.count({where:{event:{device:{centerId}}}}),db.beacon.count({where:{centerId}}),db.device.count({where:{centerId,active:true,lastSeen:{gte:new Date(Date.now()-60000)}}}),db.beacon.count({where:{centerId,active:true}}),registrationEnabled?db.registrationApplication.count({where:{centerId,status:'PENDING'}}):Promise.resolve(null),
  ]);
   res.set('Cache-Control','no-store').json({data:{counts:{children:childCount,teachers,devices,alerts,beacons,onlineDevices,activeBeacons,pendingRequests},children,attendance:attendance.map(r=>({...r,date:r.day,status:r.status==='PRESENT'?'Present':r.status})),truncated:children.length===1000||attendance.length===10000}});
 }));
 const writes = rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Account administration rate exceeded'}}});
 async function authorizedChildren(tx, centerId, childIds) {
  if (!childIds.length) return;
  const children = await tx.child.findMany({where:{id:{in:childIds},centerId},select:{id:true}});
  if (children.length !== childIds.length) throw fail(404,'NOT_FOUND','One or more children are unavailable in your center');
 }
 app.get('/api/v1/admin/users', asyncRoute(async(req,res) => {
  const page = z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0),role:z.enum(['PARENT','TEACHER']).optional(),search:z.string().trim().max(100).optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).strict().parse(req.query);
  const rows = await db.user.findMany({where:{centerId:req.user.centerId,role:page.role??{in:['PARENT','TEACHER']},...(page.status?{active:page.status==='ACTIVE'}:{}),...(page.search?{OR:[{username:{contains:page.search,mode:'insensitive'}},{profile:{is:{fullName:{contains:page.search,mode:'insensitive'}}}}]}:{})},select:{id:true,username:true,role:true,centerId:true,active:true,profile:{select:{fullName:true,email:true,phone:true}},...(page.role==='PARENT'?{guardians:{where:{child:{centerId:req.user.centerId}},select:{child:{select:{id:true,name:true}}},orderBy:{childId:'asc'}}}:{})},orderBy:[{username:'asc'},{id:'asc'}],take:page.limit,skip:page.offset});
  res.set('Cache-Control','no-store');
  res.json({data:rows,page:{limit:page.limit,offset:page.offset}});
 }));
 const managedWhere = req => ({id:z.string().uuid().parse(req.params.id),centerId:req.user.centerId,role:{in:['PARENT','TEACHER']}});
 const detailFields = {
  id:true,username:true,role:true,centerId:true,active:true,
  profile:{select:{fullName:true,email:true,phone:true}},
  guardians:{select:{child:{select:{id:true,name:true}}}},
 };
 app.get('/api/v1/admin/users/:id',asyncRoute(async(req,res)=>{
  const row=await db.user.findFirst({where:managedWhere(req),select:{...detailFields,guardians:{...detailFields.guardians,where:{child:{centerId:req.user.centerId}}}}});
  if(!row)throw fail(404,'NOT_FOUND','Managed account unavailable');
  res.set('Cache-Control','no-store').json({data:row});
 }));
 app.patch('/api/v1/admin/users/:id/profile',writes,asyncRoute(async(req,res)=>{
  const where=managedWhere(req),body=profileDetailsSchema.parse(req.body);
  try {
   const profile=await serial(db,async tx=>{
    if(!await tx.user.findFirst({where,select:{id:true}}))throw fail(404,'NOT_FOUND','Managed account unavailable');
    const application=await tx.registrationApplication.findUnique({where:{email:body.email},select:{userId:true}});
    if(application&&application.userId!==where.id)throw fail(409,'PROFILE_CONFLICT','Email is unavailable');
    const result=await tx.userProfile.upsert({where:{userId:where.id},create:{userId:where.id,...body},update:body,select:{fullName:true,email:true,phone:true}});
    await tx.auditLog.create({data:{userId:req.user.id,resourceId:where.id,action:'MANAGED_PROFILE_UPDATED'}});
    return result;
   });
   res.json({data:profile});
  } catch(error) {if(error.code==='P2002')throw fail(409,'PROFILE_CONFLICT','Email is unavailable');throw error;}
 }));
 app.post('/api/v1/admin/users', writes, asyncRoute(async(req,res) => {
  const body = createSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(body.password,12);
  try {
   const user = await serial(db,async tx => {
    if (await tx.user.findUnique({where:{username:body.username},select:{id:true}})) throw fail(409,'USERNAME_EXISTS','Username is unavailable');
    await authorizedChildren(tx,req.user.centerId,body.childIds);
    const created = await tx.user.create({data:{username:body.username,passwordHash,role:body.role,centerId:req.user.centerId,active:true}});
    for (const childId of body.childIds) {
     await tx.guardian.create({data:{userId:created.id,childId}});
     await tx.auditLog.create({data:{userId:req.user.id,resourceId:childId,action:`GUARDIAN_LINK_CREATED:${created.id}`}});
    }
    await tx.auditLog.create({data:{userId:req.user.id,resourceId:created.id,action:`ACCOUNT_PROVISIONED_${created.role}`}});
    return created;
   });
   res.status(201).json({data:{...userView(user),childIds:body.childIds}});
  } catch (error) {
   if (error.code === 'P2002') throw fail(409,'USERNAME_EXISTS','Username is unavailable');
   throw error;
  }
 }));
 app.post('/api/v1/admin/users/:id/guardians', writes, asyncRoute(async(req,res) => {
  const userId = z.string().uuid().parse(req.params.id);
  const {childIds} = z.object({childIds:ids.refine(values=>values.length>0)}).strict().parse(req.body);
  const result = await serial(db,async tx => {
   const user = await tx.user.findFirst({where:{id:userId,centerId:req.user.centerId,role:'PARENT',active:true}});
   if (!user) throw fail(404,'NOT_FOUND','Active Parent account not found in your center');
   await authorizedChildren(tx,req.user.centerId,childIds);
   let linked = 0;
   for (const childId of childIds) {
    const key = {userId,childId};
    if (await tx.guardian.findUnique({where:{userId_childId:key}})) continue;
    await tx.guardian.create({data:key});
    await tx.auditLog.create({data:{userId:req.user.id,resourceId:childId,action:`GUARDIAN_LINK_CREATED:${userId}`}});
    linked++;
   }
   return {userId,childIds,linked};
  });
  res.json({data:result});
 }));
 app.delete('/api/v1/admin/users/:id/guardians',writes,asyncRoute(async(req,res)=>{
  const userId=z.string().uuid().parse(req.params.id);
  const {childId}=z.object({childId:z.string().uuid(),removalAcknowledged:z.literal(true)}).strict().parse(req.body);
  const result=await serial(db,async tx=>{
   if(!await tx.user.findFirst({where:{id:userId,centerId:req.user.centerId},select:{id:true}}))throw fail(404,'NOT_FOUND','Guardian account unavailable');
   await authorizedChildren(tx,req.user.centerId,[childId]);
   // Delete only the composite link. Never delete a Child, User or history.
   const {count}=await tx.guardian.deleteMany({where:{userId,childId}});
   if(count)await tx.auditLog.create({data:{userId:req.user.id,resourceId:childId,action:`GUARDIAN_LINK_REMOVED:${userId}`}});
   return {userId,childId,removed:count};
  });
  res.json({data:result});
 }));
}
