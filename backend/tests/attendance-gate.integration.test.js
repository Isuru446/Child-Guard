import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const secret=randomUUID()+randomUUID(), deviceToken=randomUUID()+randomUUID();
const app=createApp({db,jwtSecret:secret,logger:{error(){}}});
let center,gateBeacon,admin,teacher,parent,transport,outsider;
const sign=u=>jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const get=(path,user=admin)=>request(app).get(path).set('Authorization',`Bearer ${sign(user)}`);
const confirm=(id,user=admin)=>request(app).post(`/api/v1/attendance/${id}/confirm`).set('Authorization',`Bearer ${sign(user)}`).send({});
beforeAll(async()=>{
 await assertTestDatabase(db);
 center=await db.center.create({data:{name:`gate-test-${randomUUID()}`}});
 gateBeacon=await db.beacon.create({data:{hardwareId:`gate-${randomUUID()}`,centerId:center.id}});
 const user=async(role,centerId=center.id)=>db.user.create({data:{username:randomUUID(),passwordHash:'unused-test-hash',role,centerId}});
 admin=await user('ADMIN');teacher=await user('TEACHER');parent=await user('PARENT');transport=await user('TRANSPORT');
 const other=await db.center.create({data:{name:'Other synthetic center'}});outsider=await user('ADMIN',other.id);
});
afterAll(async()=>db.$disconnect());
async function flow() {
 const child=await db.child.create({data:{name:'Synthetic arrival child',centerId:center.id}});
 const device=await db.device.create({data:{hardwareId:`wearable-${randomUUID()}`,centerId:center.id,tokenHash:tokenHash(deviceToken)}});
 await db.assignment.create({data:{childId:child.id,deviceId:device.id}});
 let sequence=0;
 const payload=(eventType,extra={})=>({eventId:randomUUID(),deviceId:device.hardwareId,gateId:gateBeacon.hardwareId,eventType,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:++sequence*1000,...(['CHILD_NEAR_GATE','DANGER_ZONE_NEAR'].includes(eventType)?{rssi:-50}:{}),...extra});
 const post=p=>request(app).post('/api/events').set('X-Device-Token',deviceToken).send(p);
 const arrival=async()=>{expect((await post(payload('CHILD_NEAR_GATE'))).status).toBe(201);return db.attendance.findUnique({where:{childId_day:{childId:child.id,day:attendanceDay(new Date())}}});};
 const ble=state=>post(payload('BLE_PROXIMITY',{proximity:state,queueAgeMs:0,...(state==='UNKNOWN'?{}:{rssi:state==='FAR'?-90:-50})}));
 const danger=extra=>post(payload('DANGER_ZONE_NEAR',{queueAgeMs:0,...extra}));
 const gate=()=>request(app).get('/api/gate/state').query({deviceId:device.hardwareId,gateId:gateBeacon.hardwareId}).set('X-Device-Token',deviceToken);
 return {child,device,payload,post,arrival,ble,danger,gate};
}
describe('attendance approval and gate lifecycle in PostgreSQL',()=>{
 it('creates only one pending request and exact retries do not add observations',async()=>{
  const f=await flow(),p=f.payload('CHILD_NEAR_GATE');expect((await f.post(p)).status).toBe(201);expect((await f.post(p)).status).toBe(200);
  await f.arrival();
  expect(await db.attendance.count({where:{childId:f.child.id}})).toBe(1);
  expect((await f.gate()).body.attendanceStatus).toBe('CHECKIN_PENDING');
  const pending=await get('/api/v1/attendance?status=CHECKIN_PENDING');const row=pending.body.data.find(a=>a.childId===f.child.id);
  expect(row.canConfirm).toBe(true);expect(row.observations).toHaveLength(1);
  expect(row.child.name).toBe(f.child.name);expect(row.observations[0].event.device.hardwareId).toBe(f.device.hardwareId);expect(row.observations[0].event.beacon.hardwareId).toBe(gateBeacon.hardwareId);
 });
 it('admin approval persists actual identity and role and is safe under concurrent retries',async()=>{
  const f=await flow(),a=await f.arrival();
  const replies=await Promise.all([confirm(a.id),confirm(a.id)]);expect(replies.map(r=>r.status)).toEqual([200,200]);
  expect((await confirm(a.id)).status).toBe(200);
  expect(await db.confirmation.count({where:{attendanceId:a.id}})).toBe(1);
  expect((await db.confirmation.findUnique({where:{attendanceId:a.id}})).userId).toBe(admin.id);
  expect((await db.auditLog.findMany({where:{resourceId:a.id}})).map(log=>log.action)).toEqual(['ATTENDANCE_CONFIRMED_ADMIN']);
  expect((await f.gate()).body).toEqual({attendanceStatus:'PRESENT',gatePassAuthorized:false,attendanceDay:a.day});
  const fresh=await get('/api/v1/attendance');expect(fresh.body.data.find(row=>row.id===a.id).confirmations[0].roleAtConfirmation).toBe('ADMIN');
  expect((await get('/api/v1/attendance?status=CHECKIN_PENDING')).body.data.some(row=>row.id===a.id)).toBe(false);
  expect(JSON.stringify(fresh.body)).not.toMatch(/passwordHash|tokenHash/);
 });
 it('denies devices, unauthenticated, parent, transport and unrelated admins; preserves teacher confirmation',async()=>{
  const f=await flow(),a=await f.arrival(),path=`/api/v1/attendance/${a.id}/confirm`;
  expect((await request(app).post(path).send({})).status).toBe(401);
  expect((await request(app).post(path).set('X-Device-Token',deviceToken).send({})).status).toBe(401);
  for(const user of [parent,transport]) expect((await confirm(a.id,user)).status).toBe(403);
  expect((await confirm(a.id,outsider)).status).toBe(404);
  expect((await confirm(a.id,teacher)).status).toBe(200);
  expect((await db.auditLog.findFirst({where:{resourceId:a.id}})).action).toBe('ATTENDANCE_CONFIRMED_TEACHER');
 });
 it('count uses real pending rows and is center-scoped',async()=>{
  const f=await flow(),before=(await get('/api/v1/attendance/pending-count')).body.data.count;
  const a=await f.arrival();expect((await get('/api/v1/attendance/pending-count')).body.data.count).toBe(before+1);
  expect((await get('/api/v1/attendance/pending-count',outsider)).body.data.count).toBe(0);
  await confirm(a.id);expect((await get('/api/v1/attendance/pending-count')).body.data.count).toBe(before);
 });
 it('BLE readings alone never create attendance or danger alerts',async()=>{
  const f=await flow();for(const state of ['NEAR','FAR','UNKNOWN','NEAR']) expect((await f.ble(state)).status).toBe(201);
  expect(await db.attendance.count({where:{childId:f.child.id}})).toBe(0);
  expect(await db.alert.count({where:{event:{deviceId:f.device.id}}})).toBe(0);
 });
 it('pending/near-only and pre-confirmation FAR never generate danger alerts',async()=>{
  const f=await flow(),a=await f.arrival();await f.ble('FAR');expect((await f.danger()).body.data.suppressionReason).toBe('NOT_CONFIRMED_PRESENT');
  await confirm(a.id);expect((await f.danger()).body.data.suppressionReason).toBe('FAR_PRECEDES_CONFIRMATION');
  expect(await db.alert.count({where:{kind:'DANGER_ZONE_NEAR',event:{deviceId:f.device.id}}})).toBe(0);
 });
 it('fresh confirmed FAR permits one danger alert per approach and re-arms after FAR',async()=>{
  const f=await flow(),a=await f.arrival();await confirm(a.id);await f.ble('FAR');await f.ble('NEAR');
  const p=f.payload('DANGER_ZONE_NEAR',{queueAgeMs:0});expect((await f.post(p)).body.data.alertCreated).toBe(true);
  expect((await f.post(p)).body.data.duplicate).toBe(true);expect((await f.danger()).body.data.suppressionReason).toBe('APPROACH_ALREADY_REPORTED');
  await f.ble('FAR');expect((await f.danger()).body.data.alertCreated).toBe(true);
  expect(await db.alert.count({where:{kind:'DANGER_ZONE_NEAR',event:{deviceId:f.device.id}}})).toBe(2);
  const alerts=await get('/api/v1/alerts');const row=alerts.body.data.find(r=>r.event.deviceId===f.device.id);
  expect(row).toMatchObject({kind:'DANGER_ZONE_NEAR',status:'RECORDED'});expect(row.event.payload.rssi).toBe(-50);expect(row.event.child.id).toBe(f.child.id);
  expect((await get('/api/v1/alerts',outsider)).body.data).toHaveLength(0);
  expect((await get('/api/v1/alerts',parent)).status).toBe(403);
 });
 it('gate-pass authorization, UNKNOWN, reboot and delayed events suppress alerts',async()=>{
  const f=await flow(),a=await f.arrival();await confirm(a.id);await f.ble('FAR');
  await db.attendance.update({where:{id:a.id},data:{gatePassAuthorized:true}});
  expect((await f.gate()).body.gatePassAuthorized).toBe(true);expect((await f.danger()).body.data.suppressionReason).toBe('GATE_PASS_AUTHORIZED');
  await db.attendance.update({where:{id:a.id},data:{gatePassAuthorized:false}});
  await f.ble('UNKNOWN');expect((await f.danger()).body.data.suppressionReason).toBe('SIGNAL_UNKNOWN');
  await f.ble('FAR');expect((await f.danger({queueAgeMs:60000})).body.data.suppressionReason).toBe('STALE_OBSERVATION');
  expect((await f.danger({deviceUptimeMs:1})).body.data.suppressionReason).toBe('DEVICE_SESSION_CHANGED');
 });
 it('checked-out children stay checked out; old-day requests cannot be approved; new day can arrive',async()=>{
  const f=await flow(),a=await f.arrival();await confirm(a.id);
  await db.attendance.update({where:{id:a.id},data:{status:'CHECKED_OUT'}});
  await f.arrival();expect((await f.gate()).body.attendanceStatus).toBe('CHECKED_OUT');expect((await confirm(a.id)).status).toBe(409);
  expect((await f.danger()).body.data.suppressionReason).toBe('NOT_CONFIRMED_PRESENT');
  const yesterday=attendanceDay(new Date(Date.now()-86400000));
  await db.attendance.update({where:{id:a.id},data:{day:yesterday}});
  expect((await confirm(a.id)).status).toBe(409);
  const next=await f.arrival();expect(next.id).not.toBe(a.id);expect(next.status).toBe('CHECKIN_PENDING');
 });
});

