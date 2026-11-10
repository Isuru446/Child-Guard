// Real HTTP handlers and PostgreSQL persistence; never import production dotenv.
import { beforeAll, afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp, tokenHash } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';

const db=new PrismaClient({datasources:{db:{url:validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)}}});
const password=randomBytes(24).toString('base64url');
let app,center,child,device,admin;
beforeAll(async()=>{
 await assertTestDatabase(db);
 center=await db.center.create({data:{name:`Synthetic supervisor smoke ${randomUUID()}`}});
 child=await db.child.create({data:{name:'Synthetic supervisor child',centerId:center.id}});
 device=await db.device.create({data:{hardwareId:`SYNTHETIC-SMOKE-${randomUUID()}`,centerId:center.id,tokenHash:tokenHash(randomBytes(32).toString('hex'))}});
 admin=await db.user.create({data:{username:`synthetic-smoke-admin-${randomUUID()}`,role:'ADMIN',centerId:center.id,passwordHash:await bcrypt.hash(password,4)}});
 app=createApp({db,jwtSecret:randomBytes(48).toString('hex'),registrationEnabled:true,publicRegistrationCenterIds:[center.id],logger:{error(){}}});
});
afterAll(async()=>{await db.$disconnect();});
it('persists registration, independent approvals and shared Teacher/Parent/Admin attendance with synthetic fixtures',async()=>{
 await assertTestDatabase(db);
 const login=async username=>{
  const response=await request(app).post('/api/v1/auth/login').send({username,password});
  expect(response.status).toBe(200);return `Bearer ${response.body.data.token}`;
 };
 const adminAuth=await login(admin.username);
 const code=await request(app).post(`/api/v1/admin/devices/${device.id}/claim-code`).set('Authorization',adminAuth).send({});
 expect(code.status).toBe(201);
 const accounts={};
 for(const role of ['TEACHER','PARENT']){
  const receipt=randomBytes(32).toString('hex'),username=`synthetic-smoke-${role.toLowerCase()}-${randomUUID()}`;
  const response=await request(app).post('/api/v1/registration').set('X-Registration-Receipt',receipt).send({
   fullName:`Synthetic ${role}`,username,email:`${randomUUID()}@example.invalid`,phone:'0700000000',password,role,centerId:center.id,acceptTerms:true,
   children:role==='TEACHER'?[]:[{existingChildId:child.id,relationship:'Parent',wearable:{hardwareId:device.hardwareId,claimCode:code.body.data.code}}],
  });
  expect(response.status).toBe(201);expect(response.body.data.status).toBe('PENDING');
  expect((await request(app).post('/api/v1/auth/login').send({username,password})).status).toBe(401);
  expect((await request(app).post(`/api/v1/admin/registrations/${response.body.data.id}/decision`).set('Authorization',adminAuth).send({status:'APPROVED'})).status).toBe(200);
  accounts[role]={auth:await login(username),row:response.body.data};
 }
 const parent=accounts.PARENT,teacher=accounts.TEACHER,enrollment=parent.row.children[0];
 expect((await request(app).get('/api/v1/mobile/children').set('Authorization',parent.auth)).body.data).toEqual([]);
 expect((await request(app).post(`/api/v1/admin/enrollments/${enrollment.id}/decision`).set('Authorization',adminAuth).send({status:'APPROVED'})).status).toBe(200);
 expect((await request(app).post(`/api/v1/admin/wearable-requests/${enrollment.wearable.id}/decision`).set('Authorization',adminAuth).send({status:'APPROVED'})).status).toBe(200);
 expect((await request(app).get(`/api/v1/mobile/children/${child.id}/device`).set('Authorization',parent.auth)).body.data.hardwareId).toBe(device.hardwareId);
 const [clock]=await db.$queryRaw`SELECT clock_timestamp() AS now`;
 const attendance=await db.attendance.create({data:{childId:child.id,day:attendanceDay(clock.now),status:'CHECKIN_PENDING'}});
 expect((await request(app).post(`/api/v1/attendance/${attendance.id}/confirm`).set('Authorization',parent.auth).send({})).status).toBe(403);
 const confirm=await request(app).post(`/api/v1/attendance/${attendance.id}/confirm`).set('Authorization',teacher.auth).send({});
 expect(confirm.status).toBe(200);expect(confirm.body.data.status).toBe('PRESENT');
 expect((await db.attendance.findUnique({where:{id:attendance.id}})).status).toBe('PRESENT');
 const history=await request(app).get(`/api/v1/mobile/children/${child.id}/attendance`).set('Authorization',parent.auth);
 expect(history.status).toBe(200);expect(history.body.data.find(row=>row.id===attendance.id).status).toBe('PRESENT');
 const monitor=await request(app).get('/api/v1/attendance').set('Authorization',adminAuth);
 expect(monitor.body.data.find(row=>row.id===attendance.id).status).toBe('PRESENT');
 const event=await db.deviceEvent.create({data:{eventId:randomUUID(),eventType:'DANGER_ZONE_NEAR',deviceId:device.id,childId:child.id,deviceUptimeMs:0n,payload:{synthetic:true}}});
 const alert=await db.alert.create({data:{eventId:event.id,kind:'SYNTHETIC_DEMO',details:{synthetic:true,description:'Isolated test fixture, not physical hardware'}}});
 const alerts=await request(app).get(`/api/v1/mobile/children/${child.id}/alerts`).set('Authorization',parent.auth);
 expect(alerts.body.data.some(row=>row.id===alert.id)).toBe(true);
 expect((await request(app).get('/api/v1/admin/registrations').set('Authorization',teacher.auth)).status).toBe(403);
});
