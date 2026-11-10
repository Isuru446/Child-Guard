import jwt from 'jsonwebtoken';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {createApp,tokenHash} from '../src/app.js';
import {createMonitoringHub} from '../src/monitoring-events.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
const token='synthetic-danger-device-token',secret='synthetic-danger-pipeline-secret-over-32';
let f,m,app,hub,zone,committedAt,samples,notifications;
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'synthetic',tokenHash:tokenHash(token)});hub=createMonitoringHub();samples=[];notifications=[];
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(f.clock);
 zone={...m.gate,id:randomUUID(),hardwareId:'SYNTHETIC-ZONE',kind:'DANGER_ZONE',serviceUuid:'6f50c597-34c5-4707-be46-a51ed3942468',entryRssi:-63,exitRssi:-69,name:'Synthetic zone',location:'Synthetic test location'};m.data().beacon.push(zone);
 const a={id:randomUUID(),childId:m.child.id,day:'2026-10-25',status:'PRESENT',gatePassAuthorized:false};m.data().attendance.push(a);m.data().confirmation.push({attendanceId:a.id,userId:m.teacher.id,confirmedAt:new Date(f.clock-20000)});
 const transaction=m.db.$transaction.getMockImplementation();m.db.$transaction.mockImplementation(async(...args)=>{const r=await transaction(...args);committedAt=performance.now();return r;});
 hub.subscribe(m.device.centerId,event=>{notifications.push(event);if(event.alertIds.length)samples.push(performance.now()-committedAt);});
 app=createApp({db:m.db,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
});
afterEach(()=>vi.useRealTimers());
async function send(type,beacon,extra={}){
 f.tick(100);vi.setSystemTime(f.clock);
 return request(app).post('/api/events').set('X-Device-Token',token).send({eventId:randomUUID(),deviceId:m.device.hardwareId,eventType:type,deviceBootId:'synthetic-boot',deviceUptimeMs:f.clock%1000000,gpsStatus:'GPS_NO_FIX',queueAgeMs:0,rssi:-90,...(beacon.kind==='GATE'?{gateId:beacon.hardwareId}:{beaconId:beacon.hardwareId,beaconUuid:beacon.serviceUuid}),...extra});
}
async function approach(){
 expect((await send('BLE_PROXIMITY',m.gate,{proximity:'FAR'})).status).toBe(201);
 expect((await send('BLE_PROXIMITY',zone,{proximity:'FAR'})).status).toBe(201);
 expect((await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40})).status).toBe(201);
 return send('DANGER_ZONE_NEAR',zone,{rssi:-40});
}
it('only policy-qualified zone entry creates a committed alert, deduplicates, and requires FAR to reenter',async()=>{
 const early=await send('DANGER_ZONE_NEAR',zone,{rssi:-40});expect(early.body.data.alertCreated).toBe(false);expect(m.data().alert).toHaveLength(0);
 const r=await approach();expect(r.body.data.alertCreated).toBe(true);expect(m.data().alert).toHaveLength(1);expect(notifications.at(-1).topics).toContain('alerts');
 const stored=m.data().deviceEvent.find(e=>e.eventId===r.body.data.eventId);
 const original={...stored.payload};delete original.beaconMetadata;
 const duplicate=await request(app).post('/api/events').set('X-Device-Token',token).send(original);expect(duplicate.body.data.duplicate).toBe(true);expect(m.data().alert).toHaveLength(1);
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.alertCreated).toBe(false);
 expect((await approach()).body.data.alertCreated).toBe(true);expect(m.data().alert).toHaveLength(2);
});
it('measures 20 mock qualified entries from transaction resolution to hub notification without live writes',async()=>{
 for(let n=0;n<20;n++)expect((await approach()).body.data.alertCreated).toBe(true);
 expect(samples).toHaveLength(20);expect(m.data().alert).toHaveLength(20);
 const sorted=[...samples].sort((a,b)=>a-b),round=n=>Number(n.toFixed(3));
 writeFileSync(new URL('../danger-zone-benchmark.json',import.meta.url),JSON.stringify({fixture:'memory-only policy-qualified ordinary zone entries; HTTP supertest; commit resolution to in-process hub callback; not device/radio/browser/Flutter',clock:'Node performance.now monotonic',trials:20,minMs:round(sorted[0]),medianMs:round((sorted[9]+sorted[10])/2),p95Ms:round(sorted[18]),maxMs:round(sorted[19])},null,2)+'\n');
},15000);

