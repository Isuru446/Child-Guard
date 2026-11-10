import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { credentialHash, registrationSchema } from '../src/registration.js';
import { inspectImage } from '../src/registration-photos.js';
import {createAdminSessionRouter,adminCookieTransport} from '../src/admin-session-http.js';
import {legacyMobileBridge} from '../src/admin-session-cutover.js';
import {sessionFixture} from './helpers/admin-session-memory.js';

const secret='synthetic-registration-test-secret-more-than-32',receipt='a'.repeat(64),invite='b'.repeat(64),claim='c'.repeat(64);
let db,app,state,admin,parent,teacher,outside,child,device,mediaRoot;
const auth=user=>`Bearer ${jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'})}`;
const body=(patch={})=>({fullName:'Synthetic Parent',username:'synthetic-parent',email:'SYNTHETIC@example.invalid',phone:'0700000000',password:'Synthetic-password-123',role:'PARENT',centerCode:invite,acceptTerms:true,children:[{existingChildId:child.id,relationship:'Parent',wearable:{hardwareId:device.hardwareId,claimCode:claim}}],...patch});
const submit=(patch={})=>request(app).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(body(patch));
const decision=(group,id,status='APPROVED',user=admin,extra={})=>request(app).post(`/api/v1/admin/${group}/${id}/decision`).set('Authorization',auth(user)).send({status,...extra});
beforeEach(async()=>{
 const centerId=randomUUID();admin={id:randomUUID(),username:'admin',role:'ADMIN',active:true,centerId};parent={id:randomUUID(),username:'existing-parent',role:'PARENT',active:true,centerId};teacher={id:randomUUID(),username:'existing-teacher',role:'TEACHER',active:true,centerId};outside={...admin,id:randomUUID(),centerId:randomUUID()};
 child={id:randomUUID(),name:'Synthetic existing child',centerId};device={id:randomUUID(),hardwareId:'SYNTHETIC-WEARABLE',centerId,active:true};
 state={center:[{id:centerId,name:'Synthetic Public Center',privateContact:'not-public'},{id:outside.centerId,name:'Synthetic Private Center'}],user:[admin,parent,teacher,outside],userProfile:[],child:[child],device:[device],centerInvitation:[{id:randomUUID(),centerId,codeHash:credentialHash(invite),expiresAt:new Date(Date.now()+86400000)}],registrationApplication:[],enrollmentRequest:[],wearableRequest:[],registrationDecision:[],guardian:[],assignment:[],auditLog:[],privatePhoto:[],deviceClaimCode:[{id:randomUUID(),deviceId:device.id,codeHash:credentialHash(claim),expiresAt:new Date(Date.now()+86400000),consumedAt:null}]};
 function matches(row,where={}){return Object.entries(where).every(([key,value])=>{
  if(value===undefined)return true;
  if(key==='OR')return value.some(v=>matches(row,v));
  if(key==='userId_childId')return matches(row,value);
  if(key==='enrollment')return matches(state.enrollmentRequest.find(r=>r.id===row.enrollmentId)||{},value);
  if(key==='guardians')return state.guardian.some(g=>g.childId===row.id&&matches(g,value.some));
  if(key==='user')return matches(state.user.find(u=>u.id===row.userId)||{},value);
  if(key==='device')return matches(state.device.find(d=>d.id===row.deviceId)||{},value);
  if(key==='child')return matches(state.child.find(c=>c.id===row.childId)||{},value);
  if(value&&typeof value==='object'&&!(value instanceof Date)){if(value.in)return value.in.includes(row[key]);if('equals' in value)return row[key]?.toLowerCase()===value.equals?.toLowerCase();}
  return row[key]===value;
 });}
 function hydrate(kind,row){if(!row)return null;const r={...row};
  if(kind==='registrationApplication')r.center=state.center.find(c=>c.id===r.centerId);
  if(kind==='registrationApplication'){r.children=state.enrollmentRequest.filter(c=>c.applicationId===r.id).map(c=>hydrate('enrollmentRequest',c));r.photo=state.privatePhoto.find(p=>p.applicationId===r.id)||null;r.decisions=state.registrationDecision.filter(d=>d.applicationId===r.id);}
  if(kind==='enrollmentRequest'){r.wearable=state.wearableRequest.find(w=>w.enrollmentId===r.id)||null;r.application=state.registrationApplication.find(a=>a.id===r.applicationId);}
  if(kind==='wearableRequest')r.enrollment=state.enrollmentRequest.find(e=>e.id===r.enrollmentId);
  if(kind==='privatePhoto'){r.application=state.registrationApplication.find(a=>a.id===r.applicationId);r.profile=state.userProfile.find(p=>p.userId===r.userId);}
  return r;
 }
 db={};for(const kind of Object.keys(state)){
  const find=where=>state[kind].find(r=>matches(r,where));
  db[kind]={findUnique:vi.fn(async({where})=>hydrate(kind,find(where))),findFirst:vi.fn(async({where})=>hydrate(kind,find(where))),findMany:vi.fn(async({where}={})=>state[kind].filter(r=>matches(r,where)).map(r=>hydrate(kind,r))),count:vi.fn(async({where}={})=>state[kind].filter(r=>matches(r,where)).length),create:vi.fn(async({data})=>{
   const {children,wearable,...plain}=data;const row={id:randomUUID(),status:'PENDING',createdAt:new Date(),...(kind==='assignment'?{endedAt:null,startedAt:new Date()}:{}),...plain};state[kind].push(row);
   if(children)for(const c of children.create)await db.enrollmentRequest.create({data:{...c,applicationId:row.id}});
   if(wearable)await db.wearableRequest.create({data:{...wearable.create,enrollmentId:row.id}});
   return hydrate(kind,row);
  }),update:vi.fn(async({where,data})=>{const row=find(where);if(!row)throw new Error('Missing synthetic record');Object.assign(row,data);return hydrate(kind,row);}),updateMany:vi.fn(async({where,data})=>{let count=0;for(const row of state[kind].filter(r=>matches(r,where))){Object.assign(row,data);count++;}return {count};}),deleteMany:vi.fn(async({where})=>{state[kind]=state[kind].filter(r=>!matches(r,where));})};
  db[kind].upsert=vi.fn(async({where,create,update})=>find(where)?db[kind].update({where,data:update}):db[kind].create({data:create}));
 }
 db.$transaction=async work=>{const snapshot=structuredClone(state);try{return await work(db);}catch(error){state=snapshot;throw error;}};
 db.$queryRaw=async()=>[{now:new Date()}];
 mediaRoot=await mkdtemp(resolve('.registration-media-'));
 app=createApp({db,jwtSecret:secret,registrationEnabled:true,mediaRoot,logger:{error(){}}});
});
afterEach(async()=>{if(!mediaRoot.startsWith(resolve('.registration-media-')))throw new Error('Unexpected cleanup target');await rm(mediaRoot,{recursive:true,force:true});});
it.each([1,2])('enforces ten registration attempts per app and isolates fresh app quotas (run %s)',async()=>{
 // Invalid attempts still consume quota, without conflating idempotency with throttling.
 for(let i=0;i<10;i++)expect((await submit({fullName:''})).status).toBe(422);
 const blocked=await submit();
 expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe('RATE_LIMITED');
 expect(state.registrationApplication).toHaveLength(0);
 const fresh=createApp({db,jwtSecret:secret,registrationEnabled:true,mediaRoot,logger:{error(){}}});
 const valid=await request(fresh).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(body());
 expect(valid.status).toBe(201);expect(valid.body.data.status).toBe('PENDING');
 expect(state.user).toHaveLength(4);
 expect((await submit()).status).toBe(429);
});
it('persists pending Parent requests without an active account, Guardian, assignment or JWT',async()=>{
 const r=await submit();expect(r.status).toBe(201);expect(r.body.data.status).toBe('PENDING');expect(r.body.data.children).toHaveLength(1);expect(r.body).not.toHaveProperty('token');expect(state.user).toHaveLength(4);expect(state.guardian).toHaveLength(0);expect(state.assignment).toHaveLength(0);expect(JSON.stringify(r.body)).not.toContain('passwordHash');expect(JSON.stringify(r.body)).not.toContain('claimHash');expect(state.registrationApplication[0].email).toBe('synthetic@example.invalid');
});
it('accepts Teacher without children and rejects Teacher Guardian requests',async()=>{expect((await submit({role:'TEACHER',children:[]})).status).toBe(201);expect(registrationSchema.safeParse(body({role:'TEACHER'})).success).toBe(false);});
it.each([{fullName:''},{username:'x'},{email:'invalid'},{phone:'letters'},{password:'short'},{role:'ADMIN'},{acceptTerms:false},{centerId:'injected'},{children:[]}])('rejects invalid registration fields: %j',async patch=>{expect((await submit(patch)).status).toBe(422);expect(state.registrationApplication).toHaveLength(0);});
it('uses private receipts for idempotency and status access',async()=>{const first=await submit();const retry=await submit();expect(retry.status).toBe(201);expect(retry.body.data.id).toBe(first.body.data.id);expect(state.registrationApplication).toHaveLength(1);expect((await submit({phone:'0711111111'})).status).toBe(409);expect((await request(app).get('/api/v1/registration/status')).status).toBe(401);expect((await request(app).get('/api/v1/registration/status').set('X-Registration-Receipt','d'.repeat(64))).status).toBe(401);});
it('rejects invalid and expired invitations',async()=>{expect((await submit({centerCode:'d'.repeat(64)})).status).toBe(422);state.centerInvitation[0].expiresAt=new Date(0);expect((await submit()).status).toBe(422);});
it('approves account independently and prevents repeated or reversed decisions',async()=>{const r=await submit();const approved=await decision('registrations',r.body.data.id);expect(approved.status).toBe(200);expect(state.user).toHaveLength(5);expect(state.userProfile).toHaveLength(1);expect(state.guardian).toHaveLength(0);expect(state.assignment).toHaveLength(0);expect(state.registrationApplication[0].passwordHash).toBeNull();expect(state.registrationDecision).toHaveLength(1);expect(state.auditLog[0].action).toBe('REGISTRATION_APPROVED');expect((await decision('registrations',r.body.data.id)).status).toBe(409);expect((await decision('registrations',r.body.data.id,'REJECTED',admin,{reason:'Correction needed'})).status).toBe(409);});
it('prevents non-Admin and wrong-center reviews',async()=>{const r=await submit();for(const user of [parent,teacher])expect((await decision('registrations',r.body.data.id,'APPROVED',user)).status).toBe(403);expect((await decision('registrations',r.body.data.id,'APPROVED',outside)).status).toBe(404);});
it('requires and persists rejection reason before controlled resubmission',async()=>{const r=await submit();expect((await decision('registrations',r.body.data.id,'REJECTED')).status).toBe(422);expect((await decision('registrations',r.body.data.id,'REJECTED',admin,{reason:'Please correct your contact details'})).status).toBe(200);const revised=await request(app).post('/api/v1/registration/resubmit').set('X-Registration-Receipt',receipt).send(body({phone:'0711111111'}));expect(revised.status).toBe(200);expect(revised.body.data.status).toBe('PENDING');expect(revised.body.data.decisions).toHaveLength(1);});
it('rolls back account creation if audit persistence fails',async()=>{const r=await submit();db.auditLog.create.mockRejectedValueOnce(new Error('Synthetic failure'));expect((await decision('registrations',r.body.data.id)).status).toBe(503);expect(state.user).toHaveLength(4);expect(state.userProfile).toHaveLength(0);expect(state.registrationApplication[0].status).toBe('PENDING');});
it('requires separate account, Guardian and wearable approvals',async()=>{const r=await submit();const c=r.body.data.children[0];expect((await decision('enrollments',c.id)).status).toBe(409);await decision('registrations',r.body.data.id);expect((await decision('wearable-requests',c.wearable.id)).status).toBe(409);expect((await decision('enrollments',c.id)).status).toBe(200);expect(state.guardian).toHaveLength(1);expect((await decision('wearable-requests',c.wearable.id)).status).toBe(200);expect(state.assignment).toHaveLength(1);expect(state.deviceClaimCode[0].consumedAt).toBeInstanceOf(Date);expect((await decision('wearable-requests',c.wearable.id)).status).toBe(409);});
it('supports a signed-in Parent enrollment, separate Guardian approval, Admin-issued claim and wearable approval',async()=>{
 const enrollment=await request(app).post('/api/v1/account/children').set('Authorization',auth(parent)).send({existingChildId:child.id,relationship:'Parent'});
 expect(enrollment.status).toBe(201);expect(state.guardian).toHaveLength(0);
 expect((await decision('enrollments',enrollment.body.data.id)).status).toBe(200);
 const issued=await request(app).post(`/api/v1/admin/devices/${device.id}/claim-code`).set('Authorization',auth(admin)).send({});expect(issued.status).toBe(201);
 const payload={childId:child.id,hardwareId:device.hardwareId,claimCode:issued.body.data.code};
 const ask=()=>request(app).post('/api/v1/account/wearables').set('Authorization',auth(parent)).send(payload);
 const requested=await ask();expect(requested.status).toBe(201);expect(state.assignment).toHaveLength(0);expect((await ask()).body.error.code).toBe('REQUEST_EXISTS');
 expect(JSON.stringify(requested.body)).not.toContain(payload.claimCode);expect((await decision('wearable-requests',requested.body.data.id)).status).toBe(200);
 expect(state.assignment).toHaveLength(1);expect(state.assignment[0]).toMatchObject({childId:child.id,deviceId:device.id,endedAt:null});
 expect(state.deviceClaimCode.find(c=>c.codeHash===credentialHash(payload.claimCode)).consumedAt).toBeInstanceOf(Date);
 expect((await decision('wearable-requests',requested.body.data.id)).status).toBe(409);
 expect((await request(app).post(`/api/v1/admin/devices/${device.id}/claim-code`).set('Authorization',auth(admin)).send({})).body.error.code).toBe('ASSIGNED');
});
it('refuses Parent-request approval when the child already has another active wearable',async()=>{
 state.guardian.push({userId:parent.id,childId:child.id});state.assignment.push({id:randomUUID(),deviceId:randomUUID(),childId:child.id,endedAt:null});
 const asked=await request(app).post('/api/v1/account/wearables').set('Authorization',auth(parent)).send({childId:child.id,hardwareId:device.hardwareId,claimCode:claim});expect(asked.status).toBe(201);
 expect((await decision('wearable-requests',asked.body.data.id)).body.error.code).toBe('ASSIGNMENT_CONFLICT');expect(state.assignment).toHaveLength(1);expect(state.deviceClaimCode[0].consumedAt).toBeNull();
});
it.each(['wrong','expired','assigned','unregistered'])('rejects unsafe wearable claim: %s',async scenario=>{const r=await submit();const c=r.body.data.children[0];await decision('registrations',r.body.data.id);await decision('enrollments',c.id);if(scenario==='wrong')state.deviceClaimCode[0].codeHash='not-matching';if(scenario==='expired')state.deviceClaimCode[0].expiresAt=new Date(0);if(scenario==='assigned')state.assignment.push({id:randomUUID(),deviceId:device.id,childId:randomUUID(),endedAt:null});if(scenario==='unregistered')state.device=[];expect((await decision('wearable-requests',c.wearable.id)).status).toBe(409);expect(state.deviceClaimCode[0].consumedAt).toBeNull();});
it('rejects foreign child references at review without creating a Guardian',async()=>{const r=await submit({children:[{existingChildId:randomUUID(),relationship:'Parent'}]});await decision('registrations',r.body.data.id);expect((await decision('enrollments',r.body.data.children[0].id)).status).toBe(404);expect(state.guardian).toHaveLength(0);});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
it('serves only the receipt owner image and removes replaced files',async()=>{expect(inspectImage(png)).toBe('image/png');await submit();const upload=()=>request(app).put('/api/v1/registration/photo').set('X-Registration-Receipt',receipt).set('Content-Type','image/png').send(png);expect((await upload()).status).toBe(200);expect((await upload()).status).toBe(200);expect(await readdir(mediaRoot)).toHaveLength(1);expect((await request(app).get('/api/v1/registration/photo').set('X-Registration-Receipt',receipt)).status).toBe(200);expect((await request(app).get('/api/v1/registration/photo').set('X-Registration-Receipt','e'.repeat(64))).status).toBe(401);});
it.each([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.alloc(2*1024*1024+1),Buffer.from('fake JPEG payload pretending to be image/jpeg')])('rejects unsafe image content',bytes=>{expect(()=>inspectImage(bytes)).toThrow();});
it('removes an uploaded file if metadata transaction fails',async()=>{await submit();db.privatePhoto.upsert.mockRejectedValue(new Error('Synthetic failure'));expect((await request(app).put('/api/v1/registration/photo').set('X-Registration-Receipt',receipt).set('Content-Type','image/png').send(png)).status).toBe(503);expect(await readdir(mediaRoot)).toHaveLength(0);});
it('requires Admin acknowledgement and the exact current assignment for transfer',async()=>{
 state.guardian.push({userId:parent.id,childId:child.id});
 const previousDevice={...device,id:randomUUID(),hardwareId:'previous-belt'};state.device.push(previousDevice);
 const previous={id:randomUUID(),deviceId:previousDevice.id,childId:child.id,endedAt:null,startedAt:new Date(0)};state.assignment.push(previous);
 const path=`/api/v1/admin/devices/${device.id}/transfer`;
 const payload={expectedAssignmentId:previous.id,childId:child.id,transferAcknowledged:true};
 expect((await request(app).post(path).set('Authorization',auth(parent)).send(payload)).status).toBe(403);
 expect((await request(app).post(path).set('Authorization',auth(admin)).send({...payload,transferAcknowledged:false})).status).toBe(422);
 expect((await request(app).post(path).set('Authorization',auth(admin)).send({...payload,expectedAssignmentId:randomUUID()})).status).toBe(409);
 expect((await request(app).post(path).set('Authorization',auth(admin)).send(payload)).status).toBe(200);
 expect(state.assignment).toHaveLength(2);expect(state.assignment[0].endedAt).toBeInstanceOf(Date);expect(state.auditLog.some(a=>a.action.startsWith('DEVICE_TRANSFERRED:'))).toBe(true);
});
it('forbids managing Admin accounts and prevents ADMIN role escalation',async()=>{
 expect((await request(app).patch(`/api/v1/admin/users/${admin.id}/status`).set('Authorization',auth(admin)).send({active:false})).status).toBe(404);
 expect((await request(app).patch(`/api/v1/admin/users/${parent.id}/role`).set('Authorization',auth(admin)).send({role:'ADMIN',roleChangeAcknowledged:true})).status).toBe(422);
 expect(state.user.find(u=>u.id===admin.id).active).toBe(true);
});
it('rejects profile mass assignment and unrelated child wearable requests',async()=>{
 expect((await request(app).patch('/api/v1/account/profile').set('Authorization',auth(parent)).send({fullName:'Synthetic Parent',email:'parent@example.invalid',phone:'0700000000',role:'ADMIN'})).status).toBe(422);
 expect((await request(app).post('/api/v1/account/wearables').set('Authorization',auth(parent)).send({childId:child.id,hardwareId:device.hardwareId,claimCode:claim})).status).toBe(404);
 expect(state.userProfile).toHaveLength(0);
});
it('changes only the authenticated account password after current-password validation',async()=>{
 state.user.find(u=>u.id===parent.id).passwordHash=await bcrypt.hash('Old-password-123',4);
 const change=currentPassword=>request(app).post('/api/v1/account/password').set('Authorization',auth(parent)).send({currentPassword,newPassword:'New-password-456'});
 expect((await change('wrong-password')).status).toBe(422);
 expect((await change('Old-password-123')).status).toBe(200);
 const updated=state.user.find(u=>u.id===parent.id);
 expect(await bcrypt.compare('New-password-456',updated.passwordHash)).toBe(true);
 expect(bcrypt.getRounds(updated.passwordHash)).toBe(12);
 expect(state.auditLog.some(a=>a.userId===parent.id&&a.action==='PASSWORD_CHANGED')).toBe(true);
});
it('persists only permitted own-profile fields and emergency contacts',async()=>{
 const profile={fullName:'Synthetic Parent',email:'PARENT@example.invalid',phone:'0700000000',emergencyContacts:[{name:'Synthetic Contact',phone:'0711111111',relationship:'Aunt'}]};
 const r=await request(app).patch('/api/v1/account/profile').set('Authorization',auth(parent)).send(profile);
 expect(r.status).toBe(200);expect(state.userProfile[0].userId).toBe(parent.id);expect(state.userProfile[0].email).toBe('parent@example.invalid');expect(state.userProfile[0].emergencyContacts).toHaveLength(1);
});
it('provides real center-scoped dashboard counts and forbids Parent access',async()=>{
 db.alert={count:vi.fn().mockResolvedValue(0)};db.beacon={count:vi.fn().mockResolvedValue(2)};
 db.attendance={findMany:vi.fn().mockResolvedValue([{id:randomUUID(),childId:child.id,day:'2026-10-23',status:'CHECKIN_PENDING'}])};
 const path='/api/v1/admin/overview?month=2026-10';
 expect((await request(app).get(path).set('Authorization',auth(parent))).status).toBe(403);
 const r=await request(app).get(path).set('Authorization',auth(admin));
 expect(r.status).toBe(200);expect(r.body.data.counts).toMatchObject({children:1,teachers:1,devices:1,alerts:0,beacons:2});
 expect(r.body.data.attendance[0].status).toBe('CHECKIN_PENDING');
 expect(db.attendance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({child:{centerId:admin.centerId}})}));
});

