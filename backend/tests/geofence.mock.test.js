import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp, tokenHash } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
const secret='synthetic-geofence-secret-with-over-32-characters',password='Synthetic-review-password',hash=bcrypt.hashSync(password,4);
let f,m,app,cookie,csrf;
const http=(method,path='/api/v1/safe-zones')=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
const bearer=user=>'Bearer '+jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash('synthetic-device-secret')});
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const p=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:p.database,adminAuthRouter:p.router,jwtSecret:secret,environment:'test',registrationEnabled:false,logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(r.status).toBe(200);cookie=r.headers['set-cookie'][0].split(';')[0];csrf=r.body.data.csrfToken;
});
it('starts with no SafeZone client or table and returns unavailable, never an invented empty inventory',async()=>{
 const r=await http('get');expect(r.status).toBe(200);expect(r.body.data).toMatchObject({configurationAvailable:false,monitoringAvailable:false,zones:null,limits:{minRadiusM:50,maxRadiusM:5000}});expect(r.headers['cache-control']).toBe('no-store');expect(m.db.safeZone).toBeUndefined();expect(m.db.$transaction).not.toHaveBeenCalled();
});
it('never allows configuration writes or forged activation flags, even with valid session and CSRF',async()=>{
 const before=structuredClone(f.state.domain);for(const method of ['post','patch','put','delete'])for(const path of ['/api/v1/safe-zones','/api/v1/safe-zones/foreign-zone']){const r=await http(method,path).set('X-CSRF-Token',csrf).send({enabled:true,centerId:'foreign',active:true});expect(r.status).toBe(503);expect(r.body.error.code).toBe('GEOFENCE_UNAVAILABLE');}
 expect(f.state.domain).toEqual(before);expect(m.db.$transaction).not.toHaveBeenCalled();expect(m.db.auditLog.create).not.toHaveBeenCalled();
});
it('preserves CSRF, Origin, missing-session and expiry rejection before any mutation',async()=>{
 expect((await http('post').send({})).status).toBe(403);
 expect((await http('post').set('Origin','http://untrusted.invalid').set('X-CSRF-Token',csrf).send({})).status).toBe(403);
 expect((await http('post').set('Cookie','').set('X-CSRF-Token',csrf).send({})).status).toBe(401);
 f.tick(300000);expect((await http('post').set('X-CSRF-Token',csrf).send({})).status).toBe(401);expect(m.db.$transaction).not.toHaveBeenCalled();
});
it.each(['PARENT','TEACHER'])('preserves %s JWT compatibility but forbids zone access and modification',async role=>{
 const user=role==='PARENT'?m.parent:m.teacher;expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer(user))).status).toBe(200);
 for(const method of ['get','post'])expect((await request(app)[method]('/api/v1/safe-zones').set('Authorization',bearer(user)).send({})).status).toBe(403);
});
it('refuses legacy Admin JWT and does not allow forged device tokens to configure zones',async()=>{
 expect((await request(app).get('/api/v1/safe-zones').set('Authorization',bearer(f.state.user))).status).toBe(401);
 expect((await http('post').set('Cookie','').set('X-Device-Token','synthetic-device-secret').send({})).status).toBe(401);
});
it('readiness polling never renews the 300-second inactivity deadline or touches attendance',async()=>{
 const before=structuredClone(f.state.sessions[0]);for(let i=0;i<4;i++){f.tick(60000);expect((await http('get')).status).toBe(200);}expect(f.state.sessions[0]).toEqual(before);f.tick(60000);expect((await http('get')).status).toBe(401);expect(m.data().attendance).toEqual([]);expect(m.data().alert).toEqual([]);
});
