import { beforeEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { prepareAdminSessionCutover, legacyMobileBridge } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { mountAccountRoutes } from '../src/accounts.js';
import { adminWriteInventory } from '../src/admin-session-write-boundary.js';
const secret='synthetic-cutover-key-at-least-32-characters',password='Synthetic-cutover-password',passwordHash=bcrypt.hashSync(password,4);
const transport=adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'});
let f,app,base,expireDuringInsert,isolation;
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
async function adminLogin(){const r=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(r.status).toBe(200);return {cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.data.csrfToken};}
beforeEach(()=>{
 f=sessionFixture();f.state.user.passwordHash=passwordHash;expireDuringInsert=false;isolation=[];
 const mobileUsers=['PARENT','TEACHER'].map(role=>({id:randomUUID(),username:role.toLowerCase(),passwordHash,role,active:true,centerId:'mobile-center'}));
 base={user:{findUnique:async({where})=>[f.state.user,...mobileUsers].find(u=>where.id?u.id===where.id:u.username===where.username)||null},$transaction:async work=>work({legacy:true})};
 const original=f.repository.forCredential;
 f.repository.forCredential=(hash,work,level)=>{isolation.push(level);return original(hash,tx=>{
  tx.db={user:{findUnique:async()=>null,create:async({data})=>{const row={id:randomUUID(),...data};f.state.domain.push(row);if(expireDuringInsert)f.tick(300000);return row;}},auditLog:{create:async({data})=>{f.state.domain.push({audit:data});return data;}}};
  return work(tx);
 },level);};
 const prepared=prepareAdminSessionCutover({db:base,service:f.service,transport,jwtSecret:secret,absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=express();app.use(express.json());app.use(prepared.router);
 const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 mountAccountRoutes(app,{db:prepared.database,asyncRoute});
 app.get('/api/v1/mobile-compatible',(req,res)=>res.json({data:req.user}));
 app.post('/api/v1/unreviewed',asyncRoute(async(req,res)=>{await prepared.database.$transaction(async tx=>tx.user.create({data:{username:'unexpected'}}),{isolationLevel:'Serializable'});res.json({data:true});}));
 app.use((e,req,res,next)=>res.status(e.status||503).json({error:{code:e.code||'SERVICE_UNAVAILABLE',message:e.status?e.message:'Unavailable'}}));
});
it('executes the actual existing account handler in the session transaction, preserving Serializable',async()=>{
 const a=await adminLogin();const r=await http('post','/api/v1/admin/users').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).send({username:'new-teacher',password,role:'TEACHER'});
 expect(r.status).toBe(201);expect(f.state.domain[0]).toMatchObject({centerId:'center-a',active:true,role:'TEACHER'});expect(f.state.domain[1].audit.action).toBe('ACCOUNT_PROVISIONED_TEACHER');expect(isolation).toContain('Serializable');
});
it('expiration inside an existing handler rolls back both domain and audit writes',async()=>{
 const a=await adminLogin();expireDuringInsert=true;
 const r=await http('post','/api/v1/admin/users').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).send({username:'new-teacher',password,role:'TEACHER'});
 expect(r.status).toBe(401);expect(r.body.error.code).toBe('SESSION_EXPIRED');expect(f.state.domain).toEqual([]);
});
it.each(['parent','teacher'])('preserves existing %s login and bearer /me without Origin or cookies',async username=>{
 const login=await request(app).post('/api/v1/auth/login').send({username,password});expect(login.status).toBe(200);expect(login.body.data.expiresIn).toBe(3600);expect(login.headers['set-cookie']).toBeUndefined();
 const me=await request(app).get('/api/v1/auth/me').set('Authorization','Bearer '+login.body.data.token);expect(me.status).toBe(200);expect(me.body.data.role).toBe(username.toUpperCase());expect(me.body.data).not.toHaveProperty('csrfToken');
 const denied=await request(app).get('/api/v1/admin/users').set('Authorization','Bearer '+login.body.data.token);expect(denied.status).toBe(403);
});
it('rejects old Admin JWTs, including valid signed ones, rather than falling back',async()=>{
 const token=jwt.sign({},secret,{subject:f.state.user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 const r=await request(app).get('/api/v1/mobile-compatible').set('Authorization','Bearer '+token);expect(r.status).toBe(401);
});
it('never issues an Admin bearer from a clientKind hint and keeps Admin login CSRF checks',async()=>{
 expect((await request(app).post('/api/v1/auth/login').send({username:'admin',password})).status).toBe(403);
 expect((await http('post','/api/v1/auth/login').send({username:'admin',password,clientKind:'MOBILE'})).status).toBe(422);
});
it('unknown cookie-authenticated writers fail closed before domain work',async()=>{
 const a=await adminLogin();const r=await http('post','/api/v1/unreviewed').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).send({});expect(r.status).toBe(503);expect(f.state.domain).toEqual([]);
});
it('eight-hour policy has no implicit owner acceptance',()=>{
 expect(()=>prepareAdminSessionCutover({db:base,service:f.service,transport,jwtSecret:secret})).toThrow();
});
it('the temporary mobile bridge denies a formerly mobile user who is now ADMIN',async()=>{
 const bridge=legacyMobileBridge({db:{user:{findUnique:async()=>f.state.user}},jwtSecret:secret});
 const token=jwt.sign({},secret,{subject:f.state.user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 await expect(bridge.authenticate('Bearer '+token)).rejects.toMatchObject({status:401});
});
it('inventory explicitly includes every Admin database writer and excludes public/device/parent-only writes',()=>{
 expect(adminWriteInventory).toHaveLength(27);for(const path of ['/api/v1/admin/devices','/api/v1/admin/devices/:id/assignment','/api/v1/admin/devices/:id/unassign'])expect(adminWriteInventory.find(r=>r.path===path&&r.method==='POST')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/admin/devices/:id/status'&&r.method==='PATCH')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/admin/children'&&r.method==='POST')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/admin/users/:id/guardians'&&r.method==='DELETE')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/admin/users/:id/profile'&&r.method==='PATCH')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/account/photo')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/account/password')).toBeTruthy();expect(adminWriteInventory.find(r=>r.path==='/api/v1/registration')).toBeUndefined();
});
