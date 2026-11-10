import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomInt, randomBytes, randomUUID, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fail, serial, dbTime, attendanceDay } from './events.js';
import { inspectImage } from './registration-photos.js';
import { profileAvailable } from './mobile-profile.js';
import { mountAdminPickupRoutes } from './admin-pickup.js';

const uuid=z.string().uuid();
const phone=z.string().trim().min(7).max(30).regex(/^\+?[0-9 ()-]+$/).refine(v=>{const n=v.replace(/\D/g,'').length;return n>=7&&n<=15;});
const personInput=z.object({childId:uuid,fullName:z.string().trim().min(2).max(150),address:z.string().trim().min(5).max(500),phone,relationship:z.string().trim().max(80).optional(),photoId:uuid}).strict();
const personFields={id:true,childId:true,fullName:true,address:true,phone:true,relationship:true,photoId:true,active:true,createdAt:true,updatedAt:true};
const requestFields={id:true,childId:true,centerId:true,personId:true,requestedById:true,photoId:true,snapshot:true,day:true,windowStart:true,windowEnd:true,expiresAt:true,status:true,attempts:true,codeIssues:true,verifiedAt:true,completedAt:true,reason:true,createdAt:true,
 child:{select:{id:true,name:true}},requestedBy:{select:{id:true,username:true}},reviewedBy:{select:{id:true,username:true}},verifiedBy:{select:{id:true,username:true}}};