it('reports public availability and keeps disabled submissions gated without database access',async()=>{
 for(const enabled of [true,false]){
  const noDb={};
  const gated=createApp({db:noDb,jwtSecret:secret,registrationEnabled:enabled});
  const availability=await request(gated).get('/api/v1/registration/availability');
  expect(availability.status).toBe(200);
  expect(availability.body).toEqual({data:{enabled}});
  expect(availability.headers['cache-control']).toBe('no-store');
  if(!enabled){
   const denied=await request(gated).post('/api/v1/registration').send({});
   expect(denied.status).toBe(503);
   expect(denied.body.error.code).toBe('REGISTRATION_UNAVAILABLE');
  }
 }
});

it.each([
 ['username',{username:'Parent Name'},'username'],
 ['center invitation',{centerCode:'my-center'},'centerCode'],
 ['phone',{phone:'call me'},'phone'],
 ['impossible date',{children:[{fullName:'Synthetic child',dateOfBirth:'2021-02-31',relationship:'Parent'}]},'children.0.dateOfBirth'],
 ['short relationship',{children:[{fullName:'Synthetic child',dateOfBirth:'2021-02-28',relationship:'P'}]},'children.0.relationship'],
 ['existing reference',{children:[{existingChildId:'child-1',relationship:'Parent'}]},'children.0.existingChildId'],
 ['wearable code',{children:[{fullName:'Synthetic child',dateOfBirth:'2021-02-28',relationship:'Parent',wearable:{hardwareId:'SYNTHETIC',claimCode:'1234'}}]},'children.0.wearable.claimCode'],
 ['missing email',{email:undefined},'email'],
])('returns safe field-specific validation for %s without writes',async(_label,patch,field)=>{
 const response=await submit(patch);
 expect(response.status).toBe(422);
 expect(response.body.error.code).toBe('VALIDATION_ERROR');
 expect(response.body.error.fields[field]).toEqual(expect.any(String));
 expect(response.body.error.message).toBe('Check the highlighted registration fields.');
 expect(state.registrationApplication).toHaveLength(0);
 expect(state.user).toHaveLength(4);
 expect(JSON.stringify(response.body)).not.toContain('Synthetic-password-123');
 expect(JSON.stringify(response.body)).not.toContain(invite);
 expect(JSON.stringify(response.body)).not.toContain(claim);
});
it('accepts new-child and mixed multiple-child payloads produced by Flutter',async()=>{
 const response=await submit({children:[
  {fullName:'Synthetic new child',dateOfBirth:'2021-02-28',relationship:'Parent'},
  {existingChildId:child.id,relationship:'Guardian',wearable:{hardwareId:device.hardwareId,claimCode:claim}},
 ]});
 expect(response.status).toBe(201);
 expect(response.body.data.status).toBe('PENDING');
 expect(response.body.data.children).toHaveLength(2);
 expect(response.body.data.children[1].wearable.hardwareId).toBe(device.hardwareId);
 expect(state.user).toHaveLength(4);
 expect(state.guardian).toHaveLength(0);
 expect(state.assignment).toHaveLength(0);
 expect(response.body.data).not.toHaveProperty('token');
});