// Authorization is durable server evidence; live Gate RSSI is a separate concern.
async function depart(){return send('BLE_PROXIMITY',m.gate,{proximity:'FAR'});}
async function enter(beacon=zone,extra={}){
 await send('BLE_PROXIMITY',beacon,{proximity:'FAR',...extra});
 await send('BLE_PROXIMITY',beacon,{proximity:'NEAR',rssi:-40,...extra});
 return send('DANGER_ZONE_NEAR',beacon,{rssi:-40,...extra});
}
async function state(boot='synthetic-boot'){
 return request(app).get('/api/gate/state').query({deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,deviceBootId:boot}).set('X-Device-Token',token);
}
it('persists departure across Gate UNKNOWN, FAR ageing and a recreated backend; broadcasts only the committed zone alert',async()=>{
 await depart();expect((await state()).body.zoneMonitoringArmed).toBe(true);
 await send('BLE_PROXIMITY',m.gate,{proximity:'UNKNOWN',rssi:undefined});
 f.tick(120000);vi.setSystemTime(f.clock);
 app=createApp({db:m.db,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 expect((await state()).body.zoneMonitoringArmed).toBe(true);
 expect((await enter()).body.data.alertCreated).toBe(true);
 expect(m.data().alert.filter(a=>a.kind==='DANGER_ZONE_NEAR')).toHaveLength(1);
 expect(notifications.at(-1).topics).toContain('alerts');
});
it('PRESENT and UNKNOWN alone never authorize departure, and already NEAR does not fabricate an entry',async()=>{
 await send('BLE_PROXIMITY',m.gate,{proximity:'UNKNOWN',rssi:undefined});
 expect((await state()).body.zoneMonitoringArmed).toBe(false);
 expect((await enter()).body.data.alertCreated).toBe(false);
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.alertCreated).toBe(false);
});
it('requires fresh zone FAR and rejects stale queued entry without expiring the departure',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 f.tick(46000);vi.setSystemTime(f.clock);
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.suppressionReason).toBe('STALE_OBSERVATION');
 expect((await enter(zone,{queueAgeMs:46000})).body.data.alertCreated).toBe(false);
 expect((await enter()).body.data.alertCreated).toBe(true);
});
it('separates independent zones and requires genuine FAR for another episode',async()=>{
 const second={...zone,id:randomUUID(),hardwareId:'SECOND-ZONE',serviceUuid:randomUUID()};m.data().beacon.push(second);
 await depart();await send('BLE_PROXIMITY',m.gate,{proximity:'UNKNOWN',rssi:undefined});
 expect((await enter()).body.data.alertCreated).toBe(true);
 expect((await enter(second)).body.data.alertCreated).toBe(true);
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.alertCreated).toBe(false);
 expect((await enter()).body.data.alertCreated).toBe(true);
});
it('requires legitimate same-boot rearming after wearable reboot',async()=>{
 await depart();expect((await state('reboot')).body.zoneMonitoringArmed).toBe(false);
 expect((await enter(zone,{deviceBootId:'reboot'})).body.data.alertCreated).toBe(false);
 await send('BLE_PROXIMITY',m.gate,{proximity:'FAR',deviceBootId:'reboot'});
 expect((await enter(zone,{deviceBootId:'reboot'})).body.data.alertCreated).toBe(true);
});
it('invalidates authorization for attendance reset, checkout, assignment replacement and next day',async()=>{
 await depart();const a=m.data().attendance[0];a.status='CHECKED_OUT';expect((await state()).body.zoneMonitoringArmed).toBe(false);
 a.status='PRESENT';m.data().auditLog.push({id:'new-epoch',resourceId:a.id,action:'ATTENDANCE_DEV_RESET',createdAt:new Date(f.clock)});
 expect((await state()).body.zoneMonitoringArmed).toBe(false);expect((await enter()).body.data.alertCreated).toBe(false);
 m.data().auditLog.length=0;m.data().assignment[0].id=randomUUID();expect((await state()).body.zoneMonitoringArmed).toBe(false);
 await depart();expect((await state()).body.zoneMonitoringArmed).toBe(true);
 f.tick(86400000);vi.setSystemTime(f.clock);expect((await state()).body.zoneMonitoringArmed).toBe(false);
});
it('stale initial departure, pre-assignment evidence and unconfirmed attendance cannot arm',async()=>{
 await send('BLE_PROXIMITY',m.gate,{proximity:'FAR',queueAgeMs:46000});expect((await state()).body.zoneMonitoringArmed).toBe(false);
 await send('BLE_PROXIMITY',m.gate,{proximity:'FAR',queueAgeMs:5000});expect((await state()).body.zoneMonitoringArmed).toBe(false);
 m.data().attendance[0].status='CHECKIN_PENDING';await depart();expect((await state()).body.zoneMonitoringArmed).toBe(false);
});
it('Gate re-entry retains live freshness and UNKNOWN suppression independently',async()=>{
 await depart();expect((await send('DANGER_ZONE_NEAR',m.gate,{rssi:-40})).body.data.alertCreated).toBe(true);
 await depart();await send('BLE_PROXIMITY',m.gate,{proximity:'UNKNOWN',rssi:undefined});
 expect((await send('DANGER_ZONE_NEAR',m.gate,{rssi:-40})).body.data.suppressionReason).toBe('SIGNAL_UNKNOWN');
 expect((await enter()).body.data.alertCreated).toBe(true);
});
it('does not let client-supplied authorization, mismatched centers or unassigned devices arm zones',async()=>{
 expect((await send('BLE_PROXIMITY',m.gate,{proximity:'FAR',zoneDeparture:{key:'forged'}})).status).toBe(422);
 await depart();m.data().assignment[0].endedAt=new Date(f.clock);expect((await enter()).body.data.alertCreated).toBe(false);
 m.data().assignment[0].endedAt=null;m.data().child[0].centerId='foreign';expect((await enter()).body.data.alertCreated).toBe(false);
 m.data().device[0].active=false;expect((await depart()).status).toBe(401);
});
it('retains event identity on retries of stamped departure and rejects changed content',async()=>{
 const r=await depart(),e=m.data().deviceEvent.find(e=>e.eventId===r.body.data.eventId);
 const p={...e.payload};delete p.zoneDeparture;delete p.beaconMetadata;
 expect((await request(app).post('/api/events').set('X-Device-Token',token).send({...p,queueAgeMs:50000})).body.data.duplicate).toBe(true);
 expect((await request(app).post('/api/events').set('X-Device-Token',token).send({...p,rssi:-80})).status).toBe(409);
});

