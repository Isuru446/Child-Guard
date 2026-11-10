import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { fail, serial } from './events.js';
import { profileDetailsSchema } from './registration.js';
const phone=z.string().trim().min(7).max(30).regex(/^[+0-9 ()-]+$/).refine(v=>v.replace(/\D/g,'').length>=7&&v.replace(/\D/g,'').length<=15);
const schema=profileDetailsSchema.extend({emergencyContacts:z.array(z.object({name:z.string().trim().min(2).max(150),phone,relationship:z.string().trim().min(2).max(80)}).strict()).max(5).default([])}).strict();
export async function profileAvailable(db,enabled){
 if(enabled)return true;
 const [row]=await db.$queryRaw`SELECT to_regclass('public."UserProfile"') IS NOT NULL AS available`;
 return row?.available===true;
}
export function mountMobileProfile(app,{db,asyncRoute,registrationEnabled}){
 app.post('/api/v1/mobile/password',asyncRoute(async(req,res)=>{
  if(!['PARENT','TEACHER'].includes(req.user.role))throw fail(403,'FORBIDDEN','Mobile account required');
  const body=z.object({currentPassword:z.string().min(1).max(200),newPassword:z.string().min(12).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72)}).strict().parse(req.body);
  const hash=await bcrypt.hash(body.newPassword,12);
  await serial(db,async tx=>{
   const user=await tx.user.findUnique({where:{id:req.user.id}});
   if(!user?.active||user.role!==req.user.role||user.centerId!==req.user.centerId)throw fail(401,'UNAUTHENTICATED','Sign in required');
   if(!await bcrypt.compare(body.currentPassword,user.passwordHash))throw fail(422,'INVALID_CURRENT_PASSWORD','Current password is incorrect');
   await tx.user.update({where:{id:user.id},data:{passwordHash:hash}});
   await tx.auditLog.create({data:{userId:user.id,resourceId:user.id,action:'PASSWORD_CHANGED'}});
  });res.json({data:{changed:true}});
 }));
 app.patch('/api/v1/mobile/profile',asyncRoute(async(req,res)=>{
  if(!['PARENT','TEACHER'].includes(req.user.role))throw fail(403,'FORBIDDEN','Mobile account required');
  if(!await profileAvailable(db,registrationEnabled))throw fail(503,'PROFILE_UNAVAILABLE','Profile storage is unavailable; contact your administrator');
  const body=schema.parse(req.body);
  try{
   const profile=await serial(db,async tx=>{
    const user=await tx.user.findUnique({where:{id:req.user.id}});
    if(!user?.active||user.centerId!==req.user.centerId||user.role!==req.user.role)throw fail(401,'UNAUTHENTICATED','Sign in required');
    const other=await tx.userProfile.findUnique({where:{email:body.email}});
    if(other&&other.userId!==user.id)throw fail(409,'PROFILE_CONFLICT','Email is unavailable');
    const row=await tx.userProfile.upsert({where:{userId:user.id},create:{userId:user.id,...body},update:body});
    await tx.auditLog.create({data:{userId:user.id,resourceId:user.id,action:'PROFILE_UPDATED'}});return row;
   });res.set('Cache-Control','no-store').json({data:profile});
  }catch(e){if(e.code==='P2002')throw fail(409,'PROFILE_CONFLICT','Email is unavailable');throw e;}
 }));
}
