import {beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {createApp,tokenHash} from '../src/app.js';
import {ingestTamper,tamperStatus} from '../src/tamper.js';
import {eventSchema} from '../src/events.js';
import {createMonitoringHub} from '../src/monitoring-events.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
const secret='synthetic-tamper-test-secret-over-32',token='synthetic-tamper-device-token-over-32';
let f,m,app,published,logger;
const event=(extra={})=>({eventId:randomUUID(),deviceId:m.device.hardwareId,eventType:'TAMPER_LOOP_OPEN',tamperVersion:'CG_TAMPER_V1',deviceBootId:'test-boot',tamperEpoch:'test-epoch',tamperSequence:2,tamperEpisodeId:'test-episode-2',tamperState:'OPEN',reason:'TRANSITION',deviceUptimeMs:10000,queueAgeMs:0,timingUncertain:false,...extra});
const send=(p,credential=token)=>request(app).post('/api/events').set('X-Device-Token',credential).send(p);
const read=(path,user)=>request(app).get(path).set('Authorization','Bearer '+jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'}));
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'synthetic',tokenHash:tokenHash(token)});
 m.data().assignment[0].startedAt=new Date(f.clock-120000);published=[];
 const hub=createMonitoringHub();hub.subscribe(m.device.centerId,e=>{published.push(e);expect(m.data().deviceEvent.length).toBeGreaterThan(0);});
 logger={error:vi.fn()};app=createApp({db:m.db,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger});
});
it('accepts authenticated OPEN without beacon, attendance or activity policy and persists one child danger before SSE',async()=>{
 const r=await send(event());expect(r.status).toBe(201);expect(m.data().attendance).toHaveLength(0);
 expect(m.data().alert).toHaveLength(1);expect(m.data().alert[0].kind).toBe('TAMPER_LOOP_OPEN');expect(m.data().deviceEvent[0].childId).toBe(m.child.id);
 expect(published[0].topics).toContain('alerts');expect(published[0].alertIds).toEqual([m.data().alert[0].id]);
});
it('acknowledges an already accepted exact event ID without creating a second danger alert',async()=>{
 const p=event();expect((await send(p)).status).toBe(201);
 const retry=await send(p);expect(retry.status).toBe(200);expect(retry.body.data).toMatchObject({eventId:p.eventId,duplicate:true});
 expect(m.data().deviceEvent).toHaveLength(1);expect(m.data().alert).toHaveLength(1);
});
it('keeps a transiently failed event unacknowledged, then accepts the same queued ID after backend recovery',async()=>{
 const p=event(),transaction=m.db.$transaction.getMockImplementation();
 m.db.$transaction.mockRejectedValueOnce(Object.assign(new Error('synthetic database unavailable'),{code:'P1001'}));
 const failed=await send(p);expect(failed.status).toBe(503);expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
 expect(m.data().deviceEvent).toHaveLength(0);expect(m.data().alert).toHaveLength(0);
 m.db.$transaction.mockImplementation(transaction);
 const recovered=await send(p);expect(recovered.status).toBe(201);expect(recovered.body.data.eventId).toBe(p.eventId);
 expect(m.data().deviceEvent).toHaveLength(1);expect(m.data().alert).toHaveLength(1);
 expect((await send(p)).body.data.duplicate).toBe(true);expect(m.data().alert).toHaveLength(1);
});
it('identifies a database permission failure without exposing error details or credentials',async()=>{
 const secretText='private-database-password';
 m.db.$transaction.mockRejectedValueOnce(Object.assign(new Error(secretText),{code:'P2010',meta:{code:'42501',message:secretText}}));
 const response=await send(event());expect(response.status).toBe(500);
 expect(response.body.error).toEqual({code:'DATABASE_PERMISSION_DENIED',message:'Service configuration error'});
 expect(JSON.stringify(response.body)).not.toContain(secretText);
 expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({code:'DATABASE_PERMISSION_FAILURE',failureClass:'DATABASE_PERMISSION',prismaCode:'P2010',sqlState:'42501',endpoint:'/api/events'}));
 expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretText);
});
it('rejects wrong token, spoofed device identity, unknown fields and contradictory state',async()=>{
 expect((await send(event(),'invalid')).status).toBe(401);
 await expect(ingestTamper(m.db,m.device,event({deviceId:'foreign'}))).rejects.toMatchObject({status:401});
 expect(eventSchema.safeParse(event({childId:m.foreignChild.id})).success).toBe(false);
 expect(eventSchema.safeParse(event({tamperState:'CLOSED'})).success).toBe(false);expect(m.data().alert).toHaveLength(0);
});
it('accepts queued OPEN, RESTORED and periodic STATUS with exact acknowledgements',async()=>{
 const open=event();const restored=event({eventType:'TAMPER_LOOP_RESTORED',tamperState:'CLOSED',tamperSequence:3});
 const status=event({eventType:'TAMPER_LOOP_STATUS',tamperState:'CLOSED',tamperSequence:3,reason:'PERIODIC'});
 for(const p of [open,restored,status]){const r=await send(p);expect(r.status).toBe(201);expect(r.body.data.eventId).toBe(p.eventId);}
 expect(m.data().alert).toHaveLength(1);
});
it('classifies an ingestion TypeError and never acknowledges an event that failed',async()=>{
 m.db.$transaction.mockRejectedValueOnce(new TypeError('private synthetic request contents'));
 const r=await send(event());expect(r.status).toBe(500);expect(r.body.error.code).toBe('INTERNAL_ERROR');expect(r.body.data).toBeUndefined();
 expect(m.data().deviceEvent).toHaveLength(0);expect(m.data().alert).toHaveLength(0);
 expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({stage:'event_ingestion',failureClass:'JAVASCRIPT_RUNTIME'}));
 expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private synthetic');
});
it('serializes concurrent retries and repeated OPEN confirmations into one episode alert',async()=>{
 const p=event();await Promise.all(Array.from({length:8},()=>ingestTamper(m.db,m.device,p)));
 await ingestTamper(m.db,m.device,event({eventType:'TAMPER_LOOP_STATUS',reason:'PERIODIC'}));
 expect(m.data().alert).toHaveLength(1);expect(m.data().deviceEvent).toHaveLength(2);
 await expect(ingestTamper(m.db,m.device,{...p,tamperSequence:9})).rejects.toMatchObject({status:409});
});
it('restores without deleting/checking the alert and allows a second genuine episode',async()=>{
 await send(event());await send(event({eventType:'TAMPER_LOOP_RESTORED',tamperState:'CLOSED',tamperSequence:3}));
 expect((await tamperStatus(m.db,{...m.device,lastSeen:new Date(f.clock)},{now:f.clock})).state).toBe('CLOSED');
 expect(m.data().alert).toHaveLength(1);expect(m.data().auditLog).toHaveLength(0);
 await send(event({tamperSequence:4,tamperEpisodeId:'test-episode-4'}));expect(m.data().alert).toHaveLength(2);
});
it('stale restoration cannot overwrite a newer OPEN, including identical receipt milliseconds',async()=>{
 await send(event({tamperSequence:4,tamperEpisodeId:'test-episode-4'}));
 await send(event({eventType:'TAMPER_LOOP_RESTORED',tamperState:'CLOSED',tamperSequence:3}));
 const status=await tamperStatus(m.db,{...m.device,lastSeen:new Date(f.clock)},{now:f.clock});expect(status.state).toBe('OPEN');
 expect(m.data().deviceEvent.filter(e=>e.payload.tamperCurrent)).toHaveLength(1);
});
it('unassigned and cross-center assignments remain diagnostic without a child danger',async()=>{
 m.data().assignment=[];await send(event());expect(m.data().alert).toHaveLength(0);expect(m.data().deviceEvent[0].childId).toBeNull();
 m.data().assignment.push({id:randomUUID(),deviceId:m.device.id,childId:m.foreignChild.id,startedAt:new Date(f.clock-120000),endedAt:null});
 await send(event({tamperSequence:4,tamperEpisodeId:'test-episode-4'}));expect(m.data().alert).toHaveLength(0);
});
it('startup OPEN stays open through fitting grace then becomes danger eligible',async()=>{
 m.data().assignment[0].startedAt=new Date(f.clock-1000);
 await send(event({reason:'STARTUP'}));expect(m.data().alert).toHaveLength(0);
 f.tick(31000);await send(event({eventType:'TAMPER_LOOP_STATUS',reason:'PERIODIC'}));expect(m.data().alert).toHaveLength(1);
});
it('reboot-pending observations require the captured unchanged assignment and stay unknown-time',async()=>{
 await send(event({timingUncertain:true}));expect(m.data().alert).toHaveLength(0);
 await send(event({timingUncertain:true,assignmentId:m.data().assignment[0].id}));expect(m.data().alert).toHaveLength(1);
 expect(m.data().deviceEvent[1].observedAt).toBeNull();
});
it('offline state is unavailable with its last-known state preserved',async()=>{
 await send(event());const status=await tamperStatus(m.db,{...m.device,lastSeen:new Date(f.clock)},{now:f.clock+61000});
 expect(status).toMatchObject({state:'UNKNOWN',lastKnownState:'OPEN',stale:true});
});
it('Parent safety feed and center Teacher history include tamper, other Parents/centers cannot read it',async()=>{
 await send(event());
 const path=`/api/v1/mobile/children/${m.child.id}/alerts?category=safety`;
 expect((await read(path,m.parent)).body.data[0].kind).toBe('TAMPER_LOOP_OPEN');
 expect((await read(`/api/v1/mobile/children/${m.foreignChild.id}/alerts`,m.parent)).status).toBe(404);
 expect((await read(path,m.otherTeacher)).status).toBe(404);
 expect((await read('/api/v1/mobile/alerts?review=false',m.teacher)).body.data[0].kind).toBe('TAMPER_LOOP_OPEN');
});

it('a delayed startup from a retired NVS epoch cannot replace a newer epoch',async()=>{
 await send(event({reason:'STARTUP',tamperEpoch:'new-epoch',tamperSequence:1}));
 await send(event({reason:'STARTUP',eventType:'TAMPER_LOOP_STATUS',tamperState:'CLOSED',tamperEpoch:'old-epoch',tamperSequence:1,queueAgeMs:1000}));
 expect((await tamperStatus(m.db,{...m.device,lastSeen:new Date(f.clock)},{now:f.clock})).state).toBe('OPEN');
});
