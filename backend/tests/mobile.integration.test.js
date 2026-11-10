import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const secret=randomUUID()+randomUUID(),suffix=randomUUID();
const app=createApp({db,jwtSecret:secret,logger:{error(){}}});
const token=user=>jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
let parent,teacher,transport,linked,unlinked,other;
const get=(path,user)=>request(app).get(`/api/v1${path}`).set('Authorization',`Bearer ${token(user)}`);
beforeAll(async()=>{
 await assertTestDatabase(db);
 const center=await db.center.create({data:{name:`mobile-test-${suffix}`}});
 const outside=await db.center.create({data:{name:`outside-${suffix}`}});
 const passwordHash=await bcrypt.hash('Synthetic-test-password',4);
 const user=role=>db.user.create({data:{username:`${role}-${suffix}`,passwordHash,role,centerId:center.id}});
 parent=await user('PARENT');teacher=await user('TEACHER');transport=await user('TRANSPORT');
 linked=await db.child.create({data:{name:'Linked test child',centerId:center.id}});
 unlinked=await db.child.create({data:{name:'Unlinked test child',centerId:center.id}});
 other=await db.child.create({data:{name:'Other center test child',centerId:outside.id}});
 await db.guardian.create({data:{userId:parent.id,childId:linked.id}});
 // A corrupt cross-center guardian link still must not broaden access.
 await db.guardian.create({data:{userId:parent.id,childId:other.id}});
});
afterAll(()=>db.$disconnect());
describe('mobile authorization with isolated PostgreSQL fixtures',()=>{
 it('authenticates parents with real password checks and rejects bad passwords',async()=>{
  const login=await request(app).post('/api/v1/auth/login').send({username:parent.username,password:'Synthetic-test-password'});
  expect(login.status).toBe(200);expect(login.body.data.user.role).toBe('PARENT');
  expect((await request(app).post('/api/v1/auth/login').send({username:parent.username,password:'wrong'})).status).toBe(401);
 });
 it('requires JWT and rejects expired JWT',async()=>{
  expect((await request(app).get('/api/v1/mobile/children')).status).toBe(401);
  const expired=jwt.sign({},secret,{subject:parent.id,issuer:'childguard',audience:'childguard-app',expiresIn:-1});
  expect((await request(app).get('/api/v1/mobile/children').set('Authorization',`Bearer ${expired}`)).status).toBe(401);
 });
 it('lists only linked children within the parent center',async()=>{
  const response=await get('/mobile/children',parent);
  expect(response.status).toBe(200);expect(response.body.data.map(c=>c.id)).toEqual([linked.id]);
 });
 it('enforces ownership on every child resource including guessed IDs',async()=>{
  for(const path of ['', '/attendance','/alerts','/device','/activity']){
   for(const id of [unlinked.id,other.id,randomUUID()]) expect((await get(`/mobile/children/${id}${path}`,parent)).status).toBe(404);
  }
 });
 it('enforces teacher center scope on all child resources',async()=>{
  expect((await get('/mobile/children',teacher)).body.data.map(c=>c.id).sort()).toEqual([linked.id,unlinked.id].sort());
  for(const path of ['', '/attendance','/alerts','/device','/activity']) expect((await get(`/mobile/children/${other.id}${path}`,teacher)).status).toBe(404);
 });
 it('returns genuine empty data and no fabricated device',async()=>{
  expect((await get(`/mobile/children/${linked.id}/attendance`,parent)).body.data).toEqual([]);
  expect((await get(`/mobile/children/${linked.id}/alerts`,parent)).body.data).toEqual([]);
  expect((await get(`/mobile/children/${linked.id}/device`,parent)).body.data).toBeNull();
  const activity=await get(`/mobile/children/${linked.id}/activity`,parent);
  expect(activity.status).toBe(200);expect(activity.body.data.latestMeasurement).toBeNull();
 });
 it('keeps parents outside existing staff and approval endpoints',async()=>{
  for(const path of ['/attendance','/devices','/events','/beacons','/activity/children','/alerts']) expect((await get(path,parent)).status).toBe(403);
  expect((await request(app).post(`/api/v1/attendance/${randomUUID()}/confirm`).set('Authorization',`Bearer ${token(parent)}`).send({})).status).toBe(403);
  expect((await get('/mobile/profile',transport)).status).toBe(403);
 });
 it('validates pagination and identity, and omits sensitive profile fields',async()=>{
  expect((await get('/mobile/children?limit=101',parent)).status).toBe(422);
  expect((await get('/mobile/children/not-a-uuid',parent)).status).toBe(422);
  expect((await get(`/mobile/children/${linked.id}/attendance?day=2026-02-31`,parent)).status).toBe(422);
  const profile=await get('/mobile/profile',parent);
  expect(profile.status).toBe(200);expect(profile.body.data.passwordHash).toBeUndefined();
  expect(profile.body.data.role).toBe('PARENT');
 });
});
