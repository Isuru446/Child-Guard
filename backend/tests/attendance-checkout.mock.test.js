import {beforeEach,expect,it,vi} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
import {createApp,tokenHash} from '../src/app.js';
import {attendanceDay} from '../src/events.js';
import {verifiedDeparture} from '../src/zone-monitoring.js';
import {CHECKOUT_ACTION} from '../src/attendance-checkout.js';
import {createMonitoringHub} from '../src/monitoring-events.js';
import {prepareAdminSessionCutover} from '../src/admin-session-cutover.js';
import {adminCookieTransport} from '../src/admin-session-http.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
const secret='synthetic-checkout-secret-at-least-32',password='Synthetic-password-123',hash=bcrypt.hashSync(password,4);
let f,m,app,a,confirmation,pending,cookie,csrf,notices;
const bearer=u=>'Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const body=extra=>({confirmedAt:confirmation.confirmedAt.toISOString(),departureConfirmed:true,...extra});
const post=(extra={},actor=m.teacher,id=a.id)=>request(app).post(`/api/v1/attendance/${id}/checkout`).set('Authorization',bearer(actor)).send(body(extra));
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash('synthetic-device-token')});pending=null;notices=[];
 a={id:randomUUID(),childId:m.child.id,day:attendanceDay(new Date(f.clock)),status:'PRESENT',gatePassAuthorized:false};confirmation={id:randomUUID(),attendanceId:a.id,userId:m.teacher.id,confirmedAt:new Date(f.clock-20000)};
 m.data().attendance.push(a);m.data().confirmation.push(confirmation);m.data().activityAttendanceSession.push({id:randomUUID(),attendanceId:a.id,endedAt:null});
 m.db.activityAttendanceSession.updateMany=vi.fn(async({where,data})=>{const rows=m.data().activityAttendanceSession.filter(s=>s.attendanceId===where.attendanceId&&!s.endedAt);rows.forEach(s=>Object.assign(s,data));return {count:rows.length};});
 m.db.pickupRequest={findFirst:vi.fn(async()=>pending&&+pending.expiresAt>f.clock?pending:null),findMany:vi.fn(async()=>pending&&+pending.expiresAt>f.clock?[pending]:[])};
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 const hub=createMonitoringHub();hub.subscribe(m.device.centerId,event=>{expect(m.data().attendance[0].status).toBe('CHECKED_OUT');notices.push(event);});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 const login=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});cookie=login.headers['set-cookie'][0].split(';')[0];csrf=login.body.data.csrfToken;
});
it('checks out only a Teacher-confirmed Present child, preserves confirmation and closes activity',async()=>{
 const result=await post();expect(result.status).toBe(200);expect(result.body.data.status).toBe('CHECKED_OUT');expect(result.body.data.checkout.by.id).toBe(m.teacher.id);
 expect(m.data().confirmation).toEqual([confirmation]);expect(m.data().auditLog.filter(l=>l.action.startsWith(CHECKOUT_ACTION))).toHaveLength(1);expect(m.data().activityAttendanceSession[0].endedAt).toEqual(new Date(f.clock));
 expect(notices).toHaveLength(1);expect(notices[0].topics).toContain('attendance');
 expect(await verifiedDeparture(m.db,{device:m.device,assignment:m.data().assignment[0],attendance:m.data().attendance[0],confirmation,boot:'same-boot'})).toBeNull();
});
it('serializes concurrent retries into one checkout and one audit record',async()=>{
 const results=await Promise.all([post(),post()]);expect(results.every(r=>r.status===200)).toBe(true);expect(results.filter(r=>r.body.data.duplicate)).toHaveLength(1);expect(m.data().auditLog.filter(l=>l.action.startsWith(CHECKOUT_ACTION))).toHaveLength(1);
});
it('denies Parent and foreign-center Teacher requests',async()=>{
 expect((await post({},m.parent)).status).toBe(403);expect((await post({},m.otherTeacher)).status).toBe(404);expect(m.data().attendance[0].status).toBe('PRESENT');
});
it('denies Admin checkout even with a valid cookie and CSRF; no Teacher authority is granted',async()=>{
 const r=await request(app).post(`/api/v1/attendance/${a.id}/checkout`).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',csrf).send(body());expect(r.status).toBe(403);expect(m.data().attendance[0].status).toBe('PRESENT');
});
it.each(['CHECKIN_PENDING','NOT_CHECKED_IN','CHECKED_OUT'])('rejects %s without changing history',async status=>{
 m.data().attendance[0].status=status;expect((await post()).status).toBe(409);expect(m.data().auditLog).toHaveLength(0);
});
it('rejects missing confirmation, yesterday and mismatched confirmation/reset versions',async()=>{
 expect((await post({confirmedAt:new Date(f.clock-30000).toISOString()})).status).toBe(409);
 m.data().auditLog.push({id:'epoch-new',resourceId:a.id,userId:m.teacher.id,action:'ATTENDANCE_DEV_RESET',createdAt:new Date(f.clock-1000)});expect((await post()).status).toBe(409);
 m.data().auditLog.length=0;m.data().attendance[0].day='2026-10-24';expect((await post()).status).toBe(409);
 m.data().attendance[0].day=attendanceDay(new Date(f.clock));m.data().confirmation.length=0;expect((await post()).status).toBe(409);
});
it('requires explicit departure acknowledgement and rejects injected fields',async()=>{
 expect((await post({departureConfirmed:false})).status).toBe(422);expect((await post({role:'ADMIN'})).status).toBe(422);expect(m.data().auditLog).toHaveLength(0);
});
it('blocks pending Pickup without verifying or completing it; expired requests do not block',async()=>{
 pending={childId:m.child.id,status:'PENDING',expiresAt:new Date(f.clock+60000)};expect((await post()).body.error.code).toBe('PICKUP_PENDING');expect(pending.status).toBe('PENDING');expect(m.data().attendance[0].status).toBe('PRESENT');
 expect(m.db.pickupRequest.findFirst).toHaveBeenCalledWith({where:expect.objectContaining({childId:m.child.id,centerId:m.device.centerId,day:a.day,status:'PENDING',expiresAt:{gt:new Date(f.clock)}})});
 pending.expiresAt=new Date(f.clock-1);expect((await post()).status).toBe(200);expect(pending.status).toBe('PENDING');
});
it('fails closed if Pickup storage cannot be checked and rolls back failed audit writes',async()=>{
 const delegate=m.db.pickupRequest;m.db.pickupRequest=undefined;expect((await post()).status).toBe(503);m.db.pickupRequest=delegate;
 m.db.auditLog.create.mockRejectedValue(Error('synthetic audit failure'));expect((await post()).status).toBe(503);expect(m.data().attendance[0].status).toBe('PRESENT');expect(notices).toHaveLength(0);
});
it('exposes checkout actor/time to scoped Admin and Parent reads and hides unrelated child data',async()=>{
 await post();
 const admin=await request(app).get('/api/v1/attendance?management=true').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);expect(admin.status).toBe(200);expect(admin.body.data.rows.find(r=>r.child.id===m.child.id).checkout.by.id).toBe(m.teacher.id);
 const parent=await request(app).get(`/api/v1/mobile/children/${m.child.id}/attendance`).set('Authorization',bearer(m.parent));expect(parent.status).toBe(200);expect(parent.body.data[0].checkout.by.username).toBe(m.teacher.username);
 expect((await request(app).get(`/api/v1/mobile/children/${m.foreignChild.id}/attendance`).set('Authorization',bearer(m.parent))).status).toBe(404);
});

it('rejects unauthenticated and inactive staff without changing attendance',async()=>{
 expect((await request(app).post(`/api/v1/attendance/${a.id}/checkout`).set('Host','localhost:5174').set('Origin','http://localhost:5174').send(body())).status).toBe(401);
 m.data().user.find(u=>u.id===m.teacher.id).active=false;expect((await post()).status).toBe(401);
 expect(m.data().attendance[0].status).toBe('PRESENT');expect(m.data().auditLog).toHaveLength(0);
});
