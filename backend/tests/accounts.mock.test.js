import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// No Prisma import or database URL. Transactions and fixtures are memory-only.
let db, app, state, actors, child, outsideChild;
const secret = randomUUID()+randomUUID();
const password = 'Synthetic-private-password';
const token = user => jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const post = (path,body,user=actors.admin) => request(app).post(`/api/v1/admin${path}`).set('Authorization',`Bearer ${token(user)}`).send(body);
beforeEach(() => {
 actors = Object.fromEntries(['ADMIN','TEACHER','PARENT','TRANSPORT'].map(role=>[role.toLowerCase(),{id:randomUUID(),username:`actor-${role}`,role,centerId:'center-a',active:true,passwordHash:'unused'}]));
 const other = {id:randomUUID(),username:'other-parent',role:'PARENT',centerId:'center-b',active:true,passwordHash:'unused'};
 child={id:randomUUID(),name:'Synthetic child',centerId:'center-a'};
 outsideChild={id:randomUUID(),name:'Synthetic outside child',centerId:'center-b'};
 state={users:[...Object.values(actors),other],children:[child,outsideChild],guardians:[],audits:[]};
 const matches = (row,where) => Object.entries(where).every(([key,value])=>typeof value==='object' ? value.in.includes(row[key]) : row[key]===value);
 db={
  user:{
   findUnique:vi.fn(async({where})=>state.users.find(row=>matches(row,where))??null),
   findFirst:vi.fn(async({where})=>state.users.find(row=>matches(row,where))??null),
   findMany:vi.fn(async({where,take,skip})=>state.users.filter(row=>matches(row,where)).slice(skip,skip+take).map(({passwordHash,...row})=>row)),
   create:vi.fn(async({data})=>{const user={id:randomUUID(),...data};state.users.push(user);return user;}),
  },
  child:{
   findMany:vi.fn(async({where})=>state.children.filter(row=>where.centerId===row.centerId&&(!where.id||where.id.in.includes(row.id)))),
   findFirst:vi.fn(async({where})=>state.children.find(row=>row.id===where.id&&row.centerId===where.centerId&&(!where.guardians||state.guardians.some(link=>link.userId===where.guardians.some.userId&&link.childId===row.id)))??null),
  },
  guardian:{
   findUnique:vi.fn(async({where})=>state.guardians.find(row=>matches(row,where.userId_childId))??null),
   create:vi.fn(async({data})=>{state.guardians.push({...data});return data;}),
  },
  auditLog:{create:vi.fn(async({data})=>{state.audits.push({...data});return data;})},
  attendance:{findMany:vi.fn(async()=>[{id:'synthetic-arrival',childId:child.id,day:'2026-10-23',status:'PRESENT',confirmations:[]}])},
 };
 db.$transaction=vi.fn(async work=>{const snapshot=structuredClone(state);try{return await work(db);}catch(error){state=snapshot;throw error;}});
 app=createApp({db,jwtSecret:secret,logger:{error(){}},environment:'test',enableDevAttendanceReset:'false'});
});

