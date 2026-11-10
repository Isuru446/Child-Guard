import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
import { readSafetyAlerts, safetyAlertView } from '../src/safety-monitoring.js';
import { activitySchema, policySchema, DEFAULT_ACTIVITY_POLICY } from '../src/activity-contract.js';
const secret='synthetic-safety-session-secret-over-32',password='Synthetic-safety-password',hash=bcrypt.hashSync(password,4),deviceToken='synthetic-safety-device-credential-over-32';
let f,m,app,cookie,csrf,zone;
const bearer=u=>'Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const read=(query='')=>request(app).get('/api/v1/alerts?management=true'+query).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
const legacy=(extra={})=>({eventId:randomUUID(),deviceId:m.device.hardwareId,eventType:'GPS_STATUS',gateId:m.gate.hardwareId,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1000,...extra});
const send=body=>request(app).post('/api/events').set('X-Device-Token',deviceToken).send(body);
const zoneEvent=(type='BLE_PROXIMITY',extra={})=>{const e=legacy({gateId:undefined,beaconId:zone.hardwareId,beaconUuid:zone.serviceUuid,eventType:type,deviceBootId:'test-boot',deviceUptimeMs:2000,queueAgeMs:0,rssi:-40,...extra});if(type==='BLE_PROXIMITY'&&extra.proximity===undefined)e.proximity='NEAR';return e;};
async function departAndApproach(){await send(legacy({eventType:'BLE_PROXIMITY',proximity:'FAR',rssi:-90,queueAgeMs:0,deviceBootId:'test-boot',deviceUptimeMs:1100}));f.tick(1000);await send(zoneEvent('BLE_PROXIMITY',{proximity:'FAR',rssi:-90,deviceUptimeMs:1200}));f.tick(1000);await send(zoneEvent());f.tick(1000);}
async function present(){await send(legacy({eventType:'CHILD_NEAR_GATE',rssi:-40}));const r=await request(app).post(`/api/v1/attendance/${m.data().attendance[0].id}/confirm`).set('Authorization',bearer(m.teacher)).send({});expect(r.status).toBe(200);f.tick(1000);}
function stored(kind='LOW_ACTIVITY',payload={},options={}){
 const event={id:randomUUID(),eventId:randomUUID(),eventType:kind==='LOW_ACTIVITY'?'ACTIVITY_SUMMARY':'GPS_STATUS',deviceId:m.device.id,childId:m.child.id,beaconId:m.gate.id,receivedAt:new Date(f.clock),observedAt:new Date(f.clock),payload:{gpsStatus:'GPS_NO_FIX',...payload},...options};m.data().deviceEvent.push(event);const alert={id:randomUUID(),eventId:event.id,kind,createdAt:new Date(f.clock),details:null};m.data().alert.push(alert);return {event,alert};
}
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash(deviceToken)});zone={...m.gate,id:randomUUID(),hardwareId:'ZONE-ONE',serviceUuid:randomUUID(),kind:'DANGER_ZONE',name:'Stored zone',location:'Recorded corner',entryRssi:-63,exitRssi:-69};m.data().beacon.push(zone);
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(r.status).toBe(200);cookie=r.headers['set-cookie'][0].split(';')[0];csrf=r.body.data.csrfToken;
});
it('exposes the supported record-only capability inventory without a fake severity or acknowledgement state',async()=>{
 const {alert}=stored();const r=await read();expect(r.status).toBe(200);expect(r.body.data.rows[0]).toMatchObject({id:alert.id,state:'RECORDED',severity:null});expect(r.body.data.capabilities).toMatchObject({geofence:'BLOCKED_MIGRATION_REQUIRED',tamper:'AUTHENTICATED_GPIO_LOOP_V1',departureThenZoneApproach:'ENFORCED_SESSION_DEPARTURE_FRESH_SAME_BOOT_ZONE_FAR_NEAR',acknowledgement:false,dispatch:false});expect(r.headers['cache-control']).toBe('no-store');
});
it('does not create geofence incidents from valid, stale, missing or zero GPS telemetry',async()=>{
 for(const payload of [legacy({gpsStatus:'GPS_FIX',latitude:0,longitude:0}),legacy({gpsStatus:'GPS_FIX',latitude:90,longitude:180}),legacy({gpsStatus:'GPS_NO_FIX'})])expect((await send(payload)).status).toBe(201);
 expect(m.data().alert).toEqual([]);expect((await read()).body.data.total).toBe(0);
 expect((await send(legacy({gpsStatus:'GPS_NO_FIX',latitude:0,longitude:0}))).status).toBe(422);expect((await send(legacy({gpsStatus:'GPS_FIX',latitude:91,longitude:180}))).status).toBe(422);
});
it.each(['GEOFENCE_EXIT','GEOFENCE_VIOLATION','TAMPER','TAMPER_DETECTED'])('rejects unsupported event %s while preserving device authentication',async type=>{
 const body=legacy({eventType:type});expect((await send(body)).status).toBe(422);expect((await request(app).post('/api/events').set('X-Device-Token','incorrect').send(body)).status).toBe(401);expect(m.data().alert).toEqual([]);
});
it('requires Teacher PRESENT, actual gate departure and subsequent zone FAR-to-NEAR for ordinary zones',async()=>{
 const suppressed=zoneEvent('DANGER_ZONE_NEAR');
 expect((await send(suppressed)).body.data.suppressionReason).toBe('NOT_CONFIRMED_PRESENT');
 expect((await send(suppressed)).body.data).toMatchObject({duplicate:true,alertCreated:false,suppressionReason:'DUPLICATE_WITHOUT_ALERT'});await present();
 expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('NO_VERIFIED_DEPARTURE');await send(zoneEvent());expect(m.data().alert).toEqual([]);await departAndApproach();
 const candidate=zoneEvent('DANGER_ZONE_NEAR');const r=await send(candidate);expect(r.body.data.alertCreated).toBe(true);expect(m.data().deviceEvent.some(e=>e.beaconId===m.gate.id&&e.payload.proximity==='FAR')).toBe(true);
 const alert=(await read()).body.data.rows[0];expect(alert.assessment.verification).toBe('BACKEND_SEQUENCE_VALIDATED');expect(alert.event.zone.kind).toBe('DANGER_ZONE');expect(alert.severity).toBeNull();
 expect((await send(candidate)).body.data).toMatchObject({duplicate:true,alertCreated:true});expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('APPROACH_ALREADY_REPORTED');expect(m.data().alert).toHaveLength(1);
});
it('preserves current gate-return FAR-after-confirmation rules and never changes attendance through danger events',async()=>{
 await present();expect((await send(legacy({eventType:'DANGER_ZONE_NEAR',rssi:-40,deviceUptimeMs:2000}))).body.data.suppressionReason).toBe('NO_CONFIRMED_FAR');
 await send(legacy({eventType:'BLE_PROXIMITY',proximity:'FAR',rssi:-90,queueAgeMs:0,deviceUptimeMs:1100}));f.tick(1000);expect((await send(legacy({eventType:'DANGER_ZONE_NEAR',rssi:-40,deviceUptimeMs:2000}))).body.data.alertCreated).toBe(true);expect(m.data().attendance[0].status).toBe('PRESENT');
});
it('never substitutes signal loss, an old device boot, or an already-near zone for departure and approach',async()=>{
 await present();await send(zoneEvent());expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);
 await send(legacy({eventType:'BLE_PROXIMITY',proximity:'FAR',rssi:-90,queueAgeMs:0,deviceBootId:'test-boot',deviceUptimeMs:1100}));f.tick(1000);
 expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('NO_POST_DEPARTURE_ZONE_FAR');
 await departAndApproach();expect((await send(zoneEvent('DANGER_ZONE_NEAR',{deviceBootId:'previous-boot'}))).body.data.suppressionReason).toBe('NO_VERIFIED_DEPARTURE');
 await send(legacy({eventType:'BEACON_SIGNAL_LOST'}));expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(true);expect(m.data().alert.filter(a=>a.kind==='DANGER_ZONE_NEAR')).toHaveLength(1);
});
it('rejects wrong identities and centers, suppresses stale observations, and signal loss does not rearm an approach',async()=>{
 await present();await departAndApproach();expect((await send(zoneEvent('DANGER_ZONE_NEAR',{queueAgeMs:45001}))).body.data.alertCreated).toBe(false);
 expect((await send(zoneEvent('DANGER_ZONE_NEAR',{beaconUuid:randomUUID()}))).status).toBe(422);const candidate=zoneEvent('DANGER_ZONE_NEAR');expect((await send(candidate)).body.data.alertCreated).toBe(true);
 await send(zoneEvent('BEACON_SIGNAL_LOST',{queueAgeMs:undefined}));expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);
 zone.serviceUuid=randomUUID();m.data().beacon.find(b=>b.id===zone.id).serviceUuid=zone.serviceUuid;expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.alertCreated).toBe(false);m.data().beacon.find(b=>b.id===zone.id).centerId='center-b';expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).status).toBe(422);
});
it('serializes repeated danger candidates into one alert and rolls back event insertion on audit-independent persistence failure',async()=>{
 await present();await departAndApproach();const r=await Promise.all([send(zoneEvent('DANGER_ZONE_NEAR')),send(zoneEvent('DANGER_ZONE_NEAR'))]);expect(r.every(x=>x.status===201)).toBe(true);expect(m.data().alert.filter(a=>a.kind==='DANGER_ZONE_NEAR')).toHaveLength(1);
 const before=structuredClone(m.data());m.db.deviceEvent.create.mockRejectedValue(Error('synthetic-private-persistence-error'));expect((await send(legacy({eventType:'BEACON_SIGNAL_LOST'}))).status).toBe(503);expect(m.data()).toEqual(before);
});
it('refuses a zone approach after signal loss until a new actual FAR-to-NEAR sequence is recorded',async()=>{
 await present();await departAndApproach();await send(zoneEvent('BEACON_SIGNAL_LOST',{queueAgeMs:undefined}));expect((await send(zoneEvent('DANGER_ZONE_NEAR'))).body.data.suppressionReason).toBe('ZONE_SIGNAL_UNKNOWN');expect(m.data().alert.some(a=>a.kind==='DANGER_ZONE_NEAR')).toBe(false);
 f.tick(1000);await send(zoneEvent('BLE_PROXIMITY',{proximity:'FAR',rssi:-90,deviceUptimeMs:2100}));f.tick(1000);await send(zoneEvent('BLE_PROXIMITY',{deviceUptimeMs:2200}));f.tick(1000);expect((await send(zoneEvent('DANGER_ZONE_NEAR',{deviceUptimeMs:2300}))).body.data.alertCreated).toBe(true);
});
it('keeps new BLE loss only in device history, preserves legacy diagnostic alerts and never equates offline with tampering',async()=>{
 const e=legacy({eventType:'BEACON_SIGNAL_LOST'});expect((await send(e)).status).toBe(201);expect((await send(e)).body.data.duplicate).toBe(true);
 expect(m.data().deviceEvent.filter(row=>row.eventId===e.eventId)).toHaveLength(1);expect(m.data().deviceEvent.find(row=>row.eventId===e.eventId).eventType).toBe('BEACON_SIGNAL_LOST');
 expect(m.data().alert).toHaveLength(0);expect((await read()).body.data.rows).toEqual([]);
 const old=stored('BEACON_SIGNAL_LOST');m.data().device[0].lastSeen=new Date(f.clock-86400000);
 const row=(await read()).body.data.rows.find(row=>row.id===old.alert.id);expect(row.category).toBe('DEVICE_SIGNAL');expect(row.assessment.verification).toBe('DIAGNOSTIC_ONLY');expect(m.data().alert).toHaveLength(1);expect(row.kind).not.toMatch(/TAMPER/);
});
it('uses only the alert event’s valid GPS and never attaches another last-known fix as a new violation',async()=>{
 stored('BEACON_SIGNAL_LOST',{gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8});const missing=stored('BEACON_SIGNAL_LOST');const result=await read();expect(result.body.data.rows.find(r=>r.id===missing.alert.id).location).toBeNull();
 const zero=stored('BEACON_SIGNAL_LOST',{gpsStatus:'GPS_FIX',latitude:0,longitude:0});const z=(await read()).body.data.rows.find(r=>r.id===zero.alert.id);expect(z.location).toMatchObject({latitude:0,longitude:0,source:'THIS_RECORDED_EVENT'});
});
it('keeps delayed locations historical and preserves event snapshots after beacon identity changes',async()=>{
 const e=stored('DANGER_ZONE_NEAR',{gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8,beaconUuid:zone.serviceUuid,beaconMetadata:{kind:'DANGER_ZONE',name:'Original label',location:'Original location'}},{beaconId:zone.id,observedAt:new Date(f.clock-600000)});zone.serviceUuid=randomUUID();zone.name='Current label';const row=(await read()).body.data.rows.find(r=>r.id===e.alert.id);expect(row.location.freshness).toBe('HISTORICAL_OR_UNKNOWN_TIME');expect(row.event.zone).toMatchObject({name:'Original label',location:'Original location',identityChanged:true});
});
it('preserves recorded child ownership, redacts unknown JSON and refuses cross-center data',async()=>{
 const r=stored('LOW_ACTIVITY',{deviceToken:'do-not-return',passwordHash:'do-not-return'});r.alert.details={currentScoreMg:12,credential:'do-not-return'};const replacement={...m.child,id:randomUUID(),name:'Current replacement child'};m.data().child.push(replacement);m.data().assignment[0].childId=replacement.id;
 const row=(await read()).body.data.rows[0];expect(row.event.recordedChild.id).toBe(m.child.id);expect(JSON.stringify(row)).not.toContain('do-not-return');expect(JSON.stringify(row)).not.toContain(replacement.name);
 m.data().device[0].centerId='center-b';expect((await read()).body.data.rows).toEqual([]);
 expect(()=>safetyAlertView({event:{device:{centerId:'center-b'}}},'center-a',f.clock)).toThrow();
});
it('supports bounded record-date/category/child search and pagination without a fake state change',async()=>{
 for(let i=0;i<4;i++)stored(i===0?'LOW_ACTIVITY':'BEACON_SIGNAL_LOST');const first=await read('&limit=2&state=RECORDED');expect(first.body.data.rows).toHaveLength(2);expect(first.body.data.hasMore).toBe(true);expect(first.body.data.total).toBe(4);expect((await read('&limit=2&offset=2')).body.data.rows).toHaveLength(2);expect((await read('&category=ACTIVITY')).body.data.total).toBe(1);expect((await read('&childId='+m.foreignChild.id)).body.data.rows).toEqual([]);expect((await read('&search=Registered')).body.data.total).toBe(4);
});
it('rejects missing center authority and excludes foreign historical child or beacon relationships even on a local wearable',async()=>{
 await expect(readSafetyAlerts(m.db,{user:{role:'ADMIN'},query:{management:'true'}})).rejects.toMatchObject({status:403});
 stored('BEACON_SIGNAL_LOST',{}, {childId:m.foreignChild.id});
 const foreignBeacon={...zone,id:randomUUID(),centerId:'center-b'};m.data().beacon.push(foreignBeacon);stored('BEACON_SIGNAL_LOST',{}, {beaconId:foreignBeacon.id});
 expect((await read()).body.data).toMatchObject({total:0,rows:[]});
 expect(()=>safetyAlertView({event:{device:{centerId:'center-a'},childId:'foreign',child:{centerId:'center-b'}}},'center-a',f.clock)).toThrow();
 expect(()=>safetyAlertView({event:{device:{centerId:'center-a'},beaconId:'foreign',beacon:{centerId:'center-b'}}},'center-a',f.clock)).toThrow();
 const unassigned=stored('BEACON_SIGNAL_LOST',{}, {childId:null,beaconId:null});expect((await read()).body.data.rows[0]).toMatchObject({id:unassigned.alert.id,event:{attribution:'UNASSIGNED',recordedChild:null,zone:null}});
});
it('keeps unauthenticated and legacy Admin JWT requests out while retaining the existing Teacher alert shape',async()=>{
 stored('BEACON_SIGNAL_LOST');expect((await request(app).get('/api/v1/alerts?management=true').set('Host','localhost:5174').set('Origin','http://localhost:5174')).status).toBe(401);
 expect((await request(app).get('/api/v1/alerts?management=true').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Authorization',bearer(f.state.user))).status).toBe(401);
 const r=await request(app).get('/api/v1/alerts').set('Authorization',bearer(m.teacher));expect(r.status).toBe(200);expect(Array.isArray(r.body.data)).toBe(true);expect(r.body.data[0]).toMatchObject({kind:'BEACON_SIGNAL_LOST',status:'RECORDED'});
});
it.each(['state=ACKNOWLEDGED','category=UNSUPPORTED','centerId=center-b','limit=51','offset=-1','from=2026-01-01&to=2026-10-25','to=2999-01-01'])('rejects unsupported/injected query %s',async query=>{expect((await read('&'+query)).status).toBe(422);});
it('does not provide an acknowledgement write endpoint even with a valid Admin cookie and CSRF',async()=>{
 const {alert}=stored();for(const method of ['post','patch'])expect((await request(app)[method](`/api/v1/alerts/${alert.id}/acknowledge`).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({})).status).toBe(404);expect(m.db.$transaction).not.toHaveBeenCalled();
});
it.each(['PARENT','TEACHER'])('preserves %s authentication but refuses the Admin safety view',async role=>{
 const u=role==='PARENT'?m.parent:m.teacher;expect((await request(app).get('/api/v1/alerts?management=true').set('Authorization',bearer(u))).status).toBe(403);expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer(u))).status).toBe(200);
});
it('keeps all activity interpretations within the existing classification and policy contract',()=>{
 const p={eventId:'activity',eventType:'ACTIVITY_SUMMARY',deviceId:'belt',sessionId:'boot',sequence:1,measurementVersion:'MAD_G_V1_25HZ_5S',movementIntensity:null,windowDurationSeconds:60,validSampleCount:0,expectedSampleCount:1500,validDurationSeconds:0,sensorStatus:'UNAVAILABLE',deviceUptimeMs:60000,queueAgeMs:0};expect(activitySchema.safeParse(p).success).toBe(true);expect(activitySchema.safeParse({...p,sensorStatus:'MEDICAL_EMERGENCY'}).success).toBe(false);expect(policySchema.safeParse(DEFAULT_ACTIVITY_POLICY).success).toBe(true);expect(DEFAULT_ACTIVITY_POLICY.enabled).toBe(false);
});
it('never renews Admin inactivity or changes attendance through background safety reads',async()=>{
 const before=structuredClone(f.state.sessions[0]);for(let i=0;i<19;i++){f.tick(15000);expect((await read()).status).toBe(200);}expect(f.state.sessions[0]).toEqual(before);expect(f.updates).toBe(0);f.tick(15000);expect((await read()).status).toBe(401);expect(m.data().attendance).toEqual([]);expect(m.db.$transaction).not.toHaveBeenCalled();
});

it('Admin tamper category is danger scoped to this center with readable physical evidence',async()=>{
 stored('TAMPER_LOOP_OPEN',{tamperVersion:'CG_TAMPER_V1',tamperState:'OPEN'},{beaconId:null,eventType:'TAMPER_LOOP_OPEN'});
 const r=await read('&category=TAMPER');expect(r.status).toBe(200);expect(r.body.data.rows[0]).toMatchObject({kind:'TAMPER_LOOP_OPEN',category:'TAMPER',severity:'DANGER',assessment:{verification:'AUTHENTICATED_GPIO_LOOP'}});
 expect(r.body.data.rows[0].assessment.note).toContain('tamper loop was disconnected');
 const other=stored('TAMPER_LOOP_OPEN',{}, {deviceId:randomUUID(),childId:m.foreignChild.id,beaconId:null});
 expect((await read('&category=TAMPER')).body.data.rows.map(r=>r.id)).not.toContain(other.alert.id);
});