const devApp=()=>createApp({db,jwtSecret:secret,environment:'test',enableDevAttendanceReset:'true',logger:{error(){}}});
const resetRequest=(app,id,confirmedAt,user=admin)=>request(app).post(`/api/v1/attendance/${id}/reset`).set('Authorization',`Bearer ${sign(user)}`).send({confirmedAt});
async function approvedFlow(){const f=await flow(),a=await f.arrival();await confirm(a.id);const c=await db.confirmation.findUnique({where:{attendanceId:a.id}});return {...f,a,c};}
describe('development reset lifecycle',()=>{
 it('GET attendance is read-only and keeps historical pending rows',async()=>{
  const f=await flow(),a=await f.arrival(),count=await db.attendance.count();
  await get('/api/v1/attendance');await get('/api/v1/attendance');
  expect(await db.attendance.count()).toBe(count);
  await db.attendance.update({where:{id:a.id},data:{day:'2020-01-01'}});
  expect((await get('/api/v1/attendance')).body.data.some(r=>r.id===a.id)).toBe(false);
  expect((await db.attendance.findUnique({where:{id:a.id}})).status).toBe('CHECKIN_PENDING');
 });
 it('requires explicit flag, nonproduction, ADMIN, JWT and matching center',async()=>{
  const f=await approvedFlow(),stamp=f.c.confirmedAt.toISOString();
  for(const [environment,flag] of [['production','true'],['test','false'],['development',null],[null,'true']]){
   const disabled=createApp({db,jwtSecret:secret,environment,enableDevAttendanceReset:flag});
   expect((await resetRequest(disabled,f.a.id,stamp)).status).toBe(403);
  }
  const app=devApp();expect((await resetRequest(app,f.a.id,stamp,teacher)).status).toBe(403);
  expect((await resetRequest(app,f.a.id,stamp,parent)).status).toBe(403);
  expect((await resetRequest(app,f.a.id,stamp,outsider)).status).toBe(404);
  expect((await request(app).post(`/api/v1/attendance/${f.a.id}/reset`).send({confirmedAt:stamp})).status).toBe(401);
 });
 it('resets transactionally, archives confirmation, records admin and disarms danger',async()=>{
  const f=await approvedFlow(),app=devApp(),stamp=f.c.confirmedAt.toISOString();await f.ble('FAR');
  const replies=await Promise.all([resetRequest(app,f.a.id,stamp),resetRequest(app,f.a.id,stamp)]);
  expect(replies.map(r=>r.status)).toEqual([200,200]);
  const state=(await f.gate()).body;expect(state.attendanceStatus).toBe('NOT_CHECKED_IN');expect(state.gatePassAuthorized).toBe(false);expect(state.attendanceEpoch).toBeTruthy();
  expect((await db.confirmation.findUnique({where:{attendanceId:f.a.id}})).confirmedAt).toEqual(f.c.confirmedAt);
  const audits=await db.auditLog.findMany({where:{resourceId:f.a.id}});
  expect(audits.filter(r=>r.action==='ATTENDANCE_DEV_RESET')).toHaveLength(1);
  expect(audits.find(r=>r.action==='ATTENDANCE_DEV_RESET').userId).toBe(admin.id);
  expect(audits.find(r=>r.action.startsWith('ATTENDANCE_CONFIRMATION_SNAPSHOT:')).action).toContain(stamp);
  expect((await f.danger()).body.data.suppressionReason).toBe('ATTENDANCE_CYCLE_CHANGED');
  expect((await f.post(f.payload('CHILD_NEAR_GATE'))).status).toBe(409);
  expect((await f.post(f.payload('CHILD_NEAR_GATE',{attendanceEpoch:state.attendanceEpoch}))).status).toBe(409);
  const epoch={attendanceEpoch:state.attendanceEpoch};
  await f.post(f.payload('BLE_PROXIMITY',{...epoch,proximity:'FAR',rssi:-90,queueAgeMs:0}));
  const arrival=f.payload('CHILD_NEAR_GATE',epoch);expect((await f.post(arrival)).status).toBe(201);expect((await f.post(arrival)).status).toBe(200);
  expect(await db.attendance.count({where:{childId:f.child.id}})).toBe(1);
  expect((await confirm(f.a.id)).status).toBe(409);
  const approve=()=>request(app).post(`/api/v1/attendance/${f.a.id}/confirm`).set('Authorization',`Bearer ${sign(admin)}`).send(epoch);
  expect((await approve()).status).toBe(200);
  expect((await resetRequest(app,f.a.id,stamp)).status).toBe(409);
  expect((await f.danger(epoch)).body.data.suppressionReason).toBe('FAR_PRECEDES_CONFIRMATION');
  const row=(await get('/api/v1/attendance')).body.data.find(r=>r.id===f.a.id);
  expect(row.confirmationHistory[0].confirmedAt).toBe(stamp);expect(row.observations[0].event.eventId).toBe(arrival.eventId);
  const latest=await db.confirmation.findUnique({where:{attendanceId:f.a.id}});
  expect((await resetRequest(app,f.a.id,latest.confirmedAt.toISOString())).status).toBe(200);
  expect((await f.post(arrival)).body.data.duplicate).toBe(true);
  expect((await f.gate()).body.attendanceStatus).toBe('NOT_CHECKED_IN');
  expect((await f.post(f.payload('CHILD_NEAR_GATE',epoch))).status).toBe(409);
  expect(await db.auditLog.count({where:{resourceId:f.a.id,action:'ATTENDANCE_DEV_RESET'}})).toBe(2);
 });
 it('rejects stale FAR, old cycle and pending reset; concurrent approve/reset stays consistent',async()=>{
  const f=await approvedFlow(),app=devApp(),stamp=f.c.confirmedAt.toISOString();
  const results=await Promise.all([confirm(f.a.id),resetRequest(app,f.a.id,stamp)]);
  expect(results[1].status).toBe(200);expect([200,409]).toContain(results[0].status);
  const epoch={attendanceEpoch:(await f.gate()).body.attendanceEpoch};
  await f.post(f.payload('BLE_PROXIMITY',{...epoch,proximity:'FAR',rssi:-90,queueAgeMs:60000}));
  expect((await f.post(f.payload('CHILD_NEAR_GATE',epoch))).status).toBe(409);
  await f.post(f.payload('BLE_PROXIMITY',{...epoch,proximity:'FAR',rssi:-90,queueAgeMs:0}));
  await f.post(f.payload('BLE_PROXIMITY',{...epoch,proximity:'UNKNOWN',queueAgeMs:0}));
  expect((await f.post(f.payload('CHILD_NEAR_GATE',epoch))).status).toBe(409);
  const pending=await flow(),a=await pending.arrival();
  expect((await resetRequest(app,a.id,stamp)).status).toBe(409);
 });
 it('exposes actual registered gate identity in Devices API',async()=>{
  const f=await flow();await f.ble('NEAR');
  const row=(await get(`/api/v1/devices/${f.device.id}`)).body.data;
  expect(row.bleState.gateId).toBe(gateBeacon.hardwareId);
  expect(row.bleState.beaconType).toBe('Gate / Attendance + Danger Zone');
 });
});