it('serializes concurrent entry candidates and rejects out-of-order evidence',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 const results=await Promise.all([send('DANGER_ZONE_NEAR',zone,{rssi:-40}),send('DANGER_ZONE_NEAR',zone,{rssi:-40})]);
 expect(results.filter(r=>r.body.data.alertCreated)).toHaveLength(1);
 await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40,deviceUptimeMs:1});
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.alertCreated).toBe(false);
});
it('zone signal loss still cancels entry and old reset-epoch observations cannot be reused',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 await send('BLE_PROXIMITY',zone,{proximity:'UNKNOWN',rssi:undefined});
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 expect((await send('DANGER_ZONE_NEAR',zone,{rssi:-40})).body.data.suppressionReason).toBe('ZONE_SIGNAL_UNKNOWN');
 m.data().auditLog.push({id:'epoch-2',resourceId:m.data().attendance[0].id,action:'ATTENDANCE_DEV_RESET',createdAt:new Date(f.clock)});
 await send('BLE_PROXIMITY',m.gate,{proximity:'FAR',attendanceEpoch:'epoch-2'});
 expect((await enter()).body.data.alertCreated).toBe(false);
 expect((await enter(zone,{attendanceEpoch:'epoch-2'})).body.data.alertCreated).toBe(true);
});

