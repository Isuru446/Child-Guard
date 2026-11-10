import {beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createApp,tokenHash} from '../src/app.js';
import {processRfidScan,normalizeUid,uidLookup} from '../src/rfid.js';
import {zoneSessionKey} from '../src/zone-monitoring.js';
import {hydrateConfirmations} from '../src/rfid-storage.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
import {prepareAdminSessionCutover} from '../src/admin-session-cutover.js';
import {adminCookieTransport} from '../src/admin-session-http.js';
import {createMonitoringHub} from '../src/monitoring-events.js';
const key='synthetic-only-rfid-hmac-key-over-32',secret='synthetic-rfid-jwt-secret-over-32',token='synthetic-reader-token-over-32',password='Synthetic-rfid-password',hash=bcrypt.hashSync(password,4);
let f,m,app,reader,cookie,csrf,frames,hub;
const bearer=u=>'Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const input=(extra={})=>({eventId:randomUUID(),cardUid:'A1B2C3D4',readerBootId:'synthetic-boot',scanSequence:1,modeVersion:m.data().rfidReader.find(r=>r.id===reader.id)?.modeVersion??0,...extra});
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const admin=(method,path,body={})=>http(method,path).set('Cookie',cookie).set('X-CSRF-Token',csrf).send(body);
const scan=p=>request(app).post('/api/v1/rfid-reader/scans').set('X-RFID-Reader-Token',token).send(p);
const enroll=(mode='ISSUE')=>admin('post',`/api/v1/admin/rfid/children/${m.child.id}/enrollment`,{readerId:reader.id,mode});
const assign=async()=>{const r=await enroll();expect(r.status).toBe(200);const s=await scan(input({enrollmentId:r.body.data.id}));expect(s.body.data?.result).toBe('ENROLLMENT_SUCCESS');return m.data().rfidCard[0];};
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash('synthetic-wearable'),rfid:true});frames=[];
 reader={id:randomUUID(),hardwareId:'SYNTHETIC-RFID-01',tokenHash:createHash('sha256').update(token).digest('hex'),centerId:m.child.centerId,modeVersion:0,active:true,startMinute:0,endMinute:1440,lastSeen:null,createdById:f.state.user.id};m.data().rfidReader.push(reader);
 hub=createMonitoringHub();hub.subscribe(reader.centerId,e=>{expect(m.data().rfidScan.length).toBeGreaterThan(0);frames.push(e);});
 const original=f.repository.forCredential;f.repository.forCredential=(credential,work,level)=>original(credential,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,rfidLookupKey:key,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 const login=await http('post','/api/v1/auth/login').send({username:'admin',password});cookie=login.headers['set-cookie'][0].split(';')[0];csrf=login.body.data.csrfToken;
});
it('normalizes supported UID lengths and rejects malformed/unsupported UIDs',()=>{
 for(const uid of ['aabbccdd','01020304050607','01020304050607080910'])expect(normalizeUid(uid)).toBe(uid.toUpperCase());
 for(const uid of ['AA:BB:CC:DD','123','GG000000','1234567890'])expect(()=>normalizeUid(uid)).toThrow();
 expect(uidLookup('A1B2C3D4',key)).not.toContain('A1B2C3D4');
});
it('requires reader credential, rejects disabled readers, wearable tokens and caller child/center IDs',async()=>{
 expect((await request(app).post('/api/v1/rfid-reader/scans').send(input())).status).toBe(401);
 expect((await request(app).post('/api/v1/rfid-reader/scans').set('X-Device-Token','synthetic-wearable').send(input())).status).toBe(401);
 expect((await scan(input({childId:m.child.id}))).status).toBe(422);
 reader.active=false;expect((await scan(input())).status).toBe(401);expect(m.data().attendance).toHaveLength(0);
});
it('provisions a separate reader once and exposes no credential in GET',async()=>{
 const r=await admin('post','/api/v1/admin/rfid/readers',{hardwareId:'SYNTHETIC-RFID-02',startMinute:360,endMinute:1080});
 expect(r.status).toBe(201);expect(r.body.data.provisioningToken).toHaveLength(64);
 const read=await admin('get','/api/v1/admin/rfid/readers');expect(JSON.stringify(read.body)).not.toContain(r.body.data.provisioningToken);expect(JSON.stringify(read.body)).not.toContain('tokenHash');expect(m.data().device).toHaveLength(1);
});
it('allows only Admin cookie+CSRF to enroll; cross-center child/reader rejected',async()=>{
 const path=`/api/v1/admin/rfid/children/${m.child.id}/enrollment`;
 for(const actor of [m.parent,m.teacher])expect((await http('post',path).set('Authorization',bearer(actor)).send({readerId:reader.id,mode:'ISSUE'})).status).toBe(403);
 expect((await http('post',path).set('Cookie',cookie).send({readerId:reader.id,mode:'ISSUE'})).status).toBe(403);
 expect((await admin('post',`/api/v1/admin/rfid/children/${m.foreignChild.id}/enrollment`,{readerId:reader.id,mode:'ISSUE'})).status).toBe(404);
});
it('enrollment consumes an exact reader session without marking attendance and exposes only masked card details',async()=>{
 const card=await assign();expect(card.status).toBe('ACTIVE');expect(m.data().attendance).toHaveLength(0);expect(m.data().confirmation).toHaveLength(0);
 const r=await admin('get',`/api/v1/admin/rfid/children/${m.child.id}`);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.cards[0].maskedUid).toBe('••••C3D4');expect(JSON.stringify(r.body)).not.toContain('A1B2C3D4');expect(JSON.stringify(r.body)).not.toContain('uidHash');
});
it('publishes one center-only enrollment invalidation after commit and GET immediately shows the saved card',async()=>{
 const e=await enroll();let committed=false;
 const transaction=m.db.$transaction;
 m.db.$transaction=async(...args)=>{const result=await transaction(...args);committed=true;return result;};
 const foreign=vi.fn();hub.subscribe('other-center',foreign);
 hub.subscribe(reader.centerId,frame=>{
  expect(committed).toBe(true);expect(m.data().rfidEnrollment[0].status).toBe('SUCCESS');
  expect(Object.keys(frame).sort()).toEqual(['alertIds','id','notifiedAt','topics']);
 });
 const p=input({enrollmentId:e.body.data.id});expect((await scan(p)).body.data.result).toBe('ENROLLMENT_SUCCESS');
 expect(frames).toHaveLength(1);expect(frames[0].topics).toEqual(['devices']);expect(foreign).not.toHaveBeenCalled();
 expect(JSON.stringify(frames)).not.toContain(p.cardUid);expect(JSON.stringify(frames)).not.toContain(token);expect(JSON.stringify(frames)).not.toContain(key);
 const r=await admin('get',`/api/v1/admin/rfid/children/${m.child.id}`);
 expect(r.body.data.enrollment.status).toBe('SUCCESS');expect(r.body.data.cards[0].status).toBe('ACTIVE');
 await scan(p);expect(frames).toHaveLength(1);expect(m.data().rfidCard).toHaveLength(1);expect(m.data().attendance).toHaveLength(0);
});
it('does not publish enrollment success when the transaction rolls back',async()=>{
 const e=await enroll();m.db.rfidScan.create.mockRejectedValueOnce(Error('Synthetic save failure'));
 expect((await scan(input({enrollmentId:e.body.data.id}))).status).toBe(503);
 expect(frames).toHaveLength(0);expect(m.data().rfidCard).toHaveLength(0);expect(m.data().rfidEnrollment[0].status).toBe('PENDING');
});
it('keeps committed near-deadline success when the deadline passes or cancellation arrives later',async()=>{
 const e=await enroll();f.tick(59999);
 expect((await scan(input({enrollmentId:e.body.data.id}))).body.data.result).toBe('ENROLLMENT_SUCCESS');f.tick(2);
 expect((await admin('post',`/api/v1/admin/rfid/enrollments/${e.body.data.id}/cancel`)).body.data.cancelled).toBe(false);
 const read=await admin('get',`/api/v1/admin/rfid/children/${m.child.id}`);
 expect(read.body.data.enrollment.status).toBe('SUCCESS');expect(read.body.data.cards[0].status).toBe('ACTIVE');expect(frames).toHaveLength(1);
});
it('rechecks enrollment if a commit races the Admin card-list read',async()=>{
 const e=await enroll(),p=input({enrollmentId:e.body.data.id});
 const readCards=m.db.rfidCard.findMany.getMockImplementation();
 m.db.rfidCard.findMany.mockImplementationOnce(async(...args)=>{
  const old=await readCards(...args);expect((await processRfidScan(m.db,reader,p,{key})).result).toBe('ENROLLMENT_SUCCESS');return old;
 });
 const r=await admin('get',`/api/v1/admin/rfid/children/${m.child.id}`);
 expect(r.status).toBe(200);expect(r.body.data.enrollment.status).toBe('SUCCESS');expect(r.body.data.cards).toHaveLength(1);
 expect(r.body.data.cards[0].status).toBe('ACTIVE');expect(m.db.rfidCard.findMany).toHaveBeenCalledTimes(2);
});
it('keeps the card-status read Admin-only and center-scoped',async()=>{
 const path=`/api/v1/admin/rfid/children/${m.child.id}`;
 expect((await http('get',path)).status).toBe(401);
 for(const actor of [m.parent,m.teacher])expect((await http('get',path).set('Authorization',bearer(actor))).status).toBe(403);
 expect((await admin('get',`/api/v1/admin/rfid/children/${m.foreignChild.id}`)).status).toBe(404);
});
it('expired/cancelled/stale enrollment scans never become attendance',async()=>{
 let e=await enroll();f.tick(61000);expect((await scan(input({enrollmentId:e.body.data.id}))).body.data.result).toBe('ENROLLMENT_REJECTED');
 e=await enroll();await admin('post',`/api/v1/admin/rfid/enrollments/${e.body.data.id}/cancel`);
 expect((await scan(input({scanSequence:2,enrollmentId:e.body.data.id}))).body.data.result).toBe('ENROLLMENT_REFRESH_REQUIRED');expect(m.data().attendance).toHaveLength(0);
});
it('active enrollment blocks a stale attendance-mode tap and one reader cannot enroll two children',async()=>{
 await enroll();expect((await scan(input())).body.data.result).toBe('ENROLLMENT_REFRESH_REQUIRED');expect(m.data().attendance).toHaveLength(0);
 expect((await admin('post',`/api/v1/admin/rfid/children/${m.unrecorded.id}/enrollment`,{readerId:reader.id,mode:'ISSUE'})).status).toBe(409);
});
it('prevents active UID collisions and more than one active card per child',async()=>{
 await assign();expect((await enroll()).status).toBe(409);
 const other={...reader,id:randomUUID(),hardwareId:'SYNTHETIC-OTHER'};m.data().rfidReader.push(other);
 const e=await admin('post',`/api/v1/admin/rfid/children/${m.unrecorded.id}/enrollment`,{readerId:other.id,mode:'ISSUE'});
 const r=await processRfidScan(m.db,other,input({enrollmentId:e.body.data.id,modeVersion:m.data().rfidReader.find(r=>r.id===other.id).modeVersion}),{key});expect(r.result).toBe('ENROLLMENT_REJECTED');expect(m.data().rfidCard.filter(c=>c.status==='ACTIVE')).toHaveLength(1);
});
it('replacement preserves history, revokes old UID and new UID can attend',async()=>{
 const old=await assign(),e=await enroll('REPLACE');expect(old.status).toBe('ACTIVE');
 expect((await scan(input({cardUid:'11223344',scanSequence:2,enrollmentId:e.body.data.id}))).body.data.result).toBe('ENROLLMENT_SUCCESS');
 expect(m.data().rfidCard[0].status).toBe('REPLACED');expect((await scan(input({scanSequence:3}))).body.data.result).toBe('CARD_REVOKED');
 expect((await scan(input({cardUid:'11223344',scanSequence:4}))).body.data.result).toBe('PRESENT_RECORDED');expect(m.data().rfidCard).toHaveLength(2);
});
it('revoked and unknown cards cannot create attendance',async()=>{
 expect((await scan(input({scanSequence:99}))).body.data.result).toBe('CARD_UNKNOWN');const card=await assign();
 expect((await admin('post',`/api/v1/admin/rfid/children/${m.child.id}/revoke`,{cardId:card.id,reason:'Synthetic lost card'})).status).toBe(200);
 expect((await scan(input({scanSequence:2}))).body.data.result).toBe('CARD_REVOKED');expect(m.data().attendance).toHaveLength(0);
});
it('valid RFID records same authoritative PRESENT without a wearable, fake Teacher or fabricated telemetry',async()=>{
 await assign();m.data().assignment=[];m.data().device=[];frames=[];
 const r=await scan(input({scanSequence:2}));expect(r.body.data.result).toBe('PRESENT_RECORDED');expect(m.data().attendance[0].status).toBe('PRESENT');
 expect(m.data().confirmation[0]).toMatchObject({method:'RFID_CARD',userId:null,readerId:reader.id});
 expect(m.data().auditLog.some(a=>a.action.startsWith('ATTENDANCE_CONFIRMED_TEACHER'))).toBe(false);
 expect(m.data().deviceEvent).toHaveLength(0);expect(m.data().alert).toHaveLength(0);expect(frames[0].topics).toContain('attendance');
 expect(m.data().activityAttendanceSession).toHaveLength(1);
});
it('CHECKIN_PENDING becomes PRESENT with the original observation preserved',async()=>{
 await assign();const a={id:randomUUID(),childId:m.child.id,day:'2026-10-25',status:'CHECKIN_PENDING'};m.data().attendance.push(a);m.data().observation.push({id:randomUUID(),attendanceId:a.id,eventId:'synthetic-existing-BLE'});
 const r=await scan(input({scanSequence:2}));expect(r.body.data.result).toBe('PENDING_CONFIRMED');expect(m.data().attendance).toHaveLength(1);expect(m.data().observation[0].eventId).toBe('synthetic-existing-BLE');
});
it.each(['ABSENT','CHECKED_OUT'])('preserves %s decisions',async status=>{
 await assign();m.data().attendance.push({id:randomUUID(),childId:m.child.id,day:'2026-10-25',status});
 expect((await scan(input({scanSequence:2}))).body.data.result).toBe('ATTENDANCE_CONFLICT');expect(m.data().attendance[0].status).toBe(status);expect(m.data().confirmation).toHaveLength(0);
});
it('concurrent repeated scans keep one confirmation timestamp/source and one SSE change',async()=>{
 await assign();frames=[];const p=input({scanSequence:2});await Promise.all(Array.from({length:6},()=>scan(p)));
 const before=structuredClone(m.data().confirmation[0]);f.tick(5000);
 expect((await scan(input({scanSequence:3}))).body.data.result).toBe('ALREADY_PRESENT');expect(m.data().confirmation[0]).toEqual(before);expect(m.data().attendance).toHaveLength(1);expect(frames).toHaveLength(1);
 expect(m.data().rfidScan.filter(s=>s.changed)).toHaveLength(1);
});
it('Teacher/RFID confirmation race preserves the first real source and creates one activity session',async()=>{
 await assign();const a={id:randomUUID(),childId:m.child.id,day:'2026-10-25',status:'CHECKIN_PENDING'};m.data().attendance.push(a);
 const results=await Promise.all([scan(input({scanSequence:2})),request(app).post(`/api/v1/attendance/${a.id}/confirm`).set('Authorization',bearer(m.teacher)).send({})]);
 expect(results.every(r=>r.status<300)).toBe(true);expect(m.data().confirmation).toHaveLength(1);expect(m.data().activityAttendanceSession).toHaveLength(1);
});
it('uses Colombo receipt day, applies configured hours and rejects foreign-center active cards',async()=>{
 await assign();reader.startMinute=0;reader.endMinute=1;
 expect((await scan(input({scanSequence:2}))).body.data.result).toBe('OUTSIDE_ATTENDANCE_HOURS');
 reader.endMinute=1440;f.tick(Date.parse('2026-10-25T18:31:00Z')-f.clock);
 expect((await scan(input({scanSequence:3}))).body.data.result).toBe('PRESENT_RECORDED');expect(m.data().attendance[0].day).toBe('2026-10-26');
 m.data().rfidCard[0].centerId='center-b';expect((await scan(input({scanSequence:4}))).body.data.result).toBe('CARD_UNKNOWN');
});
it('same event ID with changed UID/sequence is rejected, not reinterpreted',async()=>{
 const p=input();await scan(p);expect((await scan({...p,cardUid:'11223344'})).status).toBe(409);expect((await scan({...p,eventId:randomUUID()})).status).toBe(409);
});
it('RFID confirmation hydrates with reader attribution and still needs genuine same-session departure for zone monitoring',async()=>{
 await assign();await scan(input({scanSequence:2}));const records=await m.db.attendance.findMany({});await hydrateConfirmations(m.db,records);
 expect(records[0].confirmations[0].reader.hardwareId).toBe(reader.hardwareId);
 const c=m.data().confirmation[0],a=m.data().attendance[0],assignment=m.data().assignment[0];
 expect(zoneSessionKey({device:m.device,attendance:a,assignment,confirmation:c,boot:'real-boot'})).toBeTruthy();expect(zoneSessionKey({device:m.device,attendance:a,assignment,confirmation:null,boot:'real-boot'})).toBeNull();
 const gate=await request(app).get(`/api/gate/state?deviceId=${m.device.hardwareId}&gateId=${m.gate.hardwareId}&deviceBootId=real-boot`).set('X-Device-Token','synthetic-wearable');
 expect(gate.body.attendanceStatus).toBe('PRESENT');expect(gate.body.zoneMonitoringArmed).toBe(false);
});
it('staged SQL preserves Attendance uniqueness and enforces active card/session uniqueness and actor separation',()=>{
 const sql=readFileSync(new URL('../prisma/migrations/202610280001_rfid_backup_attendance/migration.sql',import.meta.url),'utf8');
 expect(sql).toContain('RfidCard_one_active_child');expect(sql).toContain('RfidCard_one_active_uid');expect(sql).toContain('Confirmation_actor_check');expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE "Attendance"/i);
});

