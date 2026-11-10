import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { GATE_ID, GATE_UUID } from '../src/beacons.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
import { createMonitoringHub } from '../src/monitoring-events.js';
const secret='synthetic-gate-registration-secret-over-32',password='Synthetic-gate-password',hash=bcrypt.hashSync(password,4),deviceToken='synthetic-private-gate-device-token-over-32';
let f,m,app,cookie,csrf,hub;
const gate=(extra={})=>({hardwareId:GATE_ID,kind:'GATE',serviceUuid:GATE_UUID,name:'Main gate',location:'Entrance',description:'',entryRssi:-63,exitRssi:-69,attendanceRssi:-55,active:true,...extra});
const write=(method,path,body,token=csrf)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',token||'').send(body);
const register=body=>write('post','/api/v1/beacons',body);
const adminGet=path=>request(app).get(path).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
const deviceGet=(path,extra={})=>request(app).get(path).query({deviceId:m.device.hardwareId,...extra}).set('X-Device-Token',deviceToken);
const event=(extra={})=>({eventId:randomUUID(),deviceId:m.device.hardwareId,gateId:GATE_ID,eventType:'GPS_STATUS',gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1000,...extra});
const send=body=>request(app).post('/api/events').set('X-Device-Token',deviceToken).send(body);
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash(deviceToken)});m.data().beacon=[];
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 hub=createMonitoringHub();app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(r.status).toBe(200);cookie=r.headers['set-cookie'][0].split(';')[0];csrf=r.body.data.csrfToken;
});
it('registers the first gate with cookie + CSRF, center ownership and audit, then serves device state/config and GPS',async()=>{
 expect((await adminGet('/api/v1/beacons/gate-registration')).body.data).toMatchObject({gate:null,hardwareId:GATE_ID,serviceUuid:GATE_UUID});
 const saved=await register(gate());expect(saved.status).toBe(201);expect(saved.body.data.centerId).toBe(f.state.user.centerId);
 expect(m.data().auditLog.at(-1).action).toBe('BEACON_REGISTERED');
 expect((await deviceGet('/api/gate/state',{gateId:GATE_ID})).status).toBe(200);
 expect((await deviceGet('/api/device/beacons')).body.data.beacons[0]).toMatchObject({beaconId:GATE_ID,serviceUuid:GATE_UUID,attendanceRssi:-55});
 expect((await send(event())).status).toBe(201);
});
const danger=()=>gate({hardwareId:'CG-DANGER-01',kind:'DANGER_ZONE',serviceUuid:'6f50c597-34c5-4707-be46-a51ed3942468',attendanceRssi:null});
it('refreshes the complete gate/zone device configuration after registration and active-state changes',async()=>{
 await register(gate());const before=await deviceGet('/api/device/beacons');expect(before.body.data.beacons).toHaveLength(1);
 expect((await register(danger())).status).toBe(201);const after=await deviceGet('/api/device/beacons');
 expect(after.status).toBe(200);expect(after.headers['cache-control']).toBe('no-store');expect(after.body.data.revision).not.toBe(before.body.data.revision);
 expect(after.body.data).toMatchObject({validForMs:300000,refreshAfterMs:60000,maxBeacons:8});
 expect(after.body.data.beacons).toEqual(expect.arrayContaining([expect.objectContaining({beaconId:GATE_ID,serviceUuid:GATE_UUID,kind:'GATE'}),expect.objectContaining({beaconId:'CG-DANGER-01',serviceUuid:danger().serviceUuid,kind:'DANGER_ZONE',entryRssi:-63,exitRssi:-69})]));
 m.data().beacon.find(b=>b.kind==='DANGER_ZONE').active=false;expect((await deviceGet('/api/device/beacons')).body.data.beacons).toHaveLength(1);
});
it('persists real-contract zone batch observations, exposes RSSI in both Admin views and invalidates SSE without creating an alert',async()=>{
 await register(gate());await register(danger());const notifications=[];const unsubscribe=hub.subscribe(m.device.centerId,e=>notifications.push(e));
 const now=vi.spyOn(Date,'now').mockImplementation(()=>f.clock);
 try{
  const observation=event({gateId:undefined,beaconId:'CG-DANGER-01',beaconUuid:danger().serviceUuid,eventType:'BLE_PROXIMITY',proximity:'NEAR',rssi:-45,queueAgeMs:100,deviceBootId:'same-boot'});
  const post=body=>request(app).post('/api/events/batch').set('X-Device-Token',deviceToken).send({deviceId:m.device.hardwareId,events:[body]});
  expect((await post(observation)).body.data[0]).toMatchObject({status:201,duplicate:false});
  expect(m.data().deviceEvent.at(-1)).toMatchObject({deviceId:m.device.id,childId:m.child.id,payload:expect.objectContaining({beaconId:'CG-DANGER-01',beaconUuid:danger().serviceUuid,proximity:'NEAR',rssi:-45})});
  const row=(await adminGet('/api/v1/beacons')).body.data.find(b=>b.hardwareId==='CG-DANGER-01');
  expect(row.observation).toMatchObject({proximity:'NEAR',rssi:-45,stale:false,wearableId:m.device.hardwareId});
  const device=await adminGet(`/api/v1/devices/${m.device.id}?management=true`);expect(device.status).toBe(200);
  expect(device.body.data.beaconStates.find(b=>b.beaconId==='CG-DANGER-01')).toMatchObject({proximity:'NEAR',rssi:-45});
  expect(notifications).toHaveLength(1);expect(notifications[0]).toMatchObject({topics:['devices'],alertIds:[]});
  expect((await post(observation)).body.data[0]).toMatchObject({status:200,duplicate:true});expect(notifications).toHaveLength(1);
  expect((await post({...observation,eventId:randomUUID(),beaconUuid:randomUUID()})).body.data[0]).toMatchObject({status:422,error:{code:'BEACON_IDENTITY_MISMATCH'}});
  expect(m.data().alert).toHaveLength(0);expect(notifications).toHaveLength(1);
  f.tick(46000);const stale=(await adminGet('/api/v1/beacons')).body.data.find(b=>b.hardwareId==='CG-DANGER-01');expect(stale.observation).toMatchObject({proximity:'UNKNOWN',rssi:-45,stale:true});
 }finally{unsubscribe();now.mockRestore();}
});
it.each([true,false])('rejects a second gate even if the existing gate is active=%s',async active=>{
 await register(gate());m.data().beacon[0].active=active;
 expect((await register(gate())).body.error.code).toBe('GATE_EXISTS');expect(m.data().beacon).toHaveLength(1);
 expect((await adminGet('/api/v1/beacons/gate-registration')).body.data.gate.active).toBe(active);
});
it('serializes concurrent first-gate requests',async()=>{
 expect((await Promise.all([register(gate()),register(gate())])).map(r=>r.status)).toEqual([201,409]);expect(m.data().beacon).toHaveLength(1);
});
it.each([{serviceUuid:randomUUID()},{serviceUuid:'invalid'},{hardwareId:'OTHER-GATE'},{active:false},{attendanceRssi:null},{attendanceRssi:-80},{exitRssi:-64},{entryRssi:1}])('rejects invalid identity/thresholds %j',async patch=>{
 expect((await register(gate(patch))).status).toBe(422);expect(m.data().beacon).toHaveLength(0);
});
it('keeps existing gate identity/type/activation protected and can reactivate its existing record',async()=>{
 const r=await register(gate());const {hardwareId,kind,...body}=gate();void hardwareId;void kind;
 const path=`/api/v1/beacons/${r.body.data.id}`;
 expect((await write('patch',path,{...body,serviceUuid:randomUUID(),identityChangeAcknowledged:true})).body.error.code).toBe('GATE_PROTECTED');
 expect((await write('patch',path,{...body,active:false})).status).toBe(409);
 expect((await write('patch',path,{...body,kind:'DANGER_ZONE'})).status).toBe(422);
 m.data().beacon[0].active=false;expect((await write('patch',path,body)).status).toBe(200);expect(m.data().beacon).toHaveLength(1);
});
it('still registers danger zones, reserves gate identity and refuses conversions/duplicate UUIDs',async()=>{
 const zone=gate({kind:'DANGER_ZONE',hardwareId:'CG-DZ-01',serviceUuid:randomUUID(),attendanceRssi:null});
 const r=await register(zone);expect(r.status).toBe(201);expect((await register({...zone,hardwareId:'CG-DZ-02'})).body.error.code).toBe('BEACON_CONFLICT');
 expect((await register({...zone,hardwareId:GATE_ID})).body.error.code).toBe('GATE_PROTECTED');
 const {hardwareId,...body}=zone;void hardwareId;expect((await write('patch',`/api/v1/beacons/${r.body.data.id}`,{...body,kind:'GATE'})).status).toBe(422);
});
it('preserves authentication, CSRF and role checks',async()=>{
 expect((await write('post','/api/v1/beacons',gate(),null)).status).toBe(403);
 expect((await request(app).post('/api/v1/beacons').set('Host','localhost:5174').set('Origin','http://localhost:5174').send(gate())).status).toBe(401);
 for(const user of [m.teacher,m.parent]){
  const bearer=jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
  expect((await request(app).post('/api/v1/beacons').set('Authorization',`Bearer ${bearer}`).send(gate())).status).toBe(403);
 }
 expect(m.data().beacon).toHaveLength(0);
});
it('isolates centers and returns useful unknown/inactive/mismatch/token errors',async()=>{
 expect((await deviceGet('/api/gate/state',{gateId:GATE_ID})).body.error.code).toBe('UNKNOWN_GATE');
 expect((await send(event())).body.error.code).toBe('UNKNOWN_GATE');
 await register(gate());m.data().beacon[0].centerId='center-b';
 expect((await adminGet('/api/v1/beacons/gate-registration')).body.data.gate).toBeNull();
 expect((await deviceGet('/api/gate/state',{gateId:GATE_ID})).status).toBe(422);
 expect((await register(gate())).body.error.code).toBe('BEACON_CONFLICT');
 m.data().beacon[0].centerId=m.device.centerId;m.data().beacon[0].active=false;
 expect((await deviceGet('/api/gate/state',{gateId:GATE_ID})).body.error.code).toBe('BEACON_INACTIVE');
 expect((await send(event())).body.error.code).toBe('BEACON_INACTIVE');m.data().beacon[0].active=true;
 expect((await send(event({beaconId:GATE_ID,beaconUuid:randomUUID()}))).body.error.code).toBe('BEACON_IDENTITY_MISMATCH');
 expect((await request(app).get('/api/gate/state').query({deviceId:m.device.hardwareId,gateId:GATE_ID}).set('X-Device-Token','wrong')).status).toBe(401);
 expect((await request(app).get('/api/gate/state').query({deviceId:'WRONG-DEVICE',gateId:GATE_ID}).set('X-Device-Token',deviceToken)).status).toBe(401);
 expect((await send(event({extra:'not allowed'}))).body.error.code).toBe('VALIDATION_ERROR');
});
it('reports individual unregistered beacon errors inside an accepted batch',async()=>{
 const body={deviceId:m.device.hardwareId,events:[event({gateId:undefined,beaconId:'CG-DZ-UNKNOWN',beaconUuid:randomUUID(),eventType:'BLE_PROXIMITY',queueAgeMs:0,proximity:'UNKNOWN'})]};
 const r=await request(app).post('/api/events/batch').set('X-Device-Token',deviceToken).send(body);
 expect(r.status).toBe(200);expect(r.body.data[0]).toMatchObject({status:422,error:{code:'UNKNOWN_GATE'}});
});
it('leaves Parent requests, claim provisioning and approval disabled when registration is off',async()=>{
 const bearer=jwt.sign({},secret,{subject:m.parent.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 for(const path of ['/api/v1/account/children','/api/v1/account/wearables']){
  const r=await request(app).post(path).set('Authorization',`Bearer ${bearer}`).send({});expect(r.status).toBe(503);expect(r.body.error.code).toBe('REGISTRATION_UNAVAILABLE');
 }
 expect((await write('post',`/api/v1/admin/devices/${m.device.id}/claim-code`,{})).status).toBe(503);
 for(const path of ['/api/v1/admin/registrations','/api/v1/admin/enrollments','/api/v1/admin/wearable-requests'])expect((await adminGet(path)).status).toBe(503);
 expect(m.data().assignment).toHaveLength(1);
});