it('uses the genuine entry evidence when a later NEAR heartbeat arrives before a delayed danger event',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 f.tick(100);vi.setSystemTime(f.clock);
 const entryAt=f.clock;
 const entry={eventId:randomUUID(),deviceId:m.device.hardwareId,beaconId:zone.hardwareId,beaconUuid:zone.serviceUuid,eventType:'DANGER_ZONE_NEAR',gpsStatus:'GPS_NO_FIX',deviceBootId:'synthetic-boot',deviceUptimeMs:entryAt%1000000,rssi:-40};
 // A heartbeat is not a new physical entry and must not replace its evidence.
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-42});
 const response=await request(app).post('/api/events').set('X-Device-Token',token).send({...entry,queueAgeMs:f.clock-entryAt});
 expect(response.status).toBe(201);expect(response.body.data).toMatchObject({alertCreated:true,suppressionReason:null});
 expect(m.data().alert).toHaveLength(1);
 expect(notifications.at(-1).topics).toContain('alerts');
 const retry=await request(app).post('/api/events').set('X-Device-Token',token).send({...entry,queueAgeMs:f.clock-entryAt+100});
 expect(retry.body.data.duplicate).toBe(true);expect(m.data().alert).toHaveLength(1);
});

it('accepts the firmware FAR/NEAR/entry batch independently for two zones and binds the stored identities',async()=>{
 await depart();f.tick(500);vi.setSystemTime(f.clock);
 const second={...zone,id:randomUUID(),hardwareId:'INDEPENDENT-ZONE',serviceUuid:randomUUID(),name:'Another configured zone'};
 m.data().beacon.push(second);
 const base={deviceId:m.device.hardwareId,deviceBootId:'synthetic-boot',gpsStatus:'GPS_NO_FIX'};
 const events=[zone,second].flatMap(b=>[
  {eventType:'BLE_PROXIMITY',proximity:'FAR',rssi:-90,queueAgeMs:300},
  {eventType:'BLE_PROXIMITY',proximity:'NEAR',rssi:-40,queueAgeMs:100},
  {eventType:'DANGER_ZONE_NEAR',rssi:-40,queueAgeMs:100},
 ].map(e=>({...base,...e,eventId:randomUUID(),beaconId:b.hardwareId,beaconUuid:b.serviceUuid,deviceUptimeMs:(f.clock-e.queueAgeMs)%1000000})));
 const r=await request(app).post('/api/events/batch').set('X-Device-Token',token).send({deviceId:m.device.hardwareId,events});
 expect(r.status).toBe(200);expect(r.body.data.filter(e=>e.alertCreated)).toHaveLength(2);
 expect(m.data().alert).toHaveLength(2);
 for(const [index,b] of [zone,second].entries()){
  const event=m.data().deviceEvent.find(e=>e.id===m.data().alert[index].eventId);
  expect(event).toMatchObject({childId:m.child.id,deviceId:m.device.id,beaconId:b.id,payload:{beaconMetadata:{name:b.name,kind:'DANGER_ZONE'}}});
 }
});

it('does not accept a future NEAR as evidence for an earlier entry that had only FAR',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});
 const entryAt=f.clock;
 await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 const r=await send('DANGER_ZONE_NEAR',zone,{rssi:-40,deviceUptimeMs:entryAt%1000000,queueAgeMs:200});
 expect(r.body.data.alertCreated).toBe(false);expect(m.data().alert).toHaveLength(0);
 expect(notifications.some(e=>e.topics.includes('alerts'))).toBe(false);
});