it('an already Teacher-confirmed Present record retains the original Teacher, timestamp and audit',async()=>{
 await assign();const at=new Date(f.clock-5000),id=randomUUID();m.data().attendance.push({id,childId:m.child.id,day:'2026-10-25',status:'PRESENT'});m.data().confirmation.push({id:randomUUID(),attendanceId:id,userId:m.teacher.id,confirmedAt:at});
 const before=structuredClone(m.data().confirmation[0]);expect((await scan(input({scanSequence:2}))).body.data.result).toBe('ALREADY_PRESENT');expect(m.data().confirmation[0]).toEqual(before);expect(m.data().rfidScan.filter(r=>r.changed)).toHaveLength(0);
});
it('revocation while enrollment is pending prevents a stale replacement from issuing a new card',async()=>{
 const card=await assign(),e=await enroll('REPLACE');await admin('post',`/api/v1/admin/rfid/children/${m.child.id}/revoke`,{cardId:card.id,reason:'Synthetic lost card'});
 expect((await scan(input({cardUid:'11223344',scanSequence:2,enrollmentId:e.body.data.id}))).body.data.result).toBe('ENROLLMENT_REJECTED');expect(m.data().rfidCard.filter(r=>r.status==='ACTIVE')).toHaveLength(0);
});
it('Parent and Teacher attendance reads receive RFID method/reader with no UID or fake staff',async()=>{
 await assign();await scan(input({scanSequence:2}));
 const r=await request(app).get(`/api/v1/mobile/children/${m.child.id}/attendance`).set('Authorization',bearer(m.parent));expect(r.status).toBe(200);expect(r.body.data[0].confirmations[0]).toMatchObject({method:'RFID_CARD',userId:null,reader:{hardwareId:reader.hardwareId}});expect(JSON.stringify(r.body)).not.toMatch(/uidHash|A1B2C3D4|tokenHash/);
 expect((await request(app).get(`/api/v1/mobile/children/${m.foreignChild.id}/attendance`).set('Authorization',bearer(m.parent))).status).toBe(404);
 const t=await request(app).get('/api/v1/attendance').set('Authorization',bearer(m.teacher));expect(t.status).toBe(200);expect(t.body.data[0].confirmations[0].method).toBe('RFID_CARD');expect(t.body.data[0].canConfirm).toBe(false);
});
it('RFID presence permits only a real post-confirmation Gate FAR to arm zone monitoring',async()=>{
 await assign();await scan(input({scanSequence:2}));f.tick(1000);
 const e={eventId:randomUUID(),eventType:'BLE_PROXIMITY',deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,gpsStatus:'GPS_NO_FIX',deviceBootId:'real-boot',deviceUptimeMs:2000,queueAgeMs:0,proximity:'FAR',rssi:-95};
 const accepted=await request(app).post('/api/events').set('X-Device-Token','synthetic-wearable').send(e);expect(accepted.status).toBe(201);
 const state=await request(app).get(`/api/gate/state?deviceId=${m.device.hardwareId}&gateId=${m.gate.hardwareId}&deviceBootId=real-boot`).set('X-Device-Token','synthetic-wearable');expect(state.body.zoneMonitoringArmed).toBe(true);expect(m.data().alert).toHaveLength(0);
});

