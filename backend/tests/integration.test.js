import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
// This suite never truncates data. Each run creates unique fixtures in a dedicated database.
validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const secret=randomUUID()+randomUUID(), deviceToken=randomUUID()+randomUUID();
const app=createApp({db,jwtSecret:secret,logger:{error(){}}});
const suffix=randomUUID(); let center,otherCenter,device,child,admin,teacher,parent,auth,teacherAuth,parentAuth;
const sign=u=>jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const payload=(type='CHILD_NEAR_GATE')=>({eventId:randomUUID(),eventType:type,deviceId:device.hardwareId,gateId:`G-${suffix}`,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1234,...(['CHILD_NEAR_GATE','DANGER_ZONE_NEAR'].includes(type)?{rssi:-50}:{})});
const post=p=>request(app).post('/api/events').set('X-Device-Token',deviceToken).send(p);
const gate=()=>request(app).get('/api/gate/state').query({deviceId:device.hardwareId,gateId:`G-${suffix}`}).set('X-Device-Token',deviceToken);
beforeAll(async()=>{
 await assertTestDatabase(db);
 center=await db.center.create({data:{name:suffix}}); otherCenter=await db.center.create({data:{name:suffix+'other'}});
 child=await db.child.create({data:{name:'Synthetic test child',centerId:center.id}});
 device=await db.device.create({data:{hardwareId:`D-${suffix}`,tokenHash:tokenHash(deviceToken),centerId:center.id}});
 await db.beacon.create({data:{hardwareId:`G-${suffix}`,centerId:center.id}});
 await db.assignment.create({data:{deviceId:device.id,childId:child.id}});
 const hash=await bcrypt.hash('Synthetic-test-password',4);
 const user=role=>db.user.create({data:{username:role+suffix,passwordHash:hash,role,centerId:center.id}});
 admin=await user('ADMIN');teacher=await user('TEACHER');parent=await user('PARENT');
 auth=sign(admin);teacherAuth=sign(teacher);parentAuth=sign(parent);
});
afterAll(async()=>{await db.$disconnect();});
describe('real PostgreSQL API',()=>{
 it('health queries database',async()=>expect((await request(app).get('/api/health')).status).toBe(200));
 it('auth login and me; invalid credentials',async()=>{
  const r=await request(app).post('/api/v1/auth/login').send({username:admin.username,password:'Synthetic-test-password'});expect(r.status).toBe(200);
  expect((await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${r.body.data.token}`)).body.data.id).toBe(admin.id);
  expect((await request(app).post('/api/v1/auth/login').send({username:admin.username,password:'wrong'})).status).toBe(401);
 });
 it('invalid token, unknown device, malformed JSON and invalid schema',async()=>{
  expect((await request(app).post('/api/events').set('X-Device-Token','wrong').send(payload())).status).toBe(401);
  expect((await post({...payload(),deviceId:'unregistered'})).status).toBe(401);
  expect((await request(app).post('/api/events').set('Content-Type','application/json').send('{')).status).toBe(400);
  expect((await post({...payload(),gpsStatus:'invented'})).status).toBe(422);
 });
 it('persists authenticated observation, updates last seen, deduplicates and handles conflicts',async()=>{
  const p=payload(); const r=await post(p);expect(r.status).toBe(201);
  const saved=await db.deviceEvent.findUnique({where:{eventId:p.eventId}});expect(saved.payload).toEqual(p);expect(saved.deviceUptimeMs).toBe(1234n);expect(saved.childId).toBe(child.id);
  expect((await db.device.findUnique({where:{id:device.id}})).lastSeen).toEqual(saved.receivedAt);
  expect((await post(p)).body.data.duplicate).toBe(true);
  expect(await db.deviceEvent.count({where:{eventId:p.eventId}})).toBe(1);
  expect((await post({...p,rssi:-51})).status).toBe(409);
 });
 it('gate pending, unauthorized confirmation, teacher confirmed PRESENT and audit',async()=>{
  const r=await gate();expect(r.status).toBe(200);expect(r.body).toEqual({attendanceStatus:'CHECKIN_PENDING',gatePassAuthorized:false,attendanceDay:attendanceDay(new Date())});
  const a=await db.attendance.findUnique({where:{childId_day:{childId:child.id,day:r.body.attendanceDay}}});
  const path=`/api/v1/attendance/${a.id}/confirm`;
  expect((await request(app).post(path).send({})).status).toBe(401);
  expect((await request(app).post(path).set('Authorization',`Bearer ${parentAuth}`).send({})).status).toBe(403);
  const outsider=await db.user.create({data:{username:'outside'+suffix,passwordHash:'unused',role:'TEACHER',centerId:otherCenter.id}});
  expect((await request(app).post(path).set('Authorization',`Bearer ${sign(outsider)}`).send({})).status).toBe(404);
  expect((await request(app).post(path).set('Authorization',`Bearer ${teacherAuth}`).send({})).body.data.status).toBe('PRESENT');
  expect((await gate()).body.attendanceStatus).toBe('PRESENT');
  expect(await db.observation.count({where:{attendanceId:a.id}})).toBeGreaterThan(0);
  expect((await db.confirmation.findUnique({where:{attendanceId:a.id}})).userId).toBe(teacher.id);
  expect(await db.auditLog.count({where:{resourceId:a.id}})).toBe(1);
  await post(payload());expect((await gate()).body.attendanceStatus).toBe('PRESENT');
 });
 it('all telemetry types and missing GPS stay absent; no fabricated battery',async()=>{
  for(const type of ['GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP']) {
   const p=payload(type);if(type==='ACTIVITY_WINDOW') Object.assign(p,{activityState:'ACTIVE',accelRms:0.4,gyroRms:0.2});
   expect((await post(p)).status).toBe(201);
   const e=await db.deviceEvent.findUnique({where:{eventId:p.eventId}});expect(e.payload.latitude).toBeUndefined();expect(e.payload.longitude).toBeUndefined();
  }
  expect((await post({...payload('GPS_STATUS'),latitude:1,longitude:2})).status).toBe(422);
  expect((await post({...payload('GPS_STATUS'),gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8})).status).toBe(201);
  const r=await request(app).get(`/api/v1/devices/${device.id}`).set('Authorization',`Bearer ${auth}`);expect(r.status).toBe(200);expect(r.body.data.batteryPercent).toBeNull();
  expect((await request(app).get('/api/v1/events').set('Authorization',`Bearer ${auth}`)).status).toBe(200);
 });
 it('concurrent retries produce one event',async()=>{
  const p=payload('GPS_STATUS');const replies=await Promise.all([post(p),post(p)]);expect(replies.map(r=>r.status).sort()).toEqual([200,201]);expect(await db.deviceEvent.count({where:{eventId:p.eventId}})).toBe(1);
 });
 it('unknown gate rolls back event and lastSeen',async()=>{
  const before=await db.device.findUnique({where:{id:device.id}});const p={...payload(),gateId:'unknown'};
  expect((await post(p)).status).toBe(422);expect(await db.deviceEvent.count({where:{eventId:p.eventId}})).toBe(0);
  expect((await db.device.findUnique({where:{id:device.id}})).lastSeen).toEqual(before.lastSeen);
 });
 it('database transaction failure returns structured 503 without success',async()=>{
  const broken=createApp({db:{device:db.device,$transaction:async()=>{throw new Error('private database detail');}},jwtSecret:secret,logger:{error(){}}});
  const r=await request(broken).post('/api/events').set('X-Device-Token',deviceToken).send(payload());expect(r.status).toBe(503);expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');expect(JSON.stringify(r.body)).not.toContain('private');
 });
 it('database statement failure rolls back event and last-seen',async()=>{
  const before=await db.device.findUnique({where:{id:device.id}});
  const p=payload('GPS_STATUS');
  // A failing DB statement after the real ingestion callback proves transaction atomicity.
  const failingDb={...db,$transaction:(work,options)=>db.$transaction(async tx=>{
   await work(tx);
   await tx.$executeRawUnsafe('SELECT 1 / 0');
  },options)};
  const failing=createApp({db:{device:db.device,$transaction:failingDb.$transaction},jwtSecret:secret,logger:{error(){}}});
  const r=await request(failing).post('/api/events').set('X-Device-Token',deviceToken).send(p);
  expect(r.status).toBe(503);
  expect(await db.deviceEvent.count({where:{eventId:p.eventId}})).toBe(0);
  expect((await db.device.findUnique({where:{id:device.id}})).lastSeen).toEqual(before.lastSeen);
 });
 it('BLE transitions, heartbeat, retries and stale data remain separate from attendance',async()=>{
  const before=await db.attendance.findMany({where:{childId:child.id},include:{observations:true,confirmations:true}});
  const alerts=await db.alert.count({where:{event:{deviceId:device.id}}});
  for(const proximity of ['NEAR','FAR','UNKNOWN','NEAR','NEAR']) {
   const p={...payload('BLE_PROXIMITY'),proximity,queueAgeMs:2000,...(proximity==='UNKNOWN'?{}:{rssi:-65.25})};
   expect((await post(p)).status).toBe(201);
   expect((await db.deviceEvent.findUnique({where:{eventId:p.eventId}})).payload).toEqual(p);
   const r=await request(app).get(`/api/v1/devices/${device.id}`).set('Authorization',`Bearer ${auth}`);
   expect(r.body.data.bleState).toMatchObject({gateId:p.gateId,proximity,rssi:p.rssi??null,stale:false});
   expect(new Date(r.body.data.bleState.receivedAt)-new Date(r.body.data.bleState.observedAt)).toBe(2000);
   const seen=(await db.device.findUnique({where:{id:device.id}})).lastSeen;
   expect((await post({...p,queueAgeMs:5000})).body.data.duplicate).toBe(true);
   expect((await db.device.findUnique({where:{id:device.id}})).lastSeen).toEqual(seen);
   expect((await post({...p,rssi:-60,proximity:'FAR'})).status).toBe(409);
  }
  expect(await db.attendance.findMany({where:{childId:child.id},include:{observations:true,confirmations:true}})).toEqual(before);
  expect(await db.alert.count({where:{event:{deviceId:device.id}}})).toBe(alerts);
  const old={...payload('BLE_PROXIMITY'),proximity:'FAR',rssi:-90,queueAgeMs:90000};
  expect((await post(old)).status).toBe(201);
  const restarted=createApp({db,jwtSecret:secret,logger:{error(){}}});
  const r=await request(restarted).get(`/api/v1/devices/${device.id}`).set('Authorization',`Bearer ${auth}`);
  // Delayed FAR remains historical; it cannot overwrite the newer live NEAR.
  expect(r.body.data.bleState).toMatchObject({proximity:'NEAR',stale:false});
  expect(r.body.data.connectionState).toBe('ONLINE');
  await db.deviceEvent.updateMany({where:{deviceId:device.id,eventType:'BLE_PROXIMITY'},data:{receivedAt:new Date(Date.now()-360000),observedAt:new Date(Date.now()-360000)}});
  await db.device.update({where:{id:device.id},data:{lastSeen:new Date(Date.now()-360000)}});
  const stopped=await request(app).get(`/api/v1/devices/${device.id}`).set('Authorization',`Bearer ${teacherAuth}`);
  expect(stopped.body.data.bleState.stale).toBe(true);expect(stopped.body.data.connectionState).toBe('OFFLINE');
 });
 it('rejects invalid BLE data and enforces device and gate authentication',async()=>{
  const p={...payload('BLE_PROXIMITY'),proximity:'NEAR',rssi:-50,queueAgeMs:0};
  for(const patch of [{proximity:'OBSERVING'},{proximity:undefined},{rssi:undefined},{rssi:-128},{rssi:1},{queueAgeMs:-1},{queueAgeMs:undefined},{queueAgeMs:1.5},{proximity:'UNKNOWN'},{eventId:'bad id'},{extra:true}]) expect((await post({...p,...patch})).status).toBe(422);
  expect((await post({...p,gateId:'unknown'})).status).toBe(422);
  const foreign=await db.beacon.create({data:{hardwareId:`foreign-${suffix}`,centerId:otherCenter.id}});
  expect((await post({...p,gateId:foreign.hardwareId})).status).toBe(422);
  expect((await request(app).post('/api/events').set('X-Device-Token','invalid').send(p)).status).toBe(401);
  expect((await request(app).get(`/api/v1/devices/${device.id}`)).status).toBe(401);
 });
 it('Colombo day boundary',()=>{expect(attendanceDay(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20');});
});
