import {beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {createApp,tokenHash} from '../src/app.js';
import {attendanceDay,ingest} from '../src/events.js';
import {detectWearableConnection,createConnectionMonitor,communicationState,recordDeviceCommunication,connectionSettings} from '../src/wearable-connection.js';
import {teacherAlerts} from '../src/teacher-alerts.js';
import {checkTeacherDanger} from '../src/teacher-alert-checks.js';
import {safetyAlertView} from '../src/safety-monitoring.js';
import {GATE_ID,GATE_UUID} from '../src/beacons.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
const secret='synthetic-connection-secret-more-than-32-characters';
let f,m,app;
const bearer=user=>'Bearer '+jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const req=()=>({user:m.teacher,query:{}});
const detect=()=>detectWearableConnection(m.db,m.device.id);
const advance=ms=>f.tick(ms);
const fresh=async()=>recordDeviceCommunication(m.db,m.device);
const list=()=>teacherAlerts(m.db,req(),{reviewSecret:secret});
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'synthetic',tokenHash:tokenHash('synthetic-device-token')});
 m.device.lastSeen=new Date(f.clock);
 const attendance={id:randomUUID(),childId:m.child.id,day:attendanceDay(new Date(f.clock)),status:'PRESENT',gatePassAuthorized:false};
 m.data().attendance.push(attendance);m.data().confirmation.push({id:randomUUID(),attendanceId:attendance.id,userId:m.teacher.id,confirmedAt:new Date(f.clock-500)});
 m.data().deviceEvent.push({id:randomUUID(),eventId:'real-fixture-telemetry',deviceId:m.device.id,childId:m.child.id,beaconId:m.gate.id,eventType:'GPS_STATUS',receivedAt:new Date(f.clock),observedAt:new Date(f.clock),deviceUptimeMs:10n,payload:{gpsStatus:'GPS_NO_FIX'}});
 const original=m.db.alert.create.getMockImplementation();m.db.alert.create.mockImplementation(async args=>{if(args.data.activityDedupKey&&m.data().alert.some(a=>a.activityDedupKey===args.data.activityDedupKey))throw Object.assign(Error('unique'),{code:'P2002'});return original(args);});
 m.db.auditLog.createMany=vi.fn(async({data})=>{for(const row of data)await m.db.auditLog.create({data:row});return {count:data.length};});
 app=createApp({db:m.db,jwtSecret:secret,logger:{error:vi.fn()}});
});
it('uses the real firmware-tolerant timeout and rejects invalid configuration',()=>{
 expect(connectionSettings({})).toEqual({timeoutMs:120000,intervalMs:30000});expect(()=>connectionSettings({WEARABLE_CONNECTION_TIMEOUT_MS:'4000'})).toThrow();expect(()=>connectionSettings({WEARABLE_CONNECTION_CHECK_INTERVAL_MS:'NaN'})).toThrow();
 expect(communicationState(m.device,f.clock)).toBe('ONLINE');advance(90000);expect(communicationState(m.device,f.clock)).toBe('STALE');advance(31000);expect(communicationState(m.device,f.clock)).toBe('OFFLINE');
});
it('tolerates brief interruption and records one actual server-detected episode with correct identities and times',async()=>{
 advance(120000);expect(await detect()).toBeNull();advance(1);const result=await detect();expect(result.centerId).toBe(m.child.centerId);
 const a=m.data().alert[0];expect(a.kind).toBe('WEARABLE_CONNECTION_LOST');expect(a.details).toMatchObject({source:'BACKEND_CONNECTION_MONITOR',centerId:m.child.centerId,childId:m.child.id,deviceId:m.device.id,hardwareId:m.device.hardwareId,lastCommunicationAt:m.device.lastSeen.toISOString(),detectedAt:new Date(f.clock).toISOString(),timeoutMs:120000});
 expect(a.eventId).toBe(m.data().deviceEvent[0].id);expect(m.data().deviceEvent).toHaveLength(1);expect(await detect()).toBeNull();advance(30000);expect(await detect()).toBeNull();expect(m.data().alert).toHaveLength(1);
});
it('deduplicates concurrent checks and survives monitor/backend recreation with persisted unique keys',async()=>{
 advance(120001);const results=await Promise.all([detect(),detect(),detect()]);expect(results.filter(Boolean)).toHaveLength(1);expect(m.data().alert).toHaveLength(1);
 const hub={publish:vi.fn()},clock=()=>f.clock;const monitor=createConnectionMonitor({db:m.db,hub,clock});advance(120001);await monitor.tick();expect(m.data().alert).toHaveLength(1);expect(hub.publish).not.toHaveBeenCalled();monitor.stop();
});
it('authenticated reconnection ends the episode without deleting or checking history; later loss alerts again',async()=>{
 advance(120001);await detect();const old=m.data().alert[0].id;await fresh();expect(communicationState(m.data().device[0],f.clock)).toBe('ONLINE');expect(await detect()).toBeNull();advance(120001);await detect();expect(m.data().alert).toHaveLength(2);expect(m.data().alert[0].id).toBe(old);expect(m.data().auditLog).toHaveLength(0);
});
it.each(['ABSENT','CHECKED_OUT','CHECKIN_PENDING','NOT_CHECKED_IN'])('does not monitor attendance %s',async status=>{m.data().attendance[0].status=status;advance(120001);expect(await detect()).toBeNull();expect(m.data().alert).toHaveLength(0);});
it('excludes never-connected, inactive, unassigned, ambiguous assignment, foreign-center and unconfirmed devices',async()=>{
 advance(120001);const seen=m.device.lastSeen;m.device.lastSeen=null;expect(await detect()).toBeNull();m.device.lastSeen=seen;m.device.active=false;expect(await detect()).toBeNull();m.device.active=true;
 const assignment=m.data().assignment[0];assignment.endedAt=new Date(f.clock);expect(await detect()).toBeNull();assignment.endedAt=null;
 m.data().assignment.push({...assignment,id:randomUUID()});expect(await detect()).toBeNull();m.data().assignment.pop();
 m.child.centerId='foreign';expect(await detect()).toBeNull();m.child.centerId=m.device.centerId;
 m.data().confirmation=[];expect(await detect()).toBeNull();
});
it('does not reuse previous-day attendance, pre-assignment or pre-confirmation communication',async()=>{
 advance(120001);m.data().attendance[0].day='2000-01-01';expect(await detect()).toBeNull();m.data().attendance[0].day=attendanceDay(new Date(f.clock));m.data().assignment[0].startedAt=new Date(f.clock);expect(await detect()).toBeNull();m.data().assignment[0].startedAt=new Date(f.clock-500000);m.data().confirmation[0].confirmedAt=new Date(f.clock);expect(await detect()).toBeNull();
});
it('missing attributable telemetry or future clock values never manufacture an incident',async()=>{advance(120001);m.data().deviceEvent=[];expect(await detect()).toBeNull();m.device.lastSeen=new Date(f.clock+1);expect(await detect()).toBeNull();expect(communicationState(m.device,f.clock)).toBe('UNKNOWN');});
it('rolls back on storage failure without changing lastSeen, attendance or original events',async()=>{advance(120001);const before=structuredClone(m.data());m.db.alert.create.mockRejectedValueOnce(Error('private-fixture'));await expect(detect()).rejects.toThrow();expect(m.data()).toEqual(before);});
it('startup, DB recovery and stalled-loop grace avoid historical outage backfill; safe postcommit broadcast is center-scoped',async()=>{
 const hub={publish:vi.fn()},logger={error:vi.fn()},monitor=createConnectionMonitor({db:m.db,hub,logger,clock:()=>f.clock});
 await monitor.tick();expect(monitor.status().state).toBe('RECOVERING');expect(m.data().alert).toHaveLength(0);
 for(let i=0;i<4;i++){advance(30000);await monitor.tick();}advance(1);await monitor.tick();expect(m.data().alert).toHaveLength(1);expect(hub.publish).toHaveBeenCalledWith(m.device.centerId,{topics:['alerts','devices'],alertIds:[m.data().alert[0].id]});
 await fresh();const original=m.db.$queryRaw.getMockImplementation();m.db.$queryRaw.mockRejectedValueOnce(Error('private-db-url'));await monitor.tick();expect(monitor.status().state).toBe('UNAVAILABLE');expect(logger.error).toHaveBeenCalledWith({code:'WEARABLE_CONNECTION_MONITOR_UNAVAILABLE'});m.db.$queryRaw.mockImplementation(original);
 advance(30000);await monitor.tick();expect(monitor.status().state).toBe('RECOVERING');expect(m.data().alert).toHaveLength(1);
 advance(300000);await monitor.tick();expect(monitor.status().state).toBe('RECOVERING');expect(m.data().alert).toHaveLength(1);monitor.stop();
});
it('successful duplicate telemetry proves current authenticated communication without inventing a new BLE event',async()=>{
 const payload={eventId:'ble-loss',deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,eventType:'BEACON_SIGNAL_LOST',deviceUptimeMs:1,gpsStatus:'GPS_NO_FIX'};
 await ingest(m.db,m.device,payload);expect(m.data().alert).toHaveLength(0);expect(m.data().deviceEvent.at(-1).eventType).toBe('BEACON_SIGNAL_LOST');advance(50000);await ingest(m.db,m.device,payload);expect(+m.data().device[0].lastSeen).toBe(f.clock);expect(m.data().deviceEvent.filter(e=>e.eventId==='ble-loss')).toHaveLength(1);
});
it('invalid tokens and invalid gate requests cannot change lastSeen; a valid gate poll can',async()=>{
 const before=+m.device.lastSeen;advance(5000);
 expect((await request(app).get('/api/gate/state').query({deviceId:m.device.hardwareId,gateId:m.gate.hardwareId}).set('X-Device-Token','wrong')).status).toBe(401);
 expect((await request(app).get('/api/gate/state').query({deviceId:m.device.hardwareId,gateId:'unknown'}).set('X-Device-Token','synthetic-device-token')).status).toBe(422);expect(+m.device.lastSeen).toBe(before);
 expect((await request(app).get('/api/gate/state').query({deviceId:m.device.hardwareId,gateId:m.gate.hardwareId}).set('X-Device-Token','synthetic-device-token')).status).toBe(200);expect(+m.device.lastSeen).toBe(f.clock);
});
it('Teacher, Parent and Admin reads cannot manufacture device communication',async()=>{
 const before=+m.device.lastSeen;advance(20000);for(const actor of [m.teacher,m.parent,f.state.user])await request(app).get(`/api/v1/mobile/children/${m.child.id}/alerts`).set('Authorization',bearer(actor));expect(+m.device.lastSeen).toBe(before);
});
it('accepted authenticated beacon configuration is also real communication; invalid configuration is not',async()=>{
 const path='/api/device/beacons',query={deviceId:m.device.hardwareId},before=+m.device.lastSeen;advance(5000);
 expect((await request(app).get(path).query(query).set('X-Device-Token','synthetic-device-token')).status).toBe(409);expect(+m.device.lastSeen).toBe(before);
 m.gate.hardwareId=GATE_ID;m.gate.serviceUuid=GATE_UUID;m.gate.attendanceRssi=-55;
 expect((await request(app).get(path).query(query).set('X-Device-Token','synthetic-device-token')).status).toBe(200);expect(+m.device.lastSeen).toBe(f.clock);
});
it('a wearable cannot submit a server-only connection warning, nor keep online with invalid telemetry',async()=>{
 const before=+m.device.lastSeen;advance(5000);
 const body={deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,eventId:'spoof',eventType:'WEARABLE_CONNECTION_LOST',deviceUptimeMs:1,gpsStatus:'GPS_NO_FIX'};
 expect((await request(app).post('/api/events').set('X-Device-Token','synthetic-device-token').send(body)).status).toBe(422);expect(+m.device.lastSeen).toBe(before);expect(m.data().alert).toHaveLength(0);
});
it('Teacher feed excludes old BLE-loss alerts BEFORE pagination while authorized Admin history retains them',async()=>{
 for(let i=0;i<30;i++)m.data().alert.push({id:randomUUID(),eventId:m.data().deviceEvent[0].id,kind:'BEACON_SIGNAL_LOST',createdAt:new Date(f.clock+i)});
 advance(120001);await detect();const rows=await teacherAlerts(m.db,{...req(),query:{limit:1,offset:0}},{reviewSecret:secret});expect(rows).toHaveLength(1);expect(rows[0].kind).toBe('WEARABLE_CONNECTION_LOST');expect(m.data().alert).toHaveLength(31);
 const full=await m.db.alert.findFirst({where:{id:rows[0].id},include:{event:true}});expect(safetyAlertView(full,m.device.centerId,f.clock)).toMatchObject({category:'DEVICE_SIGNAL',location:null,connection:{lastCommunicationAt:m.device.lastSeen.toISOString()}});
});
it('connection checks are durable per Teacher and exact incident, never check danger or future losses',async()=>{
 advance(120001);await detect();const row=(await list())[0],teacherB={...m.teacher,id:randomUUID()};m.data().user.push(teacherB);
 const operation=()=>checkTeacherDanger(m.db,{user:m.teacher,params:{id:row.id},body:{reviewToken:row.reviewToken}},secret);
 expect((await operation()).checkedCount).toBe(1);expect((await operation()).duplicate).toBe(true);expect(m.data().auditLog).toHaveLength(1);expect((await list())[0].checkedByMe).toBe(true);
 expect((await teacherAlerts(m.db,{user:teacherB,query:{}},{reviewSecret:secret}))[0].checkedByMe).toBe(false);
 expect(communicationState(m.data().device[0],f.clock)).toBe('OFFLINE');await fresh();advance(120001);await detect();expect((await list())[0].checkedByMe).toBe(false);expect(m.data().alert).toHaveLength(2);
});
it('Teacher checks enforce active role, center, exact signed incident and reject extra authority fields',async()=>{
 advance(120001);await detect();const row=(await list())[0],post=(actor,body={reviewToken:row.reviewToken},id=row.id)=>request(app).post(`/api/v1/mobile/alerts/${id}/check`).set('Authorization',bearer(actor)).send(body);
 expect((await post(m.parent)).status).toBe(403);expect((await post(m.otherTeacher)).status).toBe(404);expect((await post(f.state.user)).status).toBe(403);expect((await post(m.teacher,{reviewToken:row.reviewToken,centerId:m.device.centerId})).status).toBe(422);expect((await post(m.teacher,{reviewToken:'forged'})).status).toBe(409);expect((await post(m.teacher,undefined,randomUUID())).status).toBe(404);
 expect((await request(app).post(`/api/v1/mobile/alerts/${row.id}/check`).send({reviewToken:row.reviewToken})).status).toBe(401);
});
it('Parent reads only their legitimately linked child connection history, never another center',async()=>{
 advance(120001);await detect();const get=child=>request(app).get(`/api/v1/mobile/children/${child.id}/alerts`).set('Authorization',bearer(m.parent));expect((await get(m.child)).body.data[0]).toMatchObject({kind:'WEARABLE_CONNECTION_LOST',connection:{lastCommunicationAt:m.device.lastSeen.toISOString()}});expect((await get(m.foreignChild)).status).toBe(404);expect((await get(m.unrecorded)).status).toBe(404);
});