it('one saved RFID routine update survives duplicate scans and stays child scoped',async()=>{
 await assign();const p=input({scanSequence:2});await scan(p);await scan(p);await scan(input({scanSequence:3}));
 const r=await request(app).get(`/api/v1/mobile/children/${m.child.id}/updates`).set('Authorization',bearer(m.parent));expect(r.status).toBe(200);expect(r.body.data).toHaveLength(1);expect(r.body.data[0].kind).toBe('ATTENDANCE_CONFIRMED_RFID');expect(JSON.stringify(r.body)).not.toMatch(/uidHash|A1B2C3D4|tokenHash/);
 const bad=await request(app).get(`/api/v1/mobile/children/${m.foreignChild.id}/updates`).set('Authorization',bearer(m.parent));expect(bad.status).toBe(404);
});
it('Admin disabling a reader stops scans and revoking a card preserves earlier attendance',async()=>{
 const card=await assign();await scan(input({scanSequence:2}));const before=structuredClone(m.data().attendance);
 expect((await admin('post',`/api/v1/admin/rfid/children/${m.child.id}/revoke`,{cardId:card.id,reason:'Synthetic revocation'})).status).toBe(200);expect(m.data().attendance).toEqual(before);
 expect((await admin('patch',`/api/v1/admin/rfid/readers/${reader.id}`,{active:false,expectedActive:true})).status).toBe(200);expect((await scan(input({scanSequence:3}))).status).toBe(401);
});

it('stale attendance-mode taps cannot become attendance after a cancelled enrollment',async()=>{
 await assign();const stale=input({scanSequence:2});const e=await enroll('REPLACE');await admin('post',`/api/v1/admin/rfid/enrollments/${e.body.data.id}/cancel`);
 const r=await scan(stale);expect(r.body.data.result).toBe('ENROLLMENT_REFRESH_REQUIRED');expect(m.data().attendance).toHaveLength(0);
});