const centerApp=(ids=[admin.centerId],enabled=true)=>createApp({db,jwtSecret:secret,registrationEnabled:enabled,publicRegistrationCenterIds:ids,mediaRoot,logger:{error(){}}});
function cookieApp(actor=admin){
 const f=sessionFixture();actor.passwordHash=bcrypt.hashSync('Synthetic-admin-password',4);actor.authVersion=0;f.state.user={...actor};
 const transport=adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'});
 const router=createAdminSessionRouter({db,service:f.service,transport,mobileBridge:legacyMobileBridge({db,jwtSecret:secret})});
 return createApp({db,jwtSecret:secret,adminAuthRouter:router,registrationEnabled:true,publicRegistrationCenterIds:[admin.centerId],mediaRoot,logger:{error(){}}});
}
const web=(target,method,path)=>request(target)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
it.each(['PARENT','TEACHER'])('cookie-reviewed %s application stays blocked until approval, then supports username and email login',async role=>{
 const target=cookieApp(),payload=body({role,...(role==='TEACHER'?{children:[]}:{})});
 const submitted=await request(target).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(payload);
 expect(submitted.status).toBe(201);expect(submitted.body.data.status).toBe('PENDING');
 expect(state.user).toHaveLength(4);expect(state.guardian).toHaveLength(0);
 const loginAs=(identifier,password=payload.password)=>request(target).post('/api/v1/auth/login').send({username:identifier,password});
 expect((await loginAs(payload.username)).body.error.code).toBe('REGISTRATION_PENDING');
 expect((await loginAs(payload.email)).body.error.code).toBe('REGISTRATION_PENDING');
 expect((await loginAs(payload.username,'wrong')).body.error.code).toBe('INVALID_CREDENTIALS');
 const adminLogin=await web(target,'post','/api/v1/auth/login').send({username:admin.username,password:'Synthetic-admin-password'});
 expect(adminLogin.status).toBe(200);
 const cookie=adminLogin.headers['set-cookie'][0].split(';')[0],csrf=adminLogin.body.data.csrfToken;
 const path=`/api/v1/admin/registrations/${submitted.body.data.id}/decision`;
 const list=await web(target,'get','/api/v1/admin/registrations').set('Cookie',cookie);
 expect(list.body.data[0]).toMatchObject({email:payload.email.toLowerCase(),role,status:'PENDING',centerName:'Synthetic Public Center'});
 expect(JSON.stringify(list.body)).not.toContain(payload.password);
 expect((await web(target,'post',path).set('Cookie',cookie).send({status:'APPROVED'})).status).toBe(403);
 expect((await web(target,'post',path).set('Cookie',cookie).set('X-CSRF-Token',csrf).send({status:'APPROVED'})).status).toBe(200);
 expect((await web(target,'post',path).set('Cookie',cookie).set('X-CSRF-Token',csrf).send({status:'APPROVED'})).status).toBe(409);
 for(const identity of [payload.username,payload.email]){
  const logged=await loginAs(identity);expect(logged.status).toBe(200);expect(logged.body.data.user).toMatchObject({role,centerId:admin.centerId});
  const me=await request(target).get('/api/v1/auth/me').set('Authorization',`Bearer ${logged.body.data.token}`);
  expect(me.status).toBe(200);expect(me.body.data.role).toBe(role);
 }
 expect(state.guardian).toHaveLength(0); // Account approval grants no child relationship.
 expect(state.registrationDecision).toHaveLength(1);
},20000);
it.each(['PARENT','TEACHER'])('password-verified rejected %s receives status without any token or protected access',async role=>{
 const target=cookieApp(),payload=body({role,...(role==='TEACHER'?{children:[]}:{})});
 const submitted=await request(target).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(payload);
 const adminLogin=await web(target,'post','/api/v1/auth/login').send({username:admin.username,password:'Synthetic-admin-password'});
 expect(adminLogin.status).toBe(200);
 const cookie=adminLogin.headers['set-cookie'][0].split(';')[0];
 expect((await web(target,'post',`/api/v1/admin/registrations/${submitted.body.data.id}/decision`).set('Cookie',cookie).set('X-CSRF-Token',adminLogin.body.data.csrfToken).send({status:'REJECTED',reason:'Correct contact information'})).status).toBe(200);
 const denied=await request(target).post('/api/v1/auth/login').send({username:payload.email,password:payload.password});
 expect(denied.status).toBe(403);expect(denied.body.error.code).toBe('REGISTRATION_REJECTED');expect(denied.body).not.toHaveProperty('data');
 expect((await request(target).get('/api/v1/auth/me')).status).not.toBe(200);
 expect(state.registrationDecision[0].reason).toBe('Correct contact information');expect(state.user).toHaveLength(4);
},20000);
it('cookie Admin cannot approve another center and mobile users cannot self-approve',async()=>{
 const submitted=await submit();outside.username='outside-admin';const target=cookieApp(outside);
 const session=await web(target,'post','/api/v1/auth/login').send({username:outside.username,password:'Synthetic-admin-password'});
 expect(session.status).toBe(200);
 const path=`/api/v1/admin/registrations/${submitted.body.data.id}/decision`;
 expect((await web(target,'post',path).set('Cookie',session.headers['set-cookie'][0].split(';')[0]).set('X-CSRF-Token',session.body.data.csrfToken).send({status:'APPROVED'})).status).toBe(404);
 for(const actor of [parent,teacher])expect((await request(target).post(path).set('Authorization',auth(actor)).send({status:'APPROVED'})).status).toBe(403);
 expect(state.registrationApplication[0].status).toBe('PENDING');expect(state.registrationDecision).toHaveLength(0);
});
const publicSubmit=(target,patch={})=>request(target).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(body({centerCode:undefined,centerId:admin.centerId,...patch}));
it('lists only explicitly public centers and only id/name',async()=>{
 const response=await request(centerApp()).get('/api/v1/registration/centers');
 expect(response.status).toBe(200);
 expect(response.headers['cache-control']).toBe('no-store');
 expect(response.body).toEqual({data:[{id:admin.centerId,name:'Synthetic Public Center'}]});
 expect(db.center.findMany).toHaveBeenCalledWith({where:{id:{in:[admin.centerId]}},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}]});
});
it('publishes no centers by default and honors the registration feature gate',async()=>{
 expect((await request(centerApp([])).get('/api/v1/registration/centers')).body).toEqual({data:[]});
 expect((await request(centerApp([],false)).get('/api/v1/registration/centers')).status).toBe(503);
 expect(db.center.findMany).not.toHaveBeenCalled();
});
it.each(['PARENT','TEACHER'])('persists public center selection for %s without privileges',async role=>{
 const response=await publicSubmit(centerApp(),{role,...(role==='TEACHER'?{children:[]}:{})});
 expect(response.status).toBe(201);
 expect(response.body.data.centerId).toBe(admin.centerId);
 expect(response.body.data.status).toBe('PENDING');
 expect(state.user).toHaveLength(4);expect(state.guardian).toHaveLength(0);expect(state.assignment).toHaveLength(0);
 expect(state.centerInvitation).toHaveLength(1);
 expect(db.centerInvitation.findUnique).not.toHaveBeenCalled();
 expect(response.body).not.toHaveProperty('token');
});
it.each(['missing','malformed','private','unknown','both','forgedName'])('rejects invalid public center selection: %s',async mode=>{
 const unknown=randomUUID();
 const target=centerApp(mode==='unknown'?[unknown]:[admin.centerId]);
 const patch=mode==='missing'?{centerId:undefined}:mode==='malformed'?{centerId:'center-name'}:mode==='private'?{centerId:outside.centerId}:mode==='unknown'?{centerId:unknown}:mode==='both'?{centerCode:invite}:{centerName:'Forged Trusted Center'};
 const response=await publicSubmit(target,patch);
 expect(response.status).toBe(422);
 if(mode!=='forgedName')expect(response.body.error.fields.centerId).toEqual(expect.any(String));
 expect(state.registrationApplication).toHaveLength(0);expect(state.user).toHaveLength(4);
});
it('keeps public-center application review scoped to the correct Admin',async()=>{
 const target=centerApp();const r=await publicSubmit(target);expect(r.status).toBe(201);
 expect((await request(target).post(`/api/v1/admin/registrations/${r.body.data.id}/decision`).set('Authorization',auth(outside)).send({status:'APPROVED'})).status).toBe(404);
 expect((await request(target).post(`/api/v1/admin/registrations/${r.body.data.id}/decision`).set('Authorization',auth(teacher)).send({status:'APPROVED'})).status).toBe(403);
 expect(state.user).toHaveLength(4);
});
it('does not permit public resubmission into another eligible center',async()=>{
 const target=centerApp([admin.centerId,outside.centerId]);const r=await publicSubmit(target);
 expect(r.status).toBe(201);await decision('registrations',r.body.data.id,'REJECTED',admin,{reason:'Please correct details'});
 const response=await request(target).post('/api/v1/registration/resubmit').set('X-Registration-Receipt',receipt).send(body({centerCode:undefined,centerId:outside.centerId}));
 expect(response.status).toBe(422);expect(response.body.error.fields.centerId).toEqual(expect.any(String));
 expect(state.registrationApplication[0].status).toBe('REJECTED');
});

it('does not authenticate a public applicant while pending or after rejection',async()=>{
 const target=centerApp();const r=await publicSubmit(target);
 expect(r.status).toBe(201);
 const login=()=>request(target).post('/api/v1/auth/login').send({username:'synthetic-parent',password:'Synthetic-password-123'});
 const pending=await login();expect(pending.status).toBe(403);expect(pending.body.error.code).toBe('REGISTRATION_PENDING');expect(pending.body).not.toHaveProperty('data.token');
 expect((await request(target).post(`/api/v1/admin/registrations/${r.body.data.id}/decision`).set('Authorization',auth(admin)).send({status:'REJECTED',reason:'Please contact your center'})).status).toBe(200);
 const rejected=await login();expect(rejected.status).toBe(403);expect(rejected.body.error.code).toBe('REGISTRATION_REJECTED');expect(rejected.body).not.toHaveProperty('data.token');
 expect(state.user).toHaveLength(4);
});
