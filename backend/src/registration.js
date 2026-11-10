import bcrypt from 'bcryptjs';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { fail, serial } from './events.js';
import { mountPhotoRoutes, mountApplicantPhotoRoutes } from './registration-photos.js';
import { mountChildRoutes, duplicateChildWhere } from './children.js';

export const credentialHash = value => createHash('sha256').update(value).digest('hex');
const secret = z.string().regex(/^[a-f0-9]{64}$/);
const password = z.string().min(12).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72);
const phone = z.string().trim().min(7).max(30).regex(/^[+0-9 ()-]+$/).refine(value=>{const digits=value.replace(/\D/g,'');return digits.length>=7&&digits.length<=15;});
const name = z.string().trim().min(2).max(150);
export const profileDetailsSchema = z.object({fullName:name,email:z.string().trim().toLowerCase().email().max(254),phone}).strict();
const wearable = z.object({hardwareId:z.string().trim().min(1).max(100),claimCode:secret}).strict();
export const enrollmentSchema = z.object({existingChildId:z.string().uuid().optional(),fullName:name.optional(),dateOfBirth:z.string().date().refine(value=>value<=new Date().toISOString().slice(0,10)).optional(),groupName:z.string().trim().max(80).optional(),relationship:z.string().trim().min(2).max(80),wearable:wearable.optional()}).strict().superRefine((v,c)=>{
 if(v.existingChildId ? v.fullName!==undefined||v.dateOfBirth!==undefined : !v.fullName||!v.dateOfBirth)c.addIssue({code:'custom',message:'Use either an existing child reference or new child name and birth date'});
});
export const registrationSchema = z.object({fullName:name,username:z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9._@+-]+$/),email:z.string().trim().toLowerCase().email().max(254),phone,password,role:z.enum(['PARENT','TEACHER']),centerCode:secret.optional(),centerId:z.string().uuid().optional(),acceptTerms:z.literal(true),children:z.array(enrollmentSchema).max(10).default([])}).strict().superRefine((v,c)=>{
 if(Boolean(v.centerId)===Boolean(v.centerCode))c.addIssue({code:'custom',path:['centerId'],message:'Select a center or provide a legacy invitation, not both'});
 if(v.role==='TEACHER'&&v.children.length)c.addIssue({code:'custom',message:'Teacher applications cannot request Guardian relationships'});
 if(v.role==='PARENT'&&!v.children.length)c.addIssue({code:'custom',message:'Parent application requires a child request'});
 const ids=v.children.map(child=>child.existingChildId).filter(Boolean);
 if(new Set(ids).size!==ids.length)c.addIssue({code:'custom',message:'Duplicate child references'});
});
const uuid = z.string().uuid();
const decision = z.object({status:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(3).max(500).optional(),existingChildId:uuid.optional()}).strict().superRefine((v,c)=>{if(v.status==='REJECTED'&&!v.reason)c.addIssue({code:'custom',message:'Rejection reason required'});});
const audit = (tx,actor,resourceId,action)=>tx.auditLog.create({data:{userId:actor.id,resourceId,action}});
const cleanWearable = r => r&&({id:r.id,hardwareId:r.hardwareId,status:r.status,reason:r.reason,childId:r.childId});
const cleanChild = r => ({id:r.id,existingChildId:r.existingChildId,fullName:r.fullName,dateOfBirth:r.dateOfBirth,groupName:r.groupName,relationship:r.relationship,status:r.status,reason:r.reason,childId:r.childId,wearable:cleanWearable(r.wearable)});
const clean = r => ({id:r.id,fullName:r.fullName,username:r.username,email:r.email,phone:r.phone,role:r.role,centerId:r.centerId,centerName:r.center?.name??null,status:r.status,reason:r.reason,createdAt:r.createdAt,reviewedAt:r.reviewedAt,photoId:r.photo?.id??null,photoUpdatedAt:r.photo?.createdAt??null,children:r.children?.map(cleanChild)??[],decisions:r.decisions??[]});
const include = {center:{select:{name:true}},children:{include:{wearable:true}},photo:{select:{id:true,createdAt:true}},decisions:{orderBy:{createdAt:'asc'},select:{status:true,reason:true,createdAt:true,reviewerId:true}}};
const limit = (maximum=10) => rateLimit({windowMs:60000,limit:maximum,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Please try again later'}}});
const enabledOnly = enabled => (req,res,next)=>{res.set('Cache-Control','no-store');return enabled?next():next(fail(503,'REGISTRATION_UNAVAILABLE','Registration requires an approved database migration and server configuration'));};
export async function applicant(db, req) {
 const receipt = secret.safeParse(req.get('X-Registration-Receipt'));
 if(!receipt.success)throw fail(401,'UNAUTHENTICATED','Registration receipt required');
 const row=await db.registrationApplication.findUnique({where:{receiptHash:credentialHash(receipt.data)},include});
 if(!row)throw fail(401,'UNAUTHENTICATED','Registration receipt required');
 return row;
}
function childData(child, centerId) {
 const {wearable:requested,dateOfBirth,...data}=child;
 return {...data,centerId,...(dateOfBirth?{dateOfBirth:new Date(`${dateOfBirth}T00:00:00Z`)}:{}),...(requested?{wearable:{create:{centerId,hardwareId:requested.hardwareId,claimHash:credentialHash(requested.claimCode)}}}:{})};
}
export function mountRegistrationPublic(app,{db,asyncRoute,enabled,publicCenterIds=[],mediaRoot}) {
 const eligibleIds=new Set(publicCenterIds);
 async function registrationCenter(tx,body) {
  if(body.centerId) {
   if(!eligibleIds.has(body.centerId))throw fail(422,'CENTER_UNAVAILABLE','Select an available center');
   const center=await tx.center.findUnique({where:{id:body.centerId},select:{id:true}});
   if(!center)throw fail(422,'CENTER_UNAVAILABLE','Select an available center');
   return center.id;
  }
  const invite=await tx.centerInvitation.findUnique({where:{codeHash:credentialHash(body.centerCode)}});
  if(!invite||invite.expiresAt<=new Date())throw fail(422,'REGISTRATION_INVALID','Registration details could not be accepted');
  return invite.centerId;
 }
 app.get('/api/v1/registration/availability',(req,res)=>{res.set('Cache-Control','no-store');res.json({data:{enabled:enabled===true}});});
 app.use('/api/v1/registration',enabledOnly(enabled),limit(60),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/v1/registration/centers',asyncRoute(async(req,res)=>{
  const rows=eligibleIds.size?await db.center.findMany({where:{id:{in:[...eligibleIds]}},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}]}):[];
  res.json({data:rows.map(({id,name})=>({id,name}))});
 }));
 app.post('/api/v1/registration',limit(),asyncRoute(async(req,res)=>{
  const body=registrationSchema.parse(req.body),receipt=secret.parse(req.get('X-Registration-Receipt'));
  const receiptHash=credentialHash(receipt),payloadHash=createHmac('sha256',receipt).update(JSON.stringify(body)).digest('hex');
  const hash=await bcrypt.hash(body.password,12);
  try {
   const result=await serial(db,async tx=>{
    const previous=await tx.registrationApplication.findUnique({where:{receiptHash},include});
    if(previous){if(previous.payloadHash!==payloadHash)throw fail(409,'RECEIPT_REUSED','Use the status or resubmission workflow');return previous;}
    const centerId=await registrationCenter(tx,body);
    if(await tx.user.findUnique({where:{username:body.username}})||await tx.userProfile.findUnique({where:{email:body.email}}))throw fail(409,'REGISTRATION_CONFLICT','Registration details are unavailable');
    return tx.registrationApplication.create({data:{receiptHash,payloadHash,username:body.username,email:body.email,fullName:body.fullName,phone:body.phone,passwordHash:hash,role:body.role,centerId,termsVersion:'2026-10',children:{create:body.children.map(c=>childData(c,centerId))}},include});
   });
   res.status(201).json({data:clean(result)});
  }catch(e){if(e.code==='P2002')throw fail(409,'REGISTRATION_CONFLICT','Registration details are unavailable');throw e;}
 }));
 app.get('/api/v1/registration/status',asyncRoute(async(req,res)=>res.json({data:clean(await applicant(db,req))})));
 app.post('/api/v1/registration/resubmit',limit(),asyncRoute(async(req,res)=>{
  const current=await applicant(db,req);
  const body=registrationSchema.parse(req.body);
  if(body.username!==current.username||body.email!==current.email||body.role!==current.role)throw fail(422,'IDENTITY_CHANGED','Keep the original username, email and role');
  const hash=await bcrypt.hash(body.password,12);
  const row=await serial(db,async tx=>{
   const locked=await tx.registrationApplication.findUnique({where:{id:current.id}});
   if(locked.status!=='REJECTED')throw fail(409,'INVALID_STATE','Only rejected applications can be resubmitted');
   const centerId=await registrationCenter(tx,body);
   if(centerId!==current.centerId)throw fail(422,'CENTER_UNAVAILABLE','Select the original center');
   // Rejected requests have never created relationships. Remove only their pending request rows.
   await tx.wearableRequest.deleteMany({where:{enrollment:{applicationId:current.id}}});
   await tx.enrollmentRequest.deleteMany({where:{applicationId:current.id}});
   return tx.registrationApplication.update({where:{id:current.id},data:{status:'PENDING',fullName:body.fullName,phone:body.phone,passwordHash:hash,reason:null,reviewerId:null,reviewedAt:null,children:{create:body.children.map(c=>childData(c,current.centerId))}},include});
  });
  res.json({data:clean(row)});
 }));
 mountApplicantPhotoRoutes(app,{db,asyncRoute,applicant,mediaRoot});
}