const state=(r,now)=>r.status==='PENDING'&&+r.expiresAt<=+now?'EXPIRED':r.status;
const digest=value=>createHash('sha256').update(value).digest('hex');
const verifier=(id,code,salt)=>scryptSync(`${id}:${code}`,salt,32).toString('hex');
const matches=(a,b)=>typeof a==='string'&&a.length===64&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const issue=(id,old)=>{let code;do{code=String(randomInt(0,1000000)).padStart(6,'0');}while(old?.codeHash&&matches(old.codeHash,verifier(id,code,old.codeSalt)));const salt=randomBytes(32).toString('hex');return {code,codeSalt:salt,codeHash:verifier(id,code,salt)};};
const audit=(tx,user,id,action)=>tx.auditLog.create({data:{userId:user.id,resourceId:id,action}});
const reject=(status,code,message)=>({failure:{status,code,message}});
const clearCode={codeHash:null,codeSalt:null,handoverHash:null,handoverExpiresAt:null};
const scoped=user=>({centerId:user.centerId,child:{centerId:user.centerId,...(user.role==='PARENT'?{guardians:{some:{userId:user.id}}}:{})}});
export function pickupMessage(r,code){
 const time=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 return `ChildGuard Pickup Authorization\n\nYou have been selected to pick up ${r.snapshot.childName} from ${r.snapshot.centerName}.\n\nPickup Date/Time: ${time(r.windowStart)} – ${time(r.windowEnd)} (Sri Lanka)\nVerification Code: ${code}\n\nPlease bring identification and show this code to the Teacher when collecting the child.\n\nThis code is valid until ${time(r.expiresAt)} (Sri Lanka).\n\nDo not share this code with anyone else.`;
}
export function mountPickupRoutes(app,{db,asyncRoute,codeTtlMinutes=60}){
 const ttl=z.coerce.number().int().min(1).max(60).parse(codeTtlMinutes);
 const root='/api/v1/mobile';
 const mobile=(req,res,next)=>['PARENT','TEACHER'].includes(req.user?.role)&&req.authTransport==='legacy-mobile'?next():next(fail(403,'FORBIDDEN','Parent or Teacher account required'));
 async function child(tx,user,id){const c=await tx.child.findFirst({where:{id:uuid.parse(id),centerId:user.centerId,...(user.role==='PARENT'?{guardians:{some:{userId:user.id}}}:{})},select:{id:true,name:true,centerId:true}});if(!c)throw fail(404,'NOT_FOUND','Child not found');return c;}
 const role=(user,expected)=>{if(user.role!==expected)throw fail(403,'FORBIDDEN',`${expected==='PARENT'?'Parent':'Teacher'} action required`);};
 async function actor(tx,user){const u=await tx.user.findUnique({where:{id:user.id}});if(!u?.active||u.role!==user.role||u.centerId!==user.centerId)throw fail(401,'UNAUTHENTICATED','Sign in required');}
 async function locked(tx,user,id){await actor(tx,user);const c=await child(tx,user,id);await tx.$queryRaw`SELECT id FROM "Child" WHERE id=${c.id} FOR UPDATE`;return c;}
 async function ready(req,res,next){
  const missing=()=>fail(503,'PICKUP_NOT_INSTALLED','Approved pickup setup is pending');
  if(!db.pickupRequest||!db.authorizedPickupPerson||!db.pickupPhoto)return next(missing());
  try{const [r]=await db.$queryRaw`SELECT to_regclass('public."PickupRequest"') IS NOT NULL AND to_regclass('public."AuthorizedPickupPerson"') IS NOT NULL AND to_regclass('public."PickupPhoto"') IS NOT NULL AS installed`;next(r?.installed?undefined:missing());}
  catch{next(fail(503,'PICKUP_UNAVAILABLE','Pickup service is temporarily unavailable'));}
 }
 mountAdminPickupRoutes(app,{db,asyncRoute,ready});
 app.use(root+'/pickups',mobile,ready,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 // Contact reads do not depend on pickup deployment or public registration.
 app.get(root+'/children/:id/parent-contacts',mobile,asyncRoute(async(req,res)=>{
  role(req.user,'TEACHER');const c=await child(db,req.user,req.params.id);
  const profiles=await profileAvailable(db,false);
  const users=await db.user.findMany({where:{centerId:c.centerId,active:true,role:'PARENT',guardians:{some:{childId:c.id}}},select:{id:true,username:true,...(profiles?{profile:{select:{fullName:true,phone:true}}}:{})},orderBy:{username:'asc'},take:100});
  res.set('Cache-Control','no-store').json({data:users.map(u=>{const saved=phone.safeParse(u.profile?.phone);return {id:u.id,name:u.profile?.fullName||u.username,relationship:'Linked Parent/Guardian',phone:saved.success?saved.data:null,phoneSource:saved.success?'SAVED_PROFILE':'UNAVAILABLE'};})});
 }));
 const mutate=async(req,work)=>serial(db,async tx=>{await actor(tx,req.user);return work(tx);});
 const respond=(res,result,status=200)=>{if(result?.failure){const e=result.failure;throw fail(e.status,e.code,e.message);}res.status(status).json({data:result});};
 app.post(root+'/pickups/photos',asyncRoute((req,res,next)=>{role(req.user,'PARENT');return next();}),express.raw({type:['image/jpeg','image/png','image/webp'],limit:'2mb'}),asyncRoute(async(req,res)=>{
  const childId=uuid.parse(req.query.childId),mime=inspectImage(req.body);
  if(req.get('Content-Type')?.split(';')[0]!==mime)throw fail(422,'IMAGE_INVALID','Image type does not match its contents');
  const photo=await mutate(req,async tx=>{const c=await locked(tx,req.user,childId);const row=await tx.pickupPhoto.create({data:{childId:c.id,centerId:c.centerId,uploadedById:req.user.id,mime,bytes:req.body},select:{id:true}});await audit(tx,req.user,row.id,'PICKUP_PHOTO_UPLOADED');return row;});respond(res,photo,201);
 }));
 app.get(root+'/pickups/photos/:id',asyncRoute(async(req,res)=>{
  const p=await db.pickupPhoto.findFirst({where:{id:uuid.parse(req.params.id),...scoped(req.user)},select:{childId:true,mime:true,bytes:true}});if(!p)throw fail(404,'NOT_FOUND','Photo unavailable');await child(db,req.user,p.childId);
  res.set({'Content-Type':p.mime,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}).send(Buffer.from(p.bytes));
 }));
 app.get(root+'/pickups/people',asyncRoute(async(req,res)=>{role(req.user,'PARENT');const c=await child(db,req.user,req.query.childId);const rows=await db.authorizedPickupPerson.findMany({where:{childId:c.id,centerId:c.centerId},select:personFields,orderBy:{createdAt:'desc'},take:100});res.json({data:rows});}));
 async function savePerson(req,res,edit){
  role(req.user,'PARENT');const b=personInput.parse(req.body);
  const result=await mutate(req,async(tx)=>{const c=await locked(tx,req.user,b.childId),now=await dbTime(tx);const photo=await tx.pickupPhoto.findFirst({where:{id:b.photoId,childId:c.id,centerId:c.centerId},select:{id:true}});if(!photo)throw fail(422,'PHOTO_REQUIRED','Select an authorized photograph for this child');
   if(edit){const p=await tx.authorizedPickupPerson.findFirst({where:{id:uuid.parse(req.params.id),childId:c.id,centerId:c.centerId}});if(!p?.active)throw fail(404,'NOT_FOUND','Active pickup person not found');}
   const row=edit?await tx.authorizedPickupPerson.update({where:{id:req.params.id},data:{...b,updatedAt:now},select:personFields}):await tx.authorizedPickupPerson.create({data:{...b,centerId:c.centerId,createdById:req.user.id},select:personFields});
   await audit(tx,req.user,row.id,edit?'PICKUP_PERSON_UPDATED':'PICKUP_PERSON_CREATED');return row;
  });respond(res,result,edit?200:201);
 }
 app.post(root+'/pickups/people',asyncRoute((req,res)=>savePerson(req,res,false)));
 app.patch(root+'/pickups/people/:id',asyncRoute((req,res)=>savePerson(req,res,true)));
 app.post(root+'/pickups/people/:id/deactivate',asyncRoute(async(req,res)=>{
  role(req.user,'PARENT');const p=await db.authorizedPickupPerson.findFirst({where:{id:uuid.parse(req.params.id),...scoped(req.user)}});if(!p)throw fail(404,'NOT_FOUND','Pickup person not found');
  const result=await mutate(req,async(tx)=>{await locked(tx,req.user,p.childId);await tx.authorizedPickupPerson.update({where:{id:p.id},data:{active:false}});await tx.pickupRequest.updateMany({where:{personId:p.id,status:'PENDING'},data:{status:'CANCELLED',reason:'Pickup person deactivated',...clearCode}});await audit(tx,req.user,p.id,'PICKUP_PERSON_DEACTIVATED');return {id:p.id,active:false};});respond(res,result);
 }));
 app.get(root+'/pickups/requests',asyncRoute(async(req,res)=>{
  const q=z.object({childId:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(100),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
  if(q.childId)await child(db,req.user,q.childId);
  const now=await dbTime(db),rows=await db.pickupRequest.findMany({where:{...scoped(req.user),...(q.childId?{childId:q.childId}:{})},select:requestFields,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit,skip:q.offset});
  res.json({data:rows.map(r=>({...r,status:state(r,now)})),page:{limit:q.limit,offset:q.offset}});
 }));
 app.post(root+'/pickups/requests',asyncRoute(async(req,res)=>{
  role(req.user,'PARENT');const b=z.object({childId:uuid,personId:uuid}).strict().parse(req.body);
  const result=await mutate(req,async(tx)=>{
   const c=await locked(tx,req.user,b.childId),now=await dbTime(tx),day=attendanceDay(now);
   const p=await tx.authorizedPickupPerson.findFirst({where:{id:b.personId,childId:c.id,centerId:c.centerId,active:true}});if(!p)throw fail(422,'PERSON_UNAVAILABLE','Choose an active pickup person for this child');
   await tx.pickupRequest.updateMany({where:{childId:c.id,status:'PENDING',expiresAt:{lte:now}},data:{status:'EXPIRED',...clearCode}});
   const current=await tx.pickupRequest.findFirst({where:{childId:c.id,day,status:{in:['PENDING','COMPLETED']}}});if(current)throw fail(409,'PICKUP_EXISTS','This child already has a pending or completed pickup today');
   const center=await tx.center.findUnique({where:{id:c.centerId},select:{name:true}}),id=randomUUID(),issued=issue(id);
   const end=new Date(Math.min(+now+3600000,+new Date(`${day}T00:00:00+05:30`)+86400000));
   const expiresAt=new Date(Math.min(+end,+now+ttl*60000));
   const row=await tx.pickupRequest.create({data:{id,childId:c.id,centerId:c.centerId,personId:p.id,requestedById:req.user.id,photoId:p.photoId,day,windowStart:now,windowEnd:end,expiresAt,codeHash:issued.codeHash,codeSalt:issued.codeSalt,snapshot:{fullName:p.fullName,address:p.address,phone:p.phone,relationship:p.relationship??null,childName:c.name,centerName:center.name}},select:requestFields});
   await audit(tx,req.user,id,'PICKUP_REQUEST_CREATED');return {request:row,code:issued.code,message:pickupMessage(row,issued.code)};
  });respond(res,result,201);
 }));
 app.get(root+'/pickups/requests/:id',asyncRoute(async(req,res)=>{
  const r=await db.pickupRequest.findFirst({where:{id:uuid.parse(req.params.id),...scoped(req.user)},select:requestFields});
  if(!r)throw fail(404,'NOT_FOUND','Pickup request not found');await child(db,req.user,r.childId);
  res.json({data:{...r,status:state(r,await dbTime(db))}});
 }));
 // Bounded per account across requests, and persisted per code/request below.
 const attemptsLimit=rateLimit({windowMs:60000,limit:15,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'PICKUP_RATE_LIMIT',message:'Wait before trying again'}}});
 app.post(root+'/pickups/requests/:id/:action',attemptsLimit,asyncRoute(async(req,res)=>{
  const action=z.enum(['cancel','reject','regenerate','verify','complete']).parse(req.params.action),id=uuid.parse(req.params.id);
  const b=(action==='verify'?z.object({code:z.string().regex(/^\d{6}$/)}).strict():action==='complete'?z.object({handoverToken:z.string().min(32).max(128),identityChecked:z.literal(true),physicalHandover:z.literal(true)}).strict():action==='reject'?z.object({reason:z.string().trim().min(3).max(300)}).strict():z.object({}).strict()).parse(req.body);
  role(req.user,['verify','complete','reject'].includes(action)?'TEACHER':'PARENT');
  const result=await mutate(req,async(tx)=>{
   const found=await tx.pickupRequest.findFirst({where:{id,...scoped(req.user)}});if(!found)throw fail(404,'NOT_FOUND','Pickup request not found');
   await locked(tx,req.user,found.childId);const r=await tx.pickupRequest.findUnique({where:{id}});
   // A lock wait must not keep an already expired code/proof eligible.
   const now=await dbTime(tx);
   if(req.user.role==='PARENT'&&r.requestedById!==req.user.id)throw fail(403,'FORBIDDEN','Only the requesting Parent can change this request');
   if(state(r,now)!=='PENDING'){
    if(r.status==='PENDING'){await tx.pickupRequest.update({where:{id},data:{status:'EXPIRED',...clearCode}});await audit(tx,req.user,id,'PICKUP_EXPIRED');}
    return reject(409,'PICKUP_NOT_PENDING','This request is expired or already handled');
   }
   if(['verify','complete'].includes(action)){
    const attendance=await tx.attendance.findUnique({where:{childId_day:{childId:r.childId,day:attendanceDay(now)}}});
    const confirmation=attendance?await tx.confirmation.findUnique({where:{attendanceId:attendance.id}}):null;
    const person=await tx.authorizedPickupPerson.findUnique({where:{id:r.personId}});
    if(r.day!==attendanceDay(now)||+r.windowStart>+now||!person?.active||attendance?.status!=='PRESENT'||!confirmation)throw fail(409,'PICKUP_NOT_ELIGIBLE','Current trusted confirmed PRESENT attendance and an active pickup person are required');
    // Guardian authority must still exist when the Teacher releases the child.
    const parent=await tx.user.findFirst({where:{id:r.requestedById,role:'PARENT',active:true,centerId:r.centerId,guardians:{some:{childId:r.childId}}}});
    if(!parent)throw fail(409,'PICKUP_AUTHORITY_REMOVED','Requesting Guardian is no longer authorized');
   }
   if(action==='verify'){
    if(!r.codeHash||r.verifiedAt||r.attempts>=5)throw fail(409,'PICKUP_CODE_LOCKED','Code is consumed or locked; the Parent must regenerate or replace the request');
    const valid=matches(r.codeHash,verifier(id,b.code,r.codeSalt));
    await tx.pickupRequest.update({where:{id},data:{attempts:{increment:1}}});
    await audit(tx,req.user,id,valid?'PICKUP_CODE_VERIFIED':'PICKUP_CODE_REJECTED');
    if(!valid)return reject(422,'PICKUP_CODE_INVALID','Code not accepted');
    const token=randomBytes(32).toString('hex');
    await tx.pickupRequest.update({where:{id},data:{verifiedById:req.user.id,verifiedAt:now,handoverHash:digest(token),handoverExpiresAt:new Date(Math.min(+r.expiresAt,+now+300000))}});
    return {id,handoverToken:token,expiresAt:new Date(Math.min(+r.expiresAt,+now+300000))};
   }
   if(action==='regenerate'){
    if(r.codeIssues>=3)throw fail(409,'PICKUP_REISSUE_LIMIT','Reissue limit reached. Cancel this request before creating another');
    // Do not reset the persistent attempt budget by reissuing a code.
    if(r.attempts>=5)throw fail(409,'PICKUP_CODE_LOCKED','Attempt limit reached. Cancel this request before creating another');
    const issued=issue(id,r),expiresAt=new Date(Math.min(+r.windowEnd,+now+ttl*60000));
    const row=await tx.pickupRequest.update({where:{id},data:{...clearCode,codeHash:issued.codeHash,codeSalt:issued.codeSalt,codeIssues:{increment:1},verifiedAt:null,verifiedById:null,expiresAt},select:requestFields});await audit(tx,req.user,id,'PICKUP_CODE_REISSUED');
    return {request:row,code:issued.code,message:pickupMessage(row,issued.code)};
   }
   if(action==='complete'&&(r.verifiedById!==req.user.id||!r.handoverHash||!r.handoverExpiresAt||+r.handoverExpiresAt<=+now||!matches(r.handoverHash,digest(b.handoverToken))))throw fail(409,'PICKUP_VERIFICATION_REQUIRED','Verify the code again before confirming handover');
   const status={complete:'COMPLETED',cancel:'CANCELLED',reject:'REJECTED'}[action];
   const row=await tx.pickupRequest.update({where:{id},data:{status,...clearCode,reviewedById:req.user.id,...(action==='complete'?{completedAt:now}:{reason:action==='reject'?b.reason:'Cancelled by requesting Parent'})},select:requestFields});
   await audit(tx,req.user,id,`PICKUP_${status}`);return row;
  });respond(res,result);
 }));
}
