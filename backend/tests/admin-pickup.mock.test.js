import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
import { pickupMemory } from './helpers/pickup-memory.js';

const secret='synthetic-admin-pickup-secret-more-than-32',password='Synthetic-pickup-admin-password',hash=bcrypt.hashSync(password,4);
let app,f,m,p,cookie,csrf,rows;
const get=path=>request(app).get('/api/v1/admin/pickups'+path).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
const token=user=>jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:'unused'});p=pickupMemory(m,f,vi);
 const photo={id:randomUUID(),childId:m.child.id,centerId:'center-a',mime:'image/png',bytes:Buffer.from([137,80,78,71])};m.data().pickupPhoto.push(photo);
 rows=['PENDING','COMPLETED','CANCELLED','EXPIRED','REJECTED'].map((status,index)=>({id:randomUUID(),childId:m.child.id,centerId:'center-a',personId:randomUUID(),requestedById:m.parent.id,photoId:photo.id,snapshot:{fullName:'Historical pickup person',address:'Saved address',phone:'077 123 4567',relationship:'Grandparent',code:'must-not-return'},day:'2026-10-25',windowStart:new Date(f.clock),windowEnd:new Date(f.clock+3600000),expiresAt:new Date(f.clock+60000),status,completedAt:status==='COMPLETED'?new Date(f.clock):null,reviewedById:status==='COMPLETED'?m.teacher.id:null,createdAt:new Date(f.clock-index),codeHash:'private-verifier',codeSalt:'private-salt',handoverHash:'private-proof'}));
 m.data().pickupRequest.push(...rows);
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',logger:{error:vi.fn()}});
 const login=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(login.status).toBe(200);cookie=login.headers['set-cookie'][0].split(';')[0];csrf=login.body.data.csrfToken;
});
it('reads existing request snapshots, Parent and confirming Teacher with accurate center/day totals',async()=>{
 const r=await get('?day=2026-10-25');expect(r.status).toBe(200);expect(r.body.data.rows).toHaveLength(5);
 expect(r.body.data.summary).toEqual({PENDING:1,COMPLETED:1,CANCELLED:1,EXPIRED:1,REJECTED:1,total:5});
 expect(r.body.data.rows[1].reviewedBy).toMatchObject({id:m.teacher.id});expect(r.body.data.rows[0].requestedBy).toMatchObject({id:m.parent.id});
 expect(r.body.data.rows[0].person.fullName).toBe('Historical pickup person');expect(r.headers['cache-control']).toBe('no-store');
 expect(JSON.stringify(r.body)).not.toMatch(/codeHash|codeSalt|handoverHash|private-verifier|private-salt|private-proof|must-not-return|bytes/);
 expect(m.db.pickupRequest.findMany.mock.calls[0][0]).toMatchObject({take:26,orderBy:[{createdAt:'desc'},{id:'desc'}]});
});
it('derives expiry without modifying stored rows and filters PENDING/EXPIRED consistently',async()=>{
 rows[0].expiresAt=new Date(f.clock);
 const expired=await get('?status=EXPIRED');expect(expired.body.data.rows).toHaveLength(2);expect(expired.body.data.rows.every(r=>r.status==='EXPIRED')).toBe(true);
 const pending=await get('?status=PENDING');expect(pending.body.data.rows).toEqual([]);expect(pending.body.data.summary).toMatchObject({PENDING:0,EXPIRED:2,total:5});
 expect(rows[0].status).toBe('PENDING');expect(m.db.pickupRequest.updateMany).not.toHaveBeenCalled();
});
it('supports day/history and deterministic bounded pagination',async()=>{
 const first=await get('?limit=2');expect(first.body.data.rows).toHaveLength(2);expect(first.body.data.hasMore).toBe(true);
 expect((await get('?limit=2&offset=4')).body.data.hasMore).toBe(false);
 expect((await get('?day=2026-10-24')).body.data.summary.total).toBe(0);
});
it('rejects foreign-center request IDs, child-center mismatches and photographs',async()=>{
 const foreign={...rows[0],id:randomUUID(),centerId:'center-b',childId:m.foreignChild.id};m.data().pickupRequest.push(foreign);
 expect((await get('')).body.data.rows).toHaveLength(5);expect((await get('/'+foreign.id)).status).toBe(404);expect((await get('/'+foreign.id+'/photo')).status).toBe(404);
 rows[0].photoId=randomUUID();expect((await get('/'+rows[0].id+'/photo')).status).toBe(404);
 rows[1].childId=m.foreignChild.id;expect((await get('/'+rows[1].id)).status).toBe(404);
});
it('serves only the request-bound private photo and no image bytes in list/detail JSON',async()=>{
 const photo=await get('/'+rows[0].id+'/photo');expect(photo.status).toBe(200);expect(photo.headers['content-type']).toContain('image/png');expect(photo.headers['cache-control']).toBe('no-store');expect(photo.headers['content-security-policy']).toContain('sandbox');
 expect((await get('/'+rows[0].id)).body.data.photoAvailable).toBe(true);
});
it.each(['PARENT','TEACHER'])('denies %s JWTs access to Admin requests, details and photos',async role=>{
 const actor=role==='PARENT'?m.parent:m.teacher;
 for(const path of ['',`/${rows[0].id}`,`/${rows[0].id}/photo`])expect((await request(app).get('/api/v1/admin/pickups'+path).set('Authorization','Bearer '+token(actor))).status).toBe(403);
});
it('rejects missing/revoked/expired sessions and refuses an Admin JWT fallback',async()=>{
 expect((await request(app).get('/api/v1/admin/pickups').set('Host','localhost:5174').set('Origin','http://localhost:5174')).status).toBe(401);
 expect((await request(app).get('/api/v1/admin/pickups').set('Authorization','Bearer '+token(f.state.user))).status).toBe(401);
 f.tick(300000);expect((await get('')).status).toBe(401);
});
it('does not renew inactivity or give Admin any handover/verification shortcut',async()=>{
 const activity=f.updates;await get('');await get('/'+rows[0].id+'/photo');expect(f.updates).toBe(activity);
 const r=await request(app).post('/api/v1/mobile/pickups/requests/'+rows[0].id+'/complete').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});expect(r.status).toBe(403);
 const shortcut=await request(app).post('/api/v1/admin/pickups/'+rows[0].id+'/complete').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});expect(shortcut.status).toBe(404);
 expect(m.db.pickupRequest.update).not.toHaveBeenCalled();
});
it('fails closed when storage/client is unavailable and never substitutes example records',async()=>{
 p.uninstall();const r=await get('');expect(r.status).toBe(503);expect(r.body.error.code).toBe('PICKUP_NOT_INSTALLED');expect(r.body).not.toHaveProperty('data');
});
it('denies a revoked session photo without returning private image bytes',async()=>{
 f.state.sessions[0].revokedAt=new Date(f.clock);
 expect((await get('/'+rows[0].id+'/photo')).status).toBe(401);
});
it('fails closed when the generated client lacks pickup delegates',async()=>{
 delete m.db.pickupRequest;
 const r=await get('');expect(r.status).toBe(503);expect(r.body.error.code).toBe('PICKUP_NOT_INSTALLED');
});
it('does not disclose the current identity of an actor who has moved to another center',async()=>{
 m.data().user.find(user=>user.id===m.teacher.id).centerId='center-b';
 const r=await get('/'+rows[1].id);expect(r.status).toBe(200);expect(r.body.data.reviewedBy).toBeNull();
});
it.each(['status=APPROVED','limit=51','offset=-1','day=bad','centerId=center-b'])('rejects invalid or client-selected scope: %s',async query=>{expect((await get('?'+query)).status).toBe(422);});