it('never publishes an alert when persistence rolls back',async()=>{
 await depart();await send('BLE_PROXIMITY',zone,{proximity:'FAR'});await send('BLE_PROXIMITY',zone,{proximity:'NEAR',rssi:-40});
 const create=m.db.alert.create.getMockImplementation();
 m.db.alert.create.mockImplementationOnce(async args=>{await create(args);throw Error('synthetic persistence failure');});
 const r=await send('DANGER_ZONE_NEAR',zone,{rssi:-40});
 expect(r.status).toBe(503);expect(m.data().alert).toHaveLength(0);
 expect(notifications.some(e=>e.topics.includes('alerts'))).toBe(false);
});

it('exposes the same committed non-Gate incident to its Teacher and linked Parent, never another center',async()=>{
 await approach();
 const get=(path,user)=>request(app).get(path).set('Authorization','Bearer '+jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'}));
 const teacher=await get('/api/v1/mobile/alerts?review=false',m.teacher);
 expect(teacher.status).toBe(200);expect(teacher.body.data).toHaveLength(1);
 expect(teacher.body.data[0]).toMatchObject({kind:'DANGER_ZONE_NEAR',child:{id:m.child.id},event:{device:{hardwareId:m.device.hardwareId},beacon:{hardwareId:zone.hardwareId,name:zone.name,kind:'DANGER_ZONE'}}});
 const parent=await get(`/api/v1/mobile/children/${m.child.id}/alerts`,m.parent);
 expect(parent.status).toBe(200);expect(parent.body.data[0].id).toBe(teacher.body.data[0].id);
 const foreign=await get('/api/v1/mobile/alerts?review=false',m.otherTeacher);
 expect(foreign.status).toBe(200);expect(foreign.body.data).toEqual([]);
 expect((await get(`/api/v1/mobile/children/${m.foreignChild.id}/alerts`,m.parent)).status).toBe(404);
});

it.each(['unknown','inactive','foreign-center','wrong-uuid','invalid-token'])('rejects %s beacon submissions without an alert or alert notification',async mode=>{
 await depart();
 const payload={eventId:randomUUID(),deviceId:m.device.hardwareId,beaconId:zone.hardwareId,beaconUuid:zone.serviceUuid,eventType:'DANGER_ZONE_NEAR',gpsStatus:'GPS_NO_FIX',deviceBootId:'synthetic-boot',deviceUptimeMs:f.clock%1000000,rssi:-40,queueAgeMs:0};
 if(mode==='unknown')payload.beaconId='UNREGISTERED-BEACON';
 if(mode==='inactive')zone.active=false;
 if(mode==='foreign-center')zone.centerId=m.otherTeacher.centerId;
 if(mode==='wrong-uuid')payload.beaconUuid=randomUUID();
 const response=await request(app).post('/api/events').set('X-Device-Token',mode==='invalid-token'?'invalid-synthetic-token':token).send(payload);
 expect(response.status).toBe(mode==='invalid-token'?401:422);
 expect(m.data().alert).toHaveLength(0);expect(m.data().deviceEvent.some(e=>e.eventId===payload.eventId)).toBe(false);
 expect(notifications.some(e=>e.topics.includes('alerts'))).toBe(false);
});

it('a legitimate Teacher checkout invalidates the armed ordinary-zone session',async()=>{
 await depart();expect((await state()).body.zoneMonitoringArmed).toBe(true);
 m.db.pickupRequest={findFirst:vi.fn(async()=>null)};
 m.db.activityAttendanceSession.updateMany=vi.fn(async()=>({count:0}));
 const auth=jwt.sign({},secret,{subject:m.teacher.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 const checkout=await request(app).post(`/api/v1/attendance/${m.data().attendance[0].id}/checkout`).set('Authorization','Bearer '+auth).send({confirmedAt:m.data().confirmation[0].confirmedAt.toISOString(),departureConfirmed:true});
 expect(checkout.status).toBe(200);expect((await state()).body.zoneMonitoringArmed).toBe(false);
 expect((await enter()).body.data.alertCreated).toBe(false);
});
