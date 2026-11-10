import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import { rm, readdir } from 'node:fs/promises';
import { createApp, tokenHash } from '../src/app.js';
import { credentialHash } from '../src/registration.js';
import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';

const db=new PrismaClient({datasources:{db:{url:validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)}}});
const mediaRoot=resolve(`.registration-integration-media-${randomUUID()}`);
let app;
const password='Synthetic-isolated-password-123';
const jwtSecret=randomBytes(48).toString('hex');
const freshApp=()=>createApp({mediaRoot,db,jwtSecret,registrationEnabled:true,publicRegistrationCenterIds:[center.id],logger:{error(){}}});
let center,child,device,adminAuth,invite,claim,teacherAuth;
beforeAll(async()=>{
 await assertTestDatabase(db);
 center=await db.center.create({data:{name:`Synthetic registration ${randomUUID()}`}});
 app=freshApp();
 child=await db.child.create({data:{name:'Synthetic enrollment child',centerId:center.id}});
 device=await db.device.create({data:{hardwareId:`SYNTHETIC-${randomUUID()}`,centerId:center.id,tokenHash:tokenHash(randomUUID())}});
 const admin=await db.user.create({data:{username:`synthetic-admin-${randomUUID()}`,role:'ADMIN',centerId:center.id,passwordHash:await bcrypt.hash(password,4)}});
 const login=await request(app).post('/api/v1/auth/login').send({username:admin.username,password});expect(login.status).toBe(200);adminAuth=`Bearer ${login.body.data.token}`;
 const invitation=await request(app).post('/api/v1/admin/center-invitations').set('Authorization',adminAuth).send({});expect(invitation.status).toBe(201);invite=invitation.body.data.code;
 const code=await request(app).post(`/api/v1/admin/devices/${device.id}/claim-code`).set('Authorization',adminAuth).send({});expect(code.status).toBe(201);claim=code.body.data.code;
});
// Keep persisted workflow fixtures, but give each case fresh per-app limiter stores.
// The same signing secret keeps fixture Admin/Teacher tokens valid across apps.
beforeEach(()=>{app=freshApp();});
afterAll(async()=>{await db.$disconnect();if(!mediaRoot.startsWith(resolve('.registration-integration-media-')))throw new Error('Invalid test cleanup directory');await rm(mediaRoot,{recursive:true,force:true});});
async function submit(patch={}) {
 const receipt=randomBytes(32).toString('hex'),suffix=randomUUID();
 const body={fullName:'Synthetic Applicant',username:`synthetic-${suffix}`,email:`${suffix}@example.invalid`,phone:'0700000000',password,role:'PARENT',centerCode:invite,acceptTerms:true,children:[{existingChildId:child.id,relationship:'Parent',wearable:{hardwareId:device.hardwareId,claimCode:claim}}],...patch};
 const response=await request(app).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(body);
 expect(response.status).toBe(201);return {receipt,body,row:response.body.data};
}
const decide=(group,id,status='APPROVED',reason)=>request(app).post(`/api/v1/admin/${group}/${id}/decision`).set('Authorization',adminAuth).send({status,...(reason?{reason}:{})});
it('persists pending registration, hashed credentials, receipt and idempotent retry without a User',async()=>{
 const {row,receipt,body}=await submit();
 expect(await db.user.count({where:{username:body.username}})).toBe(0);
 const saved=await db.registrationApplication.findUnique({where:{id:row.id}});
 expect(saved.receiptHash).toBe(credentialHash(receipt));expect(saved.passwordHash).not.toBe(password);expect(await bcrypt.compare(password,saved.passwordHash)).toBe(true);
 const repeat=await request(app).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send(body);expect(repeat.status).toBe(201);expect(repeat.body.data.id).toBe(row.id);
 expect((await request(app).post('/api/v1/auth/login').send({username:body.username,password})).status).toBe(401);
});
it('persists independent Parent, Guardian and wearable approvals with one-time code consumption',async()=>{
 const {row,body}=await submit();const childRequest=row.children[0];
 expect((await decide('registrations',row.id)).status).toBe(200);
 const login=await request(app).post('/api/v1/auth/login').send({username:body.username,password});expect(login.status).toBe(200);const headers={Authorization:`Bearer ${login.body.data.token}`};
 expect((await request(app).get('/api/v1/mobile/children').set(headers)).body.data).toEqual([]);
 expect((await decide('wearable-requests',childRequest.wearable.id)).status).toBe(409);
 expect((await decide('enrollments',childRequest.id)).status).toBe(200);
 expect((await decide('wearable-requests',childRequest.wearable.id)).status).toBe(200);
 const wearable=await request(app).get(`/api/v1/mobile/children/${child.id}/device`).set(headers);expect(wearable.body.data.hardwareId).toBe(device.hardwareId);
 expect(await db.assignment.count({where:{deviceId:device.id,endedAt:null}})).toBe(1);
 expect((await db.deviceClaimCode.findUnique({where:{codeHash:credentialHash(claim)}})).consumedAt).not.toBeNull();
 expect(await db.auditLog.count({where:{resourceId:row.id,action:'REGISTRATION_APPROVED'}})).toBe(1);
});
it('approves Teacher without Guardian privileges or pending access',async()=>{
 const {row,body}=await submit({role:'TEACHER',children:[]});expect((await decide('registrations',row.id)).status).toBe(200);
 const login=await request(app).post('/api/v1/auth/login').send({username:body.username,password});expect(login.status).toBe(200);expect(login.body.data.user.role).toBe('TEACHER');teacherAuth=`Bearer ${login.body.data.token}`;
 expect((await request(app).get('/api/v1/admin/registrations').set('Authorization',`Bearer ${login.body.data.token}`)).status).toBe(403);
});
it('persists rejection and review history and accepts controlled resubmission',async()=>{
 const {row,body,receipt}=await submit({role:'TEACHER',children:[]});expect((await decide('registrations',row.id,'REJECTED','Please correct contact details')).status).toBe(200);
 expect(await db.user.count({where:{username:body.username}})).toBe(0);
 const result=await request(app).post('/api/v1/registration/resubmit').set('X-Registration-Receipt',receipt).send({...body,phone:'0711111111'});expect(result.status).toBe(200);expect(result.body.data.status).toBe('PENDING');expect(result.body.data.decisions).toHaveLength(1);
});
it('concurrent approval creates one account and one decision',async()=>{
 const {row,body}=await submit({role:'TEACHER',children:[]});
 const responses=await Promise.all([decide('registrations',row.id),decide('registrations',row.id)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
 expect(await db.user.count({where:{username:body.username}})).toBe(1);expect(await db.registrationDecision.count({where:{applicationId:row.id}})).toBe(1);
});
it('creates a new Child only after explicit enrollment review',async()=>{
 const {row}=await submit({children:[{fullName:`Synthetic new child ${randomUUID()}`,dateOfBirth:'2021-01-01',relationship:'Parent'}]});
 expect(row.children[0].childId).toBeNull();await decide('registrations',row.id);
 const approved=await decide('enrollments',row.children[0].id);expect(approved.status).toBe(200);
 expect(await db.guardian.count({where:{childId:approved.body.data.childId}})).toBe(1);
});

it('persists private photo metadata, authorized access and replacement without orphan files',async()=>{
 const {receipt}=await submit({role:'TEACHER',children:[]});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
 const upload=()=>request(app).put('/api/v1/registration/photo').set('X-Registration-Receipt',receipt).set('Content-Type','image/png').send(png);
 const first=await upload();expect(first.status).toBe(200);
 const second=await upload();expect(second.status).toBe(200);expect(second.body.data.id).toBe(first.body.data.id);
 expect(await readdir(mediaRoot)).toHaveLength(1);
 expect((await request(app).get(`/api/v1/account/photos/${first.body.data.id}`).set('Authorization',adminAuth)).status).toBe(200);
 expect((await request(app).get(`/api/v1/account/photos/${first.body.data.id}`).set('Authorization',teacherAuth)).status).toBe(404);
 expect((await request(app).get('/api/v1/registration/photo').set('X-Registration-Receipt',receipt)).status).toBe(200);
});
it('concurrent wearable approvals consume a claim once and never overwrite assignments',async()=>{
 const wearable=await db.device.create({data:{hardwareId:`SYNTHETIC-RACE-${randomUUID()}`,centerId:center.id,tokenHash:tokenHash(randomUUID())}});
 const code=await request(app).post(`/api/v1/admin/devices/${wearable.id}/claim-code`).set('Authorization',adminAuth).send({});expect(code.status).toBe(201);
 const requests=[];
 for(let i=0;i<2;i++){
  const c=await db.child.create({data:{name:`Synthetic race child ${randomUUID()}`,centerId:center.id}});
  const {row}=await submit({children:[{existingChildId:c.id,relationship:'Parent',wearable:{hardwareId:wearable.hardwareId,claimCode:code.body.data.code}}]});
  expect((await decide('registrations',row.id)).status).toBe(200);
  expect((await decide('enrollments',row.children[0].id)).status).toBe(200);requests.push(row.children[0].wearable.id);
 }
 const decisions=await Promise.all(requests.map(id=>decide('wearable-requests',id)));
 expect(decisions.map(r=>r.status).sort()).toEqual([200,409]);
 expect(await db.assignment.count({where:{deviceId:wearable.id,endedAt:null}})).toBe(1);
 expect((await db.deviceClaimCode.findUnique({where:{codeHash:credentialHash(code.body.data.code)}})).consumedAt).not.toBeNull();
});

it('persists a public-center application only in the guarded isolated database',async()=>{
 await assertTestDatabase(db);
 const listed=await request(app).get('/api/v1/registration/centers');
 expect(listed.status).toBe(200);expect(listed.body.data).toEqual([{id:center.id,name:center.name}]);
 const result=await submit({centerCode:undefined,centerId:center.id});
 expect(result.row.status).toBe('PENDING');
 expect(result.row.centerId).toBe(center.id);expect(result.row).not.toHaveProperty('token');
 expect(await db.user.count({where:{username:result.body.username}})).toBe(0);
});
