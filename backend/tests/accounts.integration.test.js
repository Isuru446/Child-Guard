import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { attendanceDay } from '../src/events.js';

// Two independent guards precede every fixture write. Never load application .env.
validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const app = createApp({db,jwtSecret:randomUUID()+randomUUID(),logger:{error(){}},environment:'test',enableDevAttendanceReset:'false'});
const suffix=randomUUID(),password='Synthetic-isolated-password';
let adminAuth,teacherAuth,parentAuth,outsideAuth,child,outsideChild,parentId,teacherId,adminId;
const login=async username=>{
 const response=await request(app).post('/api/v1/auth/login').send({username,password});
 expect(response.status).toBe(200);return `Bearer ${response.body.data.token}`;
};
beforeAll(async()=>{
 await assertTestDatabase(db);
 const center=await db.center.create({data:{name:`account-isolated-${suffix}`}});
 const outside=await db.center.create({data:{name:`outside-isolated-${suffix}`}});
 child=await db.child.create({data:{name:'Synthetic isolated child',centerId:center.id}});
 outsideChild=await db.child.create({data:{name:'Synthetic outside child',centerId:outside.id}});
 const passwordHash=await bcrypt.hash(password,4);
 adminId=(await db.user.create({data:{username:`admin-${suffix}`,passwordHash,role:'ADMIN',centerId:center.id}})).id;
 await db.user.create({data:{username:`outside-teacher-${suffix}`,passwordHash,role:'TEACHER',centerId:outside.id}});
 adminAuth=await login(`admin-${suffix}`);outsideAuth=await login(`outside-teacher-${suffix}`);
});
afterAll(()=>db.$disconnect());
describe('isolated persisted account and cross-client attendance flow',()=>{
 it('provisions and authenticates a real isolated Parent with an approved Guardian link',async()=>{
  const r=await request(app).post('/api/v1/admin/users').set('Authorization',adminAuth).send({username:`parent-${suffix}`,password,role:'PARENT',childIds:[child.id]});
  expect(r.status).toBe(201);parentId=r.body.data.id;
  expect(r.body.data).not.toHaveProperty('passwordHash');
  expect(JSON.stringify(r.body)).not.toContain(password);
  const saved=await db.user.findUnique({where:{id:parentId}});
  expect(saved.passwordHash).not.toBe(password);
  expect(await bcrypt.compare(password,saved.passwordHash)).toBe(true);
  expect(bcrypt.getRounds(saved.passwordHash)).toBe(12);
  expect(await db.auditLog.count({where:{userId:adminId,resourceId:parentId,action:'ACCOUNT_PROVISIONED_PARENT'}})).toBe(1);
  expect(await db.auditLog.count({where:{userId:adminId,resourceId:child.id,action:`GUARDIAN_LINK_CREATED:${parentId}`}})).toBe(1);
  expect(await db.guardian.count({where:{userId:parentId,childId:child.id}})).toBe(1);
  parentAuth=await login(`parent-${suffix}`);
  const denied=await request(app).get(`/api/v1/mobile/children/${outsideChild.id}`).set('Authorization',parentAuth);expect(denied.status).toBe(404);
 });
 it('provisions and authenticates a real isolated Teacher in the Admin center',async()=>{
  const r=await request(app).post('/api/v1/admin/users').set('Authorization',adminAuth).send({username:`teacher-${suffix}`,password,role:'TEACHER'});
  expect(r.status).toBe(201);teacherId=r.body.data.id;teacherAuth=await login(`teacher-${suffix}`);
  const saved=await db.user.findUnique({where:{id:teacherId}});
  expect(saved.centerId).toBe(child.centerId);
  expect(await bcrypt.compare(password,saved.passwordHash)).toBe(true);
  expect(await db.auditLog.count({where:{resourceId:teacherId,action:'ACCOUNT_PROVISIONED_TEACHER'}})).toBe(1);
  const roster=await request(app).get('/api/v1/mobile/children').set('Authorization',teacherAuth);
  expect(roster.body.data.map(row=>row.id)).toEqual([child.id]);
 });
 it('persists Teacher confirmation once and exposes the same PRESENT record to Parent and Admin',async()=>{
  const [clock]=await db.$queryRaw`SELECT clock_timestamp() AS now`;
  const pending=await db.attendance.create({data:{childId:child.id,day:attendanceDay(clock.now),status:'CHECKIN_PENDING'}});
  const path=`/api/v1/attendance/${pending.id}/confirm`;
  expect((await request(app).post(path).set('Authorization',outsideAuth).send({})).status).toBe(404);
  expect((await request(app).post(path).set('Authorization',parentAuth).send({})).status).toBe(403);
  for(let attempt=0;attempt<2;attempt++)expect((await request(app).post(path).set('Authorization',teacherAuth).send({})).body.data.status).toBe('PRESENT');
  expect(await db.confirmation.count({where:{attendanceId:pending.id}})).toBe(1);
  expect(await db.auditLog.count({where:{resourceId:pending.id,action:'ATTENDANCE_CONFIRMED_TEACHER'}})).toBe(1);
  const history=await request(app).get(`/api/v1/mobile/children/${child.id}/attendance`).set('Authorization',parentAuth);
  expect(history.body.data.find(row=>row.id===pending.id).status).toBe('PRESENT');
  const admin=await request(app).get('/api/v1/attendance').set('Authorization',adminAuth);
  expect(admin.body.data.find(row=>row.id===pending.id).status).toBe('PRESENT');
 });
 it('rejects cross-center provisioning without leaving an account or Guardian',async()=>{
  const username=`denied-parent-${suffix}`;
  expect((await request(app).post('/api/v1/admin/users').set('Authorization',adminAuth).send({username,password,role:'PARENT',childIds:[outsideChild.id]})).status).toBe(404);
  expect(await db.user.count({where:{username}})).toBe(0);
 });
 it('rejects duplicate usernames and returns only sanitized same-center users',async()=>{
  const r=await request(app).post('/api/v1/admin/users').set('Authorization',adminAuth).send({username:`parent-${suffix}`,password,role:'PARENT',childIds:[child.id]});
  expect(r.status).toBe(409);
  expect(await db.user.count({where:{username:`parent-${suffix}`}})).toBe(1);
  const list=await request(app).get('/api/v1/admin/users').set('Authorization',adminAuth);
  expect(list.status).toBe(200);
  expect(list.body.data.every(user=>user.centerId===child.centerId&&!('passwordHash' in user))).toBe(true);
 });
 it('rejects non-Admin account creation and Guardian changes before writes',async()=>{
  for(const auth of [parentAuth,teacherAuth,outsideAuth]) {
   expect((await request(app).post('/api/v1/admin/users').set('Authorization',auth).send({})).status).toBe(403);
   expect((await request(app).post(`/api/v1/admin/users/${parentId}/guardians`).set('Authorization',auth).send({childIds:[child.id]})).status).toBe(403);
  }
  expect((await request(app).get('/api/v1/admin/users')).status).toBe(401);
 });
 it('rejects role escalation and injected center fields without creating users',async()=>{
  for(const patch of [{role:'ADMIN'},{centerId:outsideChild.centerId},{active:false}]) {
   const username=`invalid-${randomUUID()}`;
   expect((await request(app).post('/api/v1/admin/users').set('Authorization',adminAuth).send({username,password,role:'TEACHER',...patch})).status).toBe(422);
   expect(await db.user.count({where:{username}})).toBe(0);
  }
 });
 it('adds Guardian links idempotently and rejects invalid roles and centers atomically',async()=>{
  // A fresh synthetic Admin keeps independent validation cases below the real write rate limit.
  const actor=await db.user.create({data:{username:`link-admin-${suffix}`,role:'ADMIN',centerId:child.centerId,passwordHash:await bcrypt.hash(password,4)}});
  const auth=await login(actor.username);
  const path=`/api/v1/admin/users/${parentId}/guardians`;
  const second=await db.child.create({data:{name:'Synthetic second linked child',centerId:child.centerId}});
  const post=(route,childIds)=>request(app).post(route).set('Authorization',auth).send({childIds});
  expect((await post(path,[second.id,outsideChild.id])).status).toBe(404);
  expect(await db.guardian.count({where:{userId:parentId,childId:second.id}})).toBe(0);
  expect((await post(`/api/v1/admin/users/${teacherId}/guardians`,[second.id])).status).toBe(404);
  expect((await post(path,[second.id])).body.data.linked).toBe(1);
  expect((await post(path,[second.id])).body.data.linked).toBe(0);
  expect(await db.auditLog.count({where:{resourceId:second.id,action:`GUARDIAN_LINK_CREATED:${parentId}`}})).toBe(1);
 });
 it('rolls back persisted account and Guardian writes when audit persistence fails',async()=>{
  // Inject failure only at the audit delegate; the surrounding Prisma transaction is real.
  const failingDb=new Proxy(db,{get(target,key){
   if(key==='$transaction')return (work,options)=>target.$transaction(tx=>work(new Proxy(tx,{get(client,name){
    if(name==='auditLog')return {create:async()=>{throw new Error('Synthetic audit failure');}};
    return client[name];
   }})),options);
   return target[key];
  }});
  const failingApp=createApp({db:failingDb,jwtSecret:'isolated-rollback-secret-at-least-32-characters',logger:{error(){}},environment:'test'});
  const actor=await db.user.findUnique({where:{id:adminId}});
  const auth=await request(failingApp).post('/api/v1/auth/login').send({username:actor.username,password});
  expect(auth.status).toBe(200);
  const username=`rollback-${suffix}`;
  const before={users:await db.user.count(),guardians:await db.guardian.count(),audits:await db.auditLog.count()};
  const r=await request(failingApp).post('/api/v1/admin/users').set('Authorization',`Bearer ${auth.body.data.token}`).send({username,password,role:'PARENT',childIds:[child.id]});
  expect(r.status).toBe(503);
  expect(await db.user.count({where:{username}})).toBe(0);
  expect(await db.user.count()).toBe(before.users);
  expect(await db.guardian.count()).toBe(before.guardians);
  expect(await db.auditLog.count()).toBe(before.audits);
 });
});
