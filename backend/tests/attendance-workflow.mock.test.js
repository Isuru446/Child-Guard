import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
import { dashboardAttendance, dashboardDaily } from '../../web_front/src/lib/dashboard-attendance.js';
const secret='synthetic-attendance-workflow-secret-over-32',password='Synthetic-attendance-password',hash=bcrypt.hashSync(password,4),deviceSecret='synthetic-private-device-credential-at-least-32';
let f,m,app,cookie,csrf;
const token=u=>jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const get=q=>request(app).get('/api/v1/attendance?management=true'+q).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
const candidate=(extra={})=>({eventId:randomUUID(),deviceId:m.device.hardwareId,eventType:'CHILD_NEAR_GATE',gateId:m.gate.hardwareId,rssi:-40,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1000,...extra});
const ingest=body=>request(app).post('/api/events').set('X-Device-Token',deviceSecret).send(body);
const confirm=(u=m.teacher,body={},id=m.data().attendance[0]?.id)=>request(app).post(`/api/v1/attendance/${id}/confirm`).set('Authorization','Bearer '+token(u)).send(body);
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash(deviceSecret)});
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',enableDevAttendanceReset:'false',logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(r.status).toBe(200);cookie=r.headers['set-cookie'][0].split(';')[0];csrf=r.body.data.csrfToken;
});
it('creates only a pending record from registered authenticated BLE arrival and exposes true Admin status',async()=>{
 expect((await ingest(candidate())).status).toBe(201);expect(m.data().attendance).toHaveLength(1);expect(m.data().attendance[0].status).toBe('CHECKIN_PENDING');expect(m.data().confirmation).toEqual([]);
 const r=await get('');expect(r.status).toBe(200);expect(r.body.data.summary.CHECKIN_PENDING).toBe(1);expect(r.body.data.summary.NO_RECORD).toBe(1);expect(r.body.data.rows.find(r=>r.attendanceId).arrival).toMatchObject({wearable:m.device.hardwareId,gate:m.gate.hardwareId});expect(r.body.data.rows.every(r=>r.canConfirm===false)).toBe(true);
});

it('accepts the child-profile exact identity query and isolates same-name and foreign-center records',async()=>{
 await ingest(candidate());await confirm();
 const current=m.data().child.find(c=>c.id===m.child.id);current.name='Renamed child';
 m.data().child.find(c=>c.id===m.unrecorded.id).name=current.name;
 const result=await get(`&view=history&from=2026-10-01&to=2026-10-25&childId=${m.child.id}&limit=50`);
 expect(result.status).toBe(200);expect(result.body.data.rows.map(row=>row.child.id)).toEqual([m.child.id]);
 expect(result.body.data.rows[0].child.name).toBe('Renamed child');
 expect((await get(`&view=history&childId=${m.foreignChild.id}`)).body.data.rows).toEqual([]);
 expect((await get('&childId=not-an-id')).status).toBe(422);
});

