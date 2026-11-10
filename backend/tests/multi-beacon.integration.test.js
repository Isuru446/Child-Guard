import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { GATE_ID,GATE_UUID } from '../src/beacons.js';
import { attendanceDay } from '../src/events.js';
validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const secret=randomUUID()+randomUUID(),token=randomUUID()+randomUUID();
const app=createApp({db,jwtSecret:secret,environment:'test',enableDevAttendanceReset:'true',logger:{error(){}}});
let center,other,admin,teacher,outsider,parent,device,child,gate,zone,zone2;
const created=[];
const sign=u=>jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const api=(method,path,body,user=admin)=>request(app)[method](path).set('Authorization',`Bearer ${sign(user)}`).send(body);
const registration=(extra={})=>({hardwareId:`DZ-${randomUUID()}`,kind:'DANGER_ZONE',name:'Pool beacon',location:'Synthetic pool',description:'Test only',serviceUuid:randomUUID(),entryRssi:-63,exitRssi:-69,attendanceRssi:null,active:true,...extra});
const register=async(extra={})=>{const r=await api('post','/api/v1/beacons',registration(extra));if(r.status===201)created.push(r.body.data.id);return r;};
const config=()=>request(app).get('/api/device/beacons').query({deviceId:device.hardwareId}).set('X-Device-Token',token);
let uptime=1000;
const event=(beacon,type='BLE_PROXIMITY',extra={})=>({eventId:randomUUID(),deviceId:device.hardwareId,beaconId:beacon.hardwareId,beaconUuid:beacon.serviceUuid,eventType:type,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:uptime+=1000,queueAgeMs:0,...(type==='BLE_PROXIMITY'?{proximity:'NEAR',rssi:-50}:type==='DANGER_ZONE_NEAR'?{rssi:-50}:{}),...extra});
const post=p=>request(app).post('/api/events').set('X-Device-Token',token).send(p);
const patch=(b,extra={})=>api('patch',`/api/v1/beacons/${b.id}`,Object.fromEntries(Object.entries({...b,...extra}).filter(([key])=>['name','location','description','serviceUuid','entryRssi','exitRssi','attendanceRssi','active','identityChangeAcknowledged'].includes(key))));
beforeAll(async()=>{
 await assertTestDatabase(db);
 const existing=await db.beacon.findUnique({where:{hardwareId:GATE_ID}});
 center=existing?await db.center.findUnique({where:{id:existing.centerId}}):await db.center.create({data:{name:'Synthetic multi-beacon center'}});
 gate=existing||await db.beacon.create({data:{hardwareId:GATE_ID,serviceUuid:GATE_UUID,centerId:center.id}});
 other=await db.center.create({data:{name:'Other synthetic beacon center'}});
 const user=(role,centerId=center.id)=>db.user.create({data:{username:randomUUID(),role,centerId,passwordHash:'test-only'}});
 admin=await user('ADMIN');teacher=await user('TEACHER');parent=await user('PARENT');outsider=await user('ADMIN',other.id);
 device=await db.device.create({data:{hardwareId:`wear-${randomUUID()}`,centerId:center.id,tokenHash:tokenHash(token)}});
 child=await db.child.create({data:{name:'Synthetic multi-beacon child',centerId:center.id}});
 await db.assignment.create({data:{deviceId:device.id,childId:child.id}});
});
afterAll(async()=>{await db.beacon.updateMany({where:{id:{in:created}},data:{active:false}});await db.$disconnect();});
describe('registered beacons, configuration and independent telemetry',()=>{
 it('registers real metadata and audit with admin center; rejects duplicates and validation errors',async()=>{
  const r=await register();expect(r.status).toBe(201);zone=r.body.data;expect(zone.centerId).toBe(center.id);expect(zone.createdById).toBe(admin.id);
  expect((await register({hardwareId:zone.hardwareId})).status).toBe(409);expect((await register({serviceUuid:zone.serviceUuid.toUpperCase()})).status).toBe(409);
  for(const extra of [{serviceUuid:'invalid'},{entryRssi:-130},{exitRssi:-62},{entryRssi:-62,exitRssi:-64},{attendanceRssi:-50},{centerId:other.id},{kind:'POOL'}]) expect((await register(extra)).status).toBe(422);
  zone2=(await register({name:'Stair beacon',location:'Synthetic staircase'})).body.data;
 });
 it('protects roles, centers and gate identity; edits metadata and requires provisioning acknowledgement',async()=>{
  for(const user of [teacher,parent]) expect((await api('post','/api/v1/beacons',registration(),user)).status).toBe(403);
  expect((await request(app).post('/api/v1/beacons').send(registration())).status).toBe(401);
  expect((await api('get',`/api/v1/beacons/${zone.id}`,undefined,outsider)).status).toBe(404);
  const edit=Object.fromEntries(Object.entries(zone).filter(([key])=>['name','location','description','serviceUuid','entryRssi','exitRssi','attendanceRssi','active'].includes(key)));
  expect((await api('patch',`/api/v1/beacons/${zone.id}`,edit,outsider)).status).toBe(404);
  expect((await api('patch',`/api/v1/beacons/${zone.id}`,edit,teacher)).status).toBe(403);
  expect((await api('get',`/api/v1/beacons/${zone.id}`,undefined,teacher)).status).toBe(200);
  expect((await register({kind:'GATE',attendanceRssi:-55})).status).toBe(422);
  expect((await register({kind:'GATE',hardwareId:GATE_ID,serviceUuid:GATE_UUID,attendanceRssi:-55})).body.error.code).toBe('GATE_EXISTS');
  expect((await patch(gate,{name:'Main gate',location:'Entrance',active:false})).status).toBe(409);
  expect((await patch(gate,{name:'Main gate',location:'Entrance',serviceUuid:randomUUID()})).status).toBe(409);
  expect((await patch(zone,{name:'Updated pool'})).status).toBe(200);
  const newUuid=randomUUID();expect((await patch(zone,{serviceUuid:newUuid})).status).toBe(409);
  const edited=await patch(zone,{serviceUuid:newUuid,identityChangeAcknowledged:true});expect(edited.status).toBe(200);zone=edited.body.data;
 });
 it('authenticates device config, excludes other centers and reflects deactivation/revision changes',async()=>{
  expect((await request(app).get('/api/device/beacons').query({deviceId:device.hardwareId}).set('X-Device-Token','bad')).status).toBe(401);
  expect((await request(app).get('/api/device/beacons').query({deviceId:'unknown'}).set('X-Device-Token',token)).status).toBe(401);
  const foreign=await db.beacon.create({data:{...registration(),centerId:other.id}});
  const first=await config();expect(first.status).toBe(200);expect(first.body.data.beacons.some(b=>b.beaconId===zone.hardwareId)).toBe(true);expect(first.body.data.beacons.some(b=>b.beaconId===foreign.hardwareId)).toBe(false);
  expect((await patch(zone,{active:false})).status).toBe(200);
  const next=(await config()).body.data;expect(next.revision).not.toBe(first.body.data.revision);expect(next.beacons.some(b=>b.beaconId===zone.hardwareId)).toBe(false);
  expect((await post(event(zone))).status).toBe(422);expect((await patch(zone,{active:true})).status).toBe(200);
 });
 it('keeps simultaneous beacon identity and states; delayed observations cannot overwrite fresh ones',async()=>{
  const gateEvent={eventId:randomUUID(),eventType:'BLE_PROXIMITY',deviceId:device.hardwareId,gateId:GATE_ID,deviceUptimeMs:uptime+=1000,gpsStatus:'GPS_NO_FIX',proximity:'FAR',rssi:-90,queueAgeMs:0};
  expect((await post(gateEvent)).status).toBe(201);const p=event(zone);expect((await post(p)).status).toBe(201);expect((await post(p)).body.data.duplicate).toBe(true);
  expect((await post(event(zone2,'BLE_PROXIMITY',{proximity:'UNKNOWN',rssi:undefined}))).status).toBe(201);
  expect((await post(event(zone,'BLE_PROXIMITY',{proximity:'FAR',rssi:-90,queueAgeMs:90000}))).status).toBe(201);
  const r=await api('get',`/api/v1/devices/${device.id}`);expect(r.status).toBe(200);
  const states=r.body.data.beaconStates;expect(states.find(b=>b.beaconId===GATE_ID).proximity).toBe('FAR');expect(states.find(b=>b.beaconId===zone.hardwareId)).toMatchObject({proximity:'NEAR',location:'Synthetic pool'});expect(states.find(b=>b.beaconId===zone2.hardwareId).proximity).toBe('UNKNOWN');expect(r.body.data.bleState.gateId).toBe(GATE_ID);
  expect(await db.attendance.count({where:{childId:child.id}})).toBe(0);
 });
 it('danger-only cannot create attendance or misidentify a beacon; batch validates devices',async()=>{
  expect((await post(event(zone,'CHILD_NEAR_GATE',{queueAgeMs:undefined,rssi:-50}))).status).toBe(422);
  expect((await post(event(zone,'BLE_PROXIMITY',{gateId:GATE_ID}))).status).toBe(422);
  expect((await post(event(zone,'BLE_PROXIMITY',{beaconUuid:randomUUID()}))).status).toBe(422);
  expect((await post(event(zone,'BLE_PROXIMITY',{beaconId:undefined}))).status).toBe(422);
  const r=await request(app).post('/api/events/batch').set('X-Device-Token',token).send({deviceId:device.hardwareId,events:[event(zone),event(zone2)]});expect(r.status).toBe(200);expect(r.body.data.map(e=>e.status)).toEqual([201,201]);
  expect((await request(app).post('/api/events/batch').set('X-Device-Token',token).send({deviceId:device.hardwareId,events:[event(zone,'BLE_PROXIMITY',{deviceId:'other'})]})).status).toBe(422);
 });
 it('requires confirmed attendance and fresh identified NEAR; one alert per zone approach, FAR rearms',async()=>{
  expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('NOT_CONFIRMED_PRESENT');
  const a=await db.attendance.create({data:{childId:child.id,day:attendanceDay(new Date()),status:'CHECKIN_PENDING'}});
  expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);
  await api('post',`/api/v1/attendance/${a.id}/confirm`,{});
  await post(event(zone));await post(event(zone2));
  expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(true);
  expect((await post(event(zone2,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(true);
  expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('APPROACH_ALREADY_REPORTED');
  await post(event(zone,'BLE_PROXIMITY',{proximity:'UNKNOWN',rssi:undefined}));await post(event(zone));expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);
  await post(event(zone,'BLE_PROXIMITY',{proximity:'FAR',rssi:-90}));await post(event(zone));expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(true);
  expect((await post(event(zone2,'DANGER_ZONE_NEAR',{queueAgeMs:90000}))).body.data.alertCreated).toBe(false);
  const alerts=(await api('get','/api/v1/alerts')).body.data;expect(alerts.find(r=>r.event.beacon.hardwareId===zone.hardwareId).event.beacon.location).toBe('Synthetic pool');
  await patch(zone,{location:'Moved pool boundary'});
  const historical=(await api('get','/api/v1/alerts')).body.data.find(r=>r.event.beacon.hardwareId===zone.hardwareId);
  expect(historical.event.beacon.location).toBe('Synthetic pool');
  await patch(zone,{location:zone.location});
  const before=await db.deviceEvent.count({where:{beaconId:zone.id}});await patch(zone,{active:false});expect(await db.deviceEvent.count({where:{beaconId:zone.id}})).toBe(before);expect((await post(event(zone,'DANGER_ZONE_NEAR'))).status).toBe(422);await patch(zone,{active:true});
  const c=await db.confirmation.findUnique({where:{attendanceId:a.id}});await api('post',`/api/v1/attendance/${a.id}/reset`,{confirmedAt:c.confirmedAt.toISOString()});
  expect((await post(event(zone,'DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);
 });
 it('rejects incomplete configurations and clears only one beacon on signal loss',async()=>{
  const invalid=await db.beacon.create({data:{hardwareId:`invalid-${randomUUID()}`,kind:'DANGER_ZONE',centerId:center.id,attendanceRssi:null}});created.push(invalid.id);
  expect((await config()).body.error.code).toBe('CONFIG_INVALID');
  await db.beacon.update({where:{id:invalid.id},data:{active:false}});
  await post(event(zone));await post(event(zone2,'BLE_PROXIMITY',{proximity:'UNKNOWN',rssi:undefined}));
  const states=(await api('get',`/api/v1/devices/${device.id}`)).body.data.beaconStates;
  expect(states.find(b=>b.beaconId===zone.hardwareId).proximity).toBe('NEAR');expect(states.find(b=>b.beaconId===zone2.hardwareId).proximity).toBe('UNKNOWN');
 });
 it('rejects oversized active configurations without partial results',async()=>{
  const extras=[];
  try{
   for(let i=0;i<7;i++){const b=await db.beacon.create({data:{...registration(),centerId:center.id}});extras.push(b.id);created.push(b.id);}
   expect((await config()).body.error.code).toBe('CONFIG_TOO_LARGE');expect((await register()).body.error.code).toBe('CONFIG_TOO_LARGE');
  }finally{await db.beacon.updateMany({where:{id:{in:extras}},data:{active:false}});}
 });
});