export function mountRegistrationPrivate(app,{db,asyncRoute,enabled,mediaRoot}) {
 mountChildRoutes(app,{db,asyncRoute});
 const gate=enabledOnly(enabled);
 const admin=(req,res,next)=>req.user.role==='ADMIN'?next():next(fail(403,'FORBIDDEN','Administrator required'));
 app.use('/api/v1/admin/registrations',gate,admin);
 app.use('/api/v1/admin/enrollments',gate,admin);
 app.use('/api/v1/admin/wearable-requests',gate,admin);
 app.post('/api/v1/admin/center-invitations',gate,admin,limit(),asyncRoute(async(req,res)=>{
  z.object({}).strict().parse(req.body);
  const code=randomBytes(32).toString('hex');
  const row=await serial(db,async tx=>{const row=await tx.centerInvitation.create({data:{centerId:req.user.centerId,codeHash:credentialHash(code),expiresAt:new Date(Date.now()+7*86400000)}});await audit(tx,req.user,row.id,'CENTER_INVITATION_CREATED');return row;});
  res.status(201).json({data:{code,expiresAt:row.expiresAt}});
 }));
 app.get('/api/v1/admin/registrations',asyncRoute(async(req,res)=>{
  const q=z.object({status:z.enum(['PENDING','APPROVED','REJECTED']).optional(),role:z.enum(['PARENT','TEACHER']).optional(),search:z.string().max(100).optional(),from:z.string().date().optional(),to:z.string().date().optional(),limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0)}).strict().parse(req.query);
  const rows=await db.registrationApplication.findMany({where:{centerId:req.user.centerId,status:q.status,role:q.role,...(q.from||q.to?{createdAt:{...(q.from?{gte:new Date(q.from)}:{}),...(q.to?{lt:new Date(new Date(q.to).getTime()+86400000)}:{})}}:{}),...(q.search?{OR:[{fullName:{contains:q.search,mode:'insensitive'}},{username:{contains:q.search,mode:'insensitive'}}]}:{})},include,orderBy:{createdAt:'desc'},take:q.limit,skip:q.offset});
  res.json({data:rows.map(clean),page:{limit:q.limit,offset:q.offset}});
 }));
 app.get('/api/v1/admin/registrations/:id',asyncRoute(async(req,res)=>{
  const row=await db.registrationApplication.findFirst({where:{id:uuid.parse(req.params.id),centerId:req.user.centerId},include});
  if(!row)throw fail(404,'NOT_FOUND','Application not found');res.json({data:clean(row)});
 }));
 app.post('/api/v1/admin/registrations/:id/decision',asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=decision.parse(req.body);
  const result=await serial(db,async tx=>{
   const row=await tx.registrationApplication.findFirst({where:{id,centerId:req.user.centerId}});
   if(!row)throw fail(404,'NOT_FOUND','Application not found');
   if(row.status!=='PENDING')throw fail(409,'INVALID_STATE','Application has already been reviewed');
   if(row.userId===req.user.id)throw fail(403,'FORBIDDEN','Self-approval is forbidden');
   let userId;
   if(body.status==='APPROVED'){
    if(!row.passwordHash)throw fail(409,'INVALID_STATE','Application requires resubmission');
    if(await tx.user.findUnique({where:{username:row.username}})||await tx.userProfile.findUnique({where:{email:row.email}}))throw fail(409,'REGISTRATION_CONFLICT','Identity is unavailable');
    const user=await tx.user.create({data:{username:row.username,passwordHash:row.passwordHash,role:row.role,centerId:row.centerId,active:true}});userId=user.id;
    await tx.userProfile.create({data:{userId,fullName:row.fullName,email:row.email,phone:row.phone}});
    await tx.privatePhoto.updateMany({where:{applicationId:id},data:{userId}});
   }
   await tx.registrationDecision.create({data:{applicationId:id,status:body.status,reviewerId:req.user.id,reason:body.reason}});
   await audit(tx,req.user,id,`REGISTRATION_${body.status}`);
   return tx.registrationApplication.update({where:{id},data:{status:body.status,reason:body.reason??null,reviewerId:req.user.id,reviewedAt:new Date(),...(userId?{userId,passwordHash:null}:{})},include});
  });res.json({data:clean(result)});
 }));
 app.get('/api/v1/admin/enrollments',asyncRoute(async(req,res)=>{
  const rows=await db.enrollmentRequest.findMany({where:{centerId:req.user.centerId},include:{wearable:true},orderBy:{createdAt:'desc'},take:100});
  const data=[];
  for(const row of rows){const candidates=!row.existingChildId&&row.fullName?await db.child.findMany({where:{centerId:req.user.centerId,name:{equals:row.fullName,mode:'insensitive'},OR:[{dateOfBirth:row.dateOfBirth},{dateOfBirth:null}]},select:{id:true,name:true,dateOfBirth:true},take:5}):[];data.push({...cleanChild(row),duplicateCandidates:candidates});}
  res.json({data});
 }));
 app.post('/api/v1/admin/enrollments/:id/decision',asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=decision.parse(req.body);
  const row=await serial(db,async tx=>{
   const r=await tx.enrollmentRequest.findFirst({where:{id,centerId:req.user.centerId},include:{application:true}});
   if(!r)throw fail(404,'NOT_FOUND','Request not found');if(r.status!=='PENDING')throw fail(409,'INVALID_STATE','Request already reviewed');
   const userId=r.userId??r.application?.userId;
   let childId;
   if(body.status==='APPROVED'){
    const parent=await tx.user.findFirst({where:{id:userId??'',role:'PARENT',active:true,centerId:req.user.centerId}});
    if(!parent)throw fail(409,'ACCOUNT_PENDING','Approve the Parent account first');
    childId=r.existingChildId??body.existingChildId;
    if(childId){if(!await tx.child.findFirst({where:{id:childId,centerId:req.user.centerId}}))throw fail(404,'NOT_FOUND','Child unavailable');}
    else {
     const matches=await tx.child.count({where:duplicateChildWhere(req.user.centerId,r.fullName,r.dateOfBirth)});
     if(matches)throw fail(409,'DUPLICATE_REVIEW','Review the existing child and select its approved reference');
     childId=(await tx.child.create({data:{name:r.fullName,dateOfBirth:r.dateOfBirth,groupName:r.groupName,centerId:req.user.centerId}})).id;
    }
    await tx.guardian.upsert({where:{userId_childId:{userId,childId}},create:{userId,childId},update:{}});
    await audit(tx,req.user,childId,`GUARDIAN_LINK_CREATED:${userId}`);
   }
   await audit(tx,req.user,id,`ENROLLMENT_${body.status}`);
   return tx.enrollmentRequest.update({where:{id},data:{status:body.status,childId,userId,reviewerId:req.user.id,reviewedAt:new Date(),reason:body.reason},include:{wearable:true}});
  });res.json({data:cleanChild(row)});
 }));
 app.post('/api/v1/admin/devices/:id/claim-code',gate,admin,limit(),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id);z.object({}).strict().parse(req.body);const code=randomBytes(32).toString('hex');
  const row=await serial(db,async tx=>{
   const device=await tx.device.findFirst({where:{id,centerId:req.user.centerId,active:true}});
   if(!device)throw fail(404,'NOT_FOUND','Device unavailable');
   if(await tx.assignment.count({where:{deviceId:id,endedAt:null}}))throw fail(409,'ASSIGNED','Device already assigned; transfer requires separate review');
   const row=await tx.deviceClaimCode.create({data:{deviceId:id,codeHash:credentialHash(code),expiresAt:new Date(Date.now()+86400000)}});
   await audit(tx,req.user,id,'DEVICE_CLAIM_CODE_CREATED');return row;
  });res.status(201).json({data:{code,expiresAt:row.expiresAt}});
 }));
 app.get('/api/v1/admin/wearable-requests',asyncRoute(async(req,res)=>{
  const rows=await db.wearableRequest.findMany({where:{centerId:req.user.centerId},include:{enrollment:true},take:100,orderBy:{createdAt:'desc'}});
  const data=[];
  for(const row of rows){const device=await db.device.findFirst({where:{hardwareId:row.hardwareId,centerId:req.user.centerId},select:{id:true,hardwareId:true,active:true,assignments:{where:{endedAt:null},select:{childId:true,startedAt:true}}}});const code=await db.deviceClaimCode.findUnique({where:{codeHash:row.claimHash}});data.push({...cleanWearable(row),device,claimVerified:!!(device?.active&&code?.deviceId===device.id&&!code.consumedAt&&code.expiresAt>new Date()),enrollmentId:row.enrollmentId});}
  res.json({data});
 }));
 app.post('/api/v1/admin/wearable-requests/:id/decision',asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=decision.parse(req.body);
  const row=await serial(db,async tx=>{
   const r=await tx.wearableRequest.findFirst({where:{id,centerId:req.user.centerId},include:{enrollment:true}});
   if(!r)throw fail(404,'NOT_FOUND','Request not found');if(r.status!=='PENDING')throw fail(409,'INVALID_STATE','Request already reviewed');
   let childId=r.childId,userId=r.userId;
   if(body.status==='APPROVED'){
    childId??=r.enrollment?.status==='APPROVED'?r.enrollment.childId:null;userId??=r.enrollment?.userId;
    if(!childId||!userId||!await tx.child.findFirst({where:{id:childId,centerId:req.user.centerId,guardians:{some:{userId}}}}))throw fail(409,'RELATIONSHIP_PENDING','Approve the Guardian relationship first');
    if(!await tx.user.findFirst({where:{id:userId,role:'PARENT',active:true,centerId:req.user.centerId}}))throw fail(409,'ACCOUNT_UNAVAILABLE','An active authorized Parent is required');
    const device=await tx.device.findFirst({where:{hardwareId:r.hardwareId,centerId:req.user.centerId,active:true}});
    const code=await tx.deviceClaimCode.findUnique({where:{codeHash:r.claimHash}});
    if(!device||!code||code.deviceId!==device.id||code.consumedAt||code.expiresAt<=new Date())throw fail(409,'CLAIM_INVALID','Device claim is unavailable or expired');
    // Serializable checks plus existing partial unique indexes prevent concurrent assignments.
    if(await tx.assignment.count({where:{endedAt:null,OR:[{deviceId:device.id},{childId}]}}))throw fail(409,'ASSIGNMENT_CONFLICT','Device or child already has an active assignment');
    await tx.assignment.create({data:{deviceId:device.id,childId}});
    await tx.deviceClaimCode.update({where:{id:code.id},data:{consumedAt:new Date()}});
    await audit(tx,req.user,device.id,`WEARABLE_ASSIGNED:${childId}`);
   }
   await audit(tx,req.user,id,`WEARABLE_REQUEST_${body.status}`);
   return tx.wearableRequest.update({where:{id},data:{status:body.status,childId,userId,reviewerId:req.user.id,reviewedAt:new Date(),reason:body.reason}});
  });res.json({data:cleanWearable(row)});
 }));
 app.use('/api/v1/account',gate,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/v1/account/profile',asyncRoute(async(req,res)=>{
  const profile=await db.userProfile.findUnique({where:{userId:req.user.id},include:{photo:{select:{id:true,createdAt:true}}}});res.json({data:{id:req.user.id,username:req.user.username,role:req.user.role,centerId:req.user.centerId,profile}});
 }));
 app.patch('/api/v1/account/profile',asyncRoute(async(req,res)=>{
  const body=profileDetailsSchema.extend({emergencyContacts:z.array(z.object({name,phone,relationship:z.string().min(2).max(80)}).strict()).max(5).default([])}).parse(req.body);
  const profile=await serial(db,async tx=>{const app=await tx.registrationApplication.findUnique({where:{email:body.email}});if(app&&app.userId!==req.user.id)throw fail(409,'PROFILE_CONFLICT','Profile details unavailable');const r=await tx.userProfile.upsert({where:{userId:req.user.id},create:{userId:req.user.id,...body},update:body});await audit(tx,req.user,req.user.id,'PROFILE_UPDATED');return r;});res.json({data:profile});
 }));
 app.post('/api/v1/account/password',limit(),asyncRoute(async(req,res)=>{
  const body=z.object({currentPassword:z.string().max(200),newPassword:password}).strict().parse(req.body);
  const hash=await bcrypt.hash(body.newPassword,12);
  await serial(db,async tx=>{const current=await tx.user.findUnique({where:{id:req.user.id}});if(!await bcrypt.compare(body.currentPassword,current.passwordHash))throw fail(422,'INVALID_CURRENT_PASSWORD','Current password is incorrect');await tx.user.update({where:{id:req.user.id},data:{passwordHash:hash}});await audit(tx,req.user,req.user.id,'PASSWORD_CHANGED');});
  res.json({data:{changed:true}});
 }));
 const parent=(req,res,next)=>req.user.role==='PARENT'?next():next(fail(403,'FORBIDDEN','Parent required'));
 app.get('/api/v1/account/requests',parent,asyncRoute(async(req,res)=>{
  const children=await db.enrollmentRequest.findMany({where:{OR:[{userId:req.user.id},{application:{userId:req.user.id}}]},include:{wearable:true}});
  const devices=await db.wearableRequest.findMany({where:{userId:req.user.id}});res.json({data:{children:children.map(cleanChild),wearables:devices.map(cleanWearable)}});
 }));
 app.post('/api/v1/account/children',parent,limit(),asyncRoute(async(req,res)=>{
  const body=enrollmentSchema.parse(req.body);
  const row=await serial(db,async tx=>{
   if(body.existingChildId&&await tx.enrollmentRequest.findFirst({where:{userId:req.user.id,existingChildId:body.existingChildId,status:'PENDING'}}))throw fail(409,'REQUEST_EXISTS','A child request is already awaiting review');
   const result=await tx.enrollmentRequest.create({data:{userId:req.user.id,...childData(body,req.user.centerId)},include:{wearable:true}});await audit(tx,req.user,result.id,'ENROLLMENT_REQUESTED');return result;
  });res.status(201).json({data:cleanChild(row)});
 }));
 app.post('/api/v1/account/wearables',parent,limit(),asyncRoute(async(req,res)=>{
  const body=wearable.extend({childId:uuid}).parse(req.body);
  if(!await db.child.findFirst({where:{id:body.childId,centerId:req.user.centerId,guardians:{some:{userId:req.user.id}}}}))throw fail(404,'NOT_FOUND','Child unavailable');
  const row=await serial(db,async tx=>{
   if(await tx.wearableRequest.findFirst({where:{userId:req.user.id,childId:body.childId,hardwareId:body.hardwareId,status:'PENDING'}}))throw fail(409,'REQUEST_EXISTS','A wearable request is already awaiting review');
   const result=await tx.wearableRequest.create({data:{userId:req.user.id,centerId:req.user.centerId,childId:body.childId,hardwareId:body.hardwareId,claimHash:credentialHash(body.claimCode)}});await audit(tx,req.user,result.id,'WEARABLE_REQUESTED');return result;
  });res.status(201).json({data:cleanWearable(row)});
 }));
 app.get('/api/v1/admin/management',admin,asyncRoute(async(req,res)=>{
  const users=await db.user.findMany({where:{centerId:req.user.centerId,role:{in:['PARENT','TEACHER']}},select:{id:true,username:true,role:true,active:true,...(enabled?{profile:{include:{photo:{select:{id:true,createdAt:true}}}}}:{}),guardians:{select:{childId:true}}},orderBy:{username:'asc'},take:100});
  const children=await db.child.findMany({where:{centerId:req.user.centerId},select:{id:true,name:true,...(enabled?{dateOfBirth:true,groupName:true}:{}),guardians:{select:{userId:true}},assignments:{where:{endedAt:null},select:{device:{select:{id:true,hardwareId:true}}}}},take:100});
  const devices=await db.device.findMany({where:{centerId:req.user.centerId},select:{id:true,hardwareId:true,active:true,assignments:{select:{id:true,childId:true,startedAt:true,endedAt:true}}},take:100});
  const audits=await db.auditLog.findMany({where:{user:{centerId:req.user.centerId}},select:{id:true,action:true,resourceId:true,createdAt:true},orderBy:{createdAt:'desc'},take:100});
  res.json({data:{users,children,devices,audits}});
 }));
 // Account status uses the existing User model, independently of public signup.
 app.patch('/api/v1/admin/users/:id/status',admin,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),{active}=z.object({active:z.boolean()}).strict().parse(req.body);
  const row=await serial(db,async tx=>{const user=await tx.user.findFirst({where:{id,centerId:req.user.centerId,role:{in:['PARENT','TEACHER']}}});if(!user)throw fail(404,'NOT_FOUND','Managed account unavailable');const result=await tx.user.update({where:{id},data:{active},select:{id:true,role:true,active:true}});await audit(tx,req.user,id,active?'ACCOUNT_ACTIVATED':'ACCOUNT_SUSPENDED');return result;});
  res.json({data:row});
 }));
 app.patch('/api/v1/admin/users/:id/role',gate,admin,asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),body=z.object({role:z.enum(['PARENT','TEACHER']),roleChangeAcknowledged:z.literal(true)}).strict().parse(req.body);
  const row=await serial(db,async tx=>{
   if(!await tx.user.findFirst({where:{id,centerId:req.user.centerId,role:{in:['PARENT','TEACHER']}}}))throw fail(404,'NOT_FOUND','Managed account unavailable');
   if(body.role==='PARENT'&&!await tx.guardian.count({where:{userId:id}}))throw fail(409,'RELATIONSHIP_REQUIRED','Parent role requires a previously approved Guardian relationship');
   const result=await tx.user.update({where:{id},data:{role:body.role},select:{id:true,role:true}});await audit(tx,req.user,id,`ACCOUNT_ROLE_CHANGED_${body.role}`);return result;
  });res.json({data:row});
 }));
 mountPhotoRoutes(app,{db,asyncRoute,enabled,mediaRoot});
}