it('feeds actual HTTP overview/roster responses into the Web Dashboard V2 state mappings',async()=>{
 await ingest(candidate());await confirm();
 m.data().attendance.push({id:randomUUID(),childId:m.unrecorded.id,day:'2026-10-25',status:'NOT_CHECKED_IN'});
 const overview=await request(app).get('/api/v1/admin/overview?month=2026-10').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
 expect(overview.status).toBe(200);
 expect(dashboardAttendance(overview.body.data.attendance)).toMatchObject({present:1,notCheckedIn:1,pending:0,total:2,rate:50});
 const roster=await get('&limit=1');expect(roster.body.data.rows).toHaveLength(1);
 expect(dashboardDaily(roster.body.data.summary)).toMatchObject({present:1,notCheckedIn:1,total:2,rate:50});
});
it('deduplicates exact event replay, rejects changed replay and repeated arrivals do not duplicate attendance',async()=>{
 const e=candidate();expect((await ingest(e)).status).toBe(201);expect((await ingest(e)).body.data.duplicate).toBe(true);expect((await ingest({...e,rssi:-55})).status).toBe(409);await ingest(candidate());expect(m.data().attendance).toHaveLength(1);expect(m.data().deviceEvent).toHaveLength(2);
});
it('serializes simultaneous detections into one child/day record',async()=>{
 const r=await Promise.all([ingest(candidate()),ingest(candidate())]);expect(r.map(x=>x.status)).toEqual([201,201]);expect(m.data().attendance).toHaveLength(1);expect(m.data().observation).toHaveLength(2);expect(m.db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
});
it('rejects unknown, inactive, wrong-kind and cross-center gates without creating attendance',async()=>{
 expect((await ingest(candidate({gateId:'UNKNOWN'}))).status).toBe(422);m.data().beacon[0].active=false;expect((await ingest(candidate())).status).toBe(422);m.data().beacon[0].active=true;m.data().beacon[0].kind='DANGER_ZONE';expect((await ingest(candidate())).status).toBe(422);m.data().beacon[0].kind='GATE';m.data().beacon[0].centerId='center-b';expect((await ingest(candidate())).status).toBe(422);expect(m.data().attendance).toEqual([]);
});
it('records unassigned telemetry without manufacturing attendance and rejects an inactive credential',async()=>{
 m.data().assignment[0].endedAt=new Date(f.clock);expect((await ingest(candidate())).status).toBe(201);expect(m.data().attendance).toEqual([]);m.data().device[0].active=false;expect((await ingest(candidate())).status).toBe(401);
});
it('cannot use a manipulated cross-center assignment to create attendance',async()=>{
 m.data().assignment[0].childId=m.foreignChild.id;expect((await ingest(candidate())).status).toBe(201);expect(m.data().attendance).toEqual([]);expect(m.data().deviceEvent[0].childId).toBeUndefined();
});
it('records actual Teacher identity/time exactly once under concurrent confirmation and preserves Parent visibility',async()=>{
 await ingest(candidate());const results=await Promise.all([confirm(),confirm()]);expect(results.map(r=>({status:r.status,code:r.body.error?.code}))).toEqual([{status:200,code:undefined},{status:200,code:undefined}]);expect(m.data().confirmation).toHaveLength(1);expect(m.data().confirmation[0]).toMatchObject({userId:m.teacher.id,confirmedAt:new Date(f.clock)});expect(m.data().auditLog.filter(a=>a.action==='ATTENDANCE_CONFIRMED_TEACHER')).toHaveLength(1);expect(m.data().activityAttendanceSession).toHaveLength(1);
 const r=await get('');const row=r.body.data.rows.find(r=>r.attendanceId);expect(row.confirmation).toMatchObject({username:m.teacher.username,roleAtConfirmation:'TEACHER'});expect(row.status).toBe('PRESENT');
 const parent=await request(app).get(`/api/v1/mobile/children/${m.child.id}/attendance`).set('Authorization','Bearer '+token(m.parent));expect(parent.status).toBe(200);expect(parent.body.data[0].status).toBe('PRESENT');
});
it('refuses Parent, Admin, other-center Teacher and forged actor bodies',async()=>{
 await ingest(candidate());expect((await confirm(m.parent)).status).toBe(403);expect((await confirm(m.otherTeacher)).status).toBe(404);expect((await confirm(m.teacher,{teacherId:f.state.user.id})).status).toBe(422);
 const admin=await request(app).post(`/api/v1/attendance/${m.data().attendance[0].id}/confirm`).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});expect(admin.status).toBe(403);expect(m.data().confirmation).toEqual([]);
});
it('rechecks a Teacher suspended between JWT admission and the transaction',async()=>{
 await ingest(candidate());const original=m.db.user.findUnique.getMockImplementation();let reads=0;m.db.user.findUnique.mockImplementation(async q=>{const u=await original(q);return q.where.id===m.teacher.id&&++reads>1?{...u,active:false}:u;});expect((await confirm()).status).toBe(403);expect(m.data().confirmation).toEqual([]);
});
it('refuses prior-day and non-pending confirmation without overwriting history',async()=>{
 await ingest(candidate());m.data().attendance[0].day='2026-10-24';expect((await confirm()).status).toBe(409);const prior=(await get('&day=2026-10-24')).body.data.rows.find(r=>r.attendanceId);expect(prior.confirmationClosed).toBe(true);expect(prior.status).toBe('CHECKIN_PENDING');m.data().attendance[0].day=attendanceDay(new Date(f.clock));m.data().attendance[0].status='CHECKED_OUT';expect((await confirm()).status).toBe(409);expect(m.data().confirmation).toEqual([]);
});
it('expires confirmation at the Colombo day boundary and cannot replay yesterday into a new attendance day',async()=>{
 const e=candidate();await ingest(e);const before=structuredClone(m.data().attendance);f.tick(Date.parse('2026-10-25T18:30:00Z')-f.clock);expect(attendanceDay(new Date(f.clock))).toBe('2026-10-26');expect((await confirm()).status).toBe(409);expect((await ingest(e)).body.data.duplicate).toBe(true);expect(m.data().attendance).toEqual(before);
});
it('never regresses confirmed attendance through repeated detections or ordinary GPS heartbeat events',async()=>{
 await ingest(candidate());await confirm();const saved=structuredClone(m.data().confirmation);await ingest(candidate());await ingest(candidate({eventType:'GPS_STATUS',rssi:undefined}));expect(m.data().attendance[0].status).toBe('PRESENT');expect(m.data().confirmation).toEqual(saved);
});
it('rolls back confirmation, audit and activity together on required audit failure',async()=>{
 await ingest(candidate());m.failAudit();expect((await confirm()).status).toBe(503);expect(m.data().attendance[0].status).toBe('CHECKIN_PENDING');expect(m.data().confirmation).toEqual([]);expect(m.data().activityAttendanceSession).toEqual([]);
});
it('rolls back event, receipt timestamp and pending record when observation persistence fails',async()=>{
 m.db.observation.create.mockRejectedValue(Error('synthetic-private-observation-error'));expect((await ingest(candidate())).status).toBe(503);expect(m.data().attendance).toEqual([]);expect(m.data().deviceEvent).toEqual([]);expect(m.data().device[0].lastSeen).toBeNull();
});
it('keeps historical Teacher role and arrival belt independent of subsequent account or assignment changes',async()=>{
 await ingest(candidate());await confirm();m.data().user.find(u=>u.id===m.teacher.id).role='PARENT';m.data().assignment[0].endedAt=new Date(f.clock);const newDevice={...m.device,id:randomUUID(),hardwareId:'CURRENT-REPLACEMENT'};m.data().device.push(newDevice);m.data().assignment.push({id:randomUUID(),deviceId:newDevice.id,childId:m.child.id,startedAt:new Date(f.clock),endedAt:null});const row=(await get('')).body.data.rows.find(r=>r.attendanceId);expect(row.confirmation.roleAtConfirmation).toBe('TEACHER');expect(row.currentAssignment.device.hardwareId).toBe('CURRENT-REPLACEMENT');expect(row.arrival.wearable).toBe(m.device.hardwareId);
});
it('uses receipt-based Colombo dates for delayed legacy arrivals without accepting an invented age field',async()=>{
 const body=candidate();expect((await ingest({...body,queueAgeMs:999999})).status).toBe(422);f.tick(10000);expect((await ingest(body)).status).toBe(201);expect(m.data().attendance[0].day).toBe(attendanceDay(new Date(f.clock)));expect(m.data().deviceEvent[0].observedAt).toEqual(new Date(f.clock));
});
it('filters actual stored states/history and does not classify missing records as absent',async()=>{
 await ingest(candidate());await confirm();const present=await get('&status=PRESENT&search=Registered');expect(present.body.data.rows).toHaveLength(1);expect(present.body.data.summary.NO_RECORD).toBe(1);
 const missing=await get('&status=NO_RECORD');expect(missing.body.data.rows[0]).toMatchObject({attendanceId:null,status:'NO_RECORD',child:{id:m.unrecorded.id}});expect(m.data().attendance).toHaveLength(1);
 const history=await get('&view=history&from=2026-10-01&to=2026-10-25');expect(history.body.data.rows).toHaveLength(1);expect(history.body.data.days).toEqual([{day:'2026-10-25',status:'PRESENT',count:1}]);expect(JSON.stringify(history.body)).not.toMatch(/passwordHash|tokenHash/);
});
it('searches the complete center roster case-insensitively with trimmed names, selected-day states and page-independent totals',async()=>{
 for(let i=0;i<60;i++)m.data().child.push({id:randomUUID(),centerId:m.child.centerId,name:i===59?'Z Demo Child Chanuka':'Roster child '+String(i).padStart(2,'0')});
 const target=m.data().child.at(-1);
 expect((await get('&day=2026-10-24&limit=25')).body.data.rows.some(r=>r.child.id===target.id)).toBe(false);
 m.data().attendance.push({id:randomUUID(),childId:target.id,day:'2026-10-24',status:'ABSENT'},{id:randomUUID(),childId:target.id,day:'2026-10-25',status:'PRESENT'});
 const historical=await get('&day=2026-10-24&search=%20%20cHaNuKa%20%20&status=ABSENT&limit=1');
 expect(historical.status).toBe(200);expect(historical.body.data.rows).toHaveLength(1);expect(historical.body.data.rows[0]).toMatchObject({child:{id:target.id},day:'2026-10-24',status:'ABSENT',confirmation:null,checkout:null});
 expect(historical.body.data.summary).toMatchObject({rosterCount:62,ABSENT:1,PRESENT:0,NO_RECORD:61});
 const today=await get('&day=2026-10-25&search=demo child&status=ABSENT');expect(today.body.data.rows).toEqual([]);expect(today.body.data.summary).toMatchObject({PRESENT:1,ABSENT:0,rosterCount:62});
 const second=await get('&day=2026-10-24&limit=25&offset=25');expect(second.body.data.rows).toHaveLength(25);expect(second.body.data.hasMore).toBe(true);expect(second.body.data.summary).toEqual(historical.body.data.summary);expect(second.body.data.rows.every(r=>r.status==='NO_RECORD'||r.status==='ABSENT')).toBe(true);
});
it('reports only the requested leap-month records and preserves all stored states with no fabricated missing dates',async()=>{
 const original=[{id:randomUUID(),childId:m.child.id,day:'2024-02-01',status:'ABSENT'},{id:randomUUID(),childId:m.child.id,day:'2024-02-29',status:'CHECKED_OUT'},{id:randomUUID(),childId:m.child.id,day:'2024-03-01',status:'PRESENT'}];m.data().attendance.push(...original);
 const result=await get('&view=history&from=2024-02-01&to=2024-02-29');expect(result.status).toBe(200);expect(result.body.data.rows.map(r=>[r.day,r.status])).toEqual([['2024-02-29','CHECKED_OUT'],['2024-02-01','ABSENT']]);expect(result.body.data.summary).toMatchObject({PRESENT:0,CHECKED_OUT:1,ABSENT:1,NO_RECORD:null,rosterCount:2});expect(result.body.data.days).toHaveLength(2);expect(m.data().attendance).toEqual(original);
});
it('finds reset-cycle arrival evidence in a bounded recent sample and does not duplicate confirmation archives',async()=>{
 await ingest(candidate());await confirm();const record=m.data().attendance[0],first=m.data().deviceEvent[0],confirmation=m.data().confirmation[0];record.status='CHECKIN_PENDING';first.receivedAt=new Date(f.clock-1000);
 for(let i=0;i<55;i++){const e={...first,id:randomUUID(),eventId:randomUUID(),receivedAt:new Date(f.clock-2000-i)};m.data().deviceEvent.push(e);m.data().observation.push({id:randomUUID(),attendanceId:record.id,eventId:e.id});}
 m.data().auditLog.push({id:'reset',userId:f.state.user.id,resourceId:record.id,action:'ATTENDANCE_DEV_RESET',createdAt:new Date(f.clock-500)},{id:'archive',userId:confirmation.userId,resourceId:record.id,createdAt:confirmation.confirmedAt,action:'ATTENDANCE_CONFIRMATION_SNAPSHOT:'+JSON.stringify({userId:confirmation.userId,confirmedAt:confirmation.confirmedAt.toISOString()})});
 const recent={...first,id:randomUUID(),eventId:randomUUID(),receivedAt:new Date(f.clock)};m.data().deviceEvent.push(recent);m.data().observation.push({id:randomUUID(),attendanceId:record.id,eventId:recent.id});
 const row=(await get('')).body.data.rows.find(r=>r.attendanceId);expect(row.arrival.eventId).toBe(recent.eventId);expect(row.previousConfirmations).toHaveLength(1);expect(row.previousConfirmations[0].roleAtConfirmation).toBe('TEACHER');expect(row.confirmation).toBeNull();
});
it.each(['centerId=center-b','status=INVALID','day=2999-01-01','view=history&from=2026-09-01&to=2026-10-25','limit=51','offset=-1'])('validates Admin history queries %s',async query=>{expect((await get('&'+query)).status).toBe(422);});
it('enforces center isolation and the Teacher interface remains today-only with true capability',async()=>{
 await ingest(candidate());const r=await request(app).get('/api/v1/attendance').set('Authorization','Bearer '+token(m.teacher));expect(r.status).toBe(200);expect(r.body.data[0].canConfirm).toBe(true);
 const forbidden=await request(app).get('/api/v1/attendance?management=true').set('Authorization','Bearer '+token(m.teacher));expect(forbidden.status).toBe(403);
 const foreign=await request(app).get('/api/v1/attendance').set('Authorization','Bearer '+token(m.otherTeacher));expect(foreign.body.data).toEqual([]);
});
it('background Admin reads never extend five-minute inactivity or create attendance records',async()=>{
 const before=structuredClone(f.state.sessions[0]);for(let i=0;i<19;i++){f.tick(15000);expect((await get('')).status).toBe(200);}expect(f.state.sessions[0]).toEqual(before);expect(f.updates).toBe(0);f.tick(15000);expect((await get('')).status).toBe(401);expect(m.data().attendance).toEqual([]);expect(m.db.$transaction).not.toHaveBeenCalled();
});