describe('center-scoped account provisioning without database fixtures',()=>{
 it('requires JWT before provisioning',async()=>{
  expect((await request(app).post('/api/v1/admin/users').send({})).status).toBe(401);
  expect(db.user.create).not.toHaveBeenCalled();
 });
 it.each(['teacher','parent','transport'])('forbids %s account creation and Guardian changes',async actor=>{
  expect((await post('/users',{},actors[actor])).status).toBe(403);
  expect((await post(`/users/${actors.parent.id}/guardians`,{childIds:[child.id]},actors[actor])).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('creates an active Teacher only in the Admin center with cost-12 bcrypt and audit',async()=>{
  const r=await post('/users',{username:'legitimate-teacher',password,role:'TEACHER'});
  expect(r.status).toBe(201);expect(r.body.data).toMatchObject({username:'legitimate-teacher',role:'TEACHER',centerId:'center-a',active:true,childIds:[]});
  expect(r.body.data).not.toHaveProperty('passwordHash');expect(JSON.stringify(r.body)).not.toContain(password);
  const saved=state.users.find(row=>row.id===r.body.data.id);
  expect(await bcrypt.compare(password,saved.passwordHash)).toBe(true);expect(bcrypt.getRounds(saved.passwordHash)).toBe(12);
  expect(state.audits).toContainEqual({userId:actors.admin.id,resourceId:saved.id,action:'ACCOUNT_PROVISIONED_TEACHER'});
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
 });
 it('creates Parent and approved same-center Guardian links atomically',async()=>{
  const r=await post('/users',{username:'legitimate-parent',password,role:'PARENT',childIds:[child.id]});
  expect(r.status).toBe(201);expect(state.guardians).toEqual([{userId:r.body.data.id,childId:child.id}]);
  expect(state.audits).toHaveLength(2);
  expect(state.audits.every(row=>row.userId===actors.admin.id)).toBe(true);
 });
 it.each([
  {role:'ADMIN'}, {role:'TRANSPORT'}, {role:'TEACHER',centerId:'center-b'},
  {role:'TEACHER',active:false}, {role:'TEACHER',passwordHash:'injected'},
  {role:'TEACHER',password:'short'}, {role:'TEACHER',password:'\u20ac'.repeat(25)},
  {role:'PARENT',childIds:[]},
 ])('rejects privileged/invalid fields before account writes: %j',async patch=>{
  const r=await post('/users',{username:'invalid-account',password,role:'TEACHER',...patch});
  expect(r.status).toBe(422);expect(db.user.create).not.toHaveBeenCalled();
 });
 it('rejects Teacher Guardian assignment, duplicate child IDs and malformed child IDs',async()=>{
  for(const body of [{role:'TEACHER',childIds:[child.id]},{role:'PARENT',childIds:[child.id,child.id]},{role:'PARENT',childIds:['not-uuid']}]){
   expect((await post('/users',{username:'invalid-links',password,...body})).status).toBe(422);
  }
  expect(db.user.create).not.toHaveBeenCalled();
 });
 it('rejects nonexistent or outside-center children without creating a Parent',async()=>{
  for(const id of [outsideChild.id,randomUUID()]) expect((await post('/users',{username:'denied-parent',password,role:'PARENT',childIds:[id]})).status).toBe(404);
  expect(db.user.create).not.toHaveBeenCalled();expect(state.guardians).toEqual([]);
 });
 it('returns safe duplicate-username errors, including a unique race',async()=>{
  expect((await post('/users',{username:actors.teacher.username,password,role:'TEACHER'})).status).toBe(409);
  db.user.create.mockRejectedValue(Object.assign(new Error('private DB detail'),{code:'P2002'}));
  const r=await post('/users',{username:'race-teacher',password,role:'TEACHER'});
  expect(r.status).toBe(409);expect(r.body.error.code).toBe('USERNAME_EXISTS');expect(JSON.stringify(r.body)).not.toContain('private DB detail');
 });
 it('rolls back account and links when required audit persistence fails',async()=>{
  const count=state.users.length;
  db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
  expect((await post('/users',{username:'rollback-parent',password,role:'PARENT',childIds:[child.id]})).status).toBe(503);
  expect(state.users).toHaveLength(count);expect(state.guardians).toEqual([]);expect(state.audits).toEqual([]);
 });
 it('adds approved Parent links idempotently with exactly one audit',async()=>{
  const path=`/users/${actors.parent.id}/guardians`;
  expect((await post(path,{childIds:[child.id]})).body.data.linked).toBe(1);
  expect((await post(path,{childIds:[child.id]})).body.data.linked).toBe(0);
  expect(state.guardians).toHaveLength(1);expect(state.audits).toHaveLength(1);
 });
 it('rejects linking a Teacher, inactive Parent, outside Parent or outside child',async()=>{
  const outside=state.users.find(row=>row.centerId==='center-b');
  for(const id of [actors.teacher.id,outside.id]) expect((await post(`/users/${id}/guardians`,{childIds:[child.id]})).status).toBe(404);
  expect((await post(`/users/${actors.parent.id}/guardians`,{childIds:[outsideChild.id]})).status).toBe(404);
  state.users.find(row=>row.id===actors.parent.id).active=false;
  expect((await post(`/users/${actors.parent.id}/guardians`,{childIds:[child.id]})).status).toBe(404);
  expect(state.guardians).toEqual([]);
 });
 it('lists only non-Admin accounts in the authenticated center without hashes',async()=>{
  const r=await request(app).get('/api/v1/admin/users?role=PARENT').set('Authorization',`Bearer ${token(actors.admin)}`);
  expect(r.status).toBe(200);expect(r.body.data.map(row=>row.id)).toEqual([actors.parent.id]);
  expect(JSON.stringify(r.body)).not.toContain('passwordHash');
 });
 it('provisioned Parent uses normal login and sees updated attendance only for linked children',async()=>{
  const created=await post('/users',{username:'flow-parent',password,role:'PARENT',childIds:[child.id]});expect(created.status).toBe(201);
  const login=await request(app).post('/api/v1/auth/login').send({username:'flow-parent',password});expect(login.status).toBe(200);
  const auth=`Bearer ${login.body.data.token}`;
  expect((await request(app).get(`/api/v1/mobile/children/${child.id}/attendance`).set('Authorization',auth)).body.data[0].status).toBe('PRESENT');
  expect((await request(app).get(`/api/v1/mobile/children/${outsideChild.id}/attendance`).set('Authorization',auth)).status).toBe(404);
  expect((await request(app).post('/api/v1/admin/users').set('Authorization',auth).send({})).status).toBe(403);
 });
});
