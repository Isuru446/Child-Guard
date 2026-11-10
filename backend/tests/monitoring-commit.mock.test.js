import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createApp, tokenHash } from '../src/app.js';
import { createMonitoringHub } from '../src/monitoring-events.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory, instrumentAttendanceMemory } from './helpers/attendance-memory.js';
const secret='synthetic-stream-testing-secret-over-32',password='Synthetic-stream-password',hash=bcrypt.hashSync(password,4),token='synthetic-stream-device-token-over-32';
let f,m,app,hub,cookie,server,connection,received,committedAt;
const send=payload=>request(app).post('/api/events').set('X-Device-Token',token).send(payload);
const event=(extra={})=>({eventId:randomUUID(),deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,eventType:'DANGER_ZONE_NEAR',gpsStatus:'GPS_NO_FIX',deviceUptimeMs:200,rssi:-40,queueAgeMs:0,...extra});
const read=path=>request(app).get(path).set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash(token)});hub=createMonitoringHub();received=[];
 // Keep server-day reads, JWTs and the synthetic DB on one clock after midnight.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(f.clock);
 hub.subscribe(m.device.centerId,e=>{received.push(e);});
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 const login=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});cookie=login.headers['set-cookie'][0].split(';')[0];
 const attendance={id:randomUUID(),childId:m.child.id,day:'2026-10-25',status:'PRESENT',gatePassAuthorized:false};m.data().attendance.push(attendance);m.data().confirmation.push({id:randomUUID(),attendanceId:attendance.id,userId:m.teacher.id,confirmedAt:new Date(f.clock-20000)});
 await send(event({eventType:'BLE_PROXIMITY',proximity:'FAR',rssi:-90,deviceUptimeMs:100}));received=[];
 const transaction=m.db.$transaction.getMockImplementation();m.db.$transaction.mockImplementation(async(...args)=>{const result=await transaction(...args);committedAt=performance.now();return result;});
});
afterEach(async()=>{connection?.destroy();connection=null;if(server){await new Promise(resolve=>server.close(resolve));server=null;}vi.useRealTimers();});
it('announces only after successful commit and no duplicate/rejected/rolled-back alert',async()=>{
 const payload=event();expect((await send(payload)).status).toBe(201);expect(m.data().alert).toHaveLength(1);expect(received.at(-1).alertIds).toEqual([m.data().alert[0].id]);
 const count=received.length;expect((await send(payload)).body.data.duplicate).toBe(true);expect(received).toHaveLength(count);
 expect((await send(event({gateId:'UNKNOWN'}))).status).toBe(422);expect(received).toHaveLength(count);
 m.db.deviceEvent.create.mockRejectedValueOnce(Error('synthetic failed transaction'));
 expect((await send(event({eventType:'BEACON_SIGNAL_LOST',queueAgeMs:undefined,rssi:undefined}))).status).toBe(503);expect(received).toHaveLength(count);expect(m.data().alert).toHaveLength(1);
});
it('does not publish while the transaction commit acknowledgement is still pending',async()=>{
 const original=m.db.$transaction.getMockImplementation();let release;
 m.db.$transaction.mockImplementation(async(...args)=>{const result=await original(...args);await new Promise(resolve=>{release=resolve;});return result;});
 const posting=send(event()).then(r=>r);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(received).toEqual([]);
 release();expect((await posting).status).toBe(201);expect(received.at(-1).topics).toContain('alerts');
});
it('notifies pending attendance and preserves endpoint/token compatibility',async()=>{
 m.data().attendance=[];m.data().confirmation=[];await send(event({eventType:'CHILD_NEAR_GATE',queueAgeMs:undefined}));expect(received.at(-1).topics).toContain('attendance');
 expect((await read('/api/v1/attendance/pending-count')).status).toBe(200);
 expect((await read('/api/v1/admin/safety-summary')).body.data).toMatchObject({alerts:0,pendingAttendance:1});
 expect((await request(app).post('/api/events').set('X-Device-Token','wrong').send(event())).status).toBe(401);
 expect((await request(app).get('/api/v1/monitoring/stream').set('Host','localhost:5174').set('Origin','http://localhost:5174')).status).toBe(401);
});
it('measures mock commit to real loopback SSE receipt and bounded API response size',async()=>{
 server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let buffer='',arrival=null,ready;const initial=new Promise(resolve=>{ready=resolve;});
 connection=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/api/v1/monitoring/stream',headers:{Host:'localhost:5174',Origin:'http://localhost:5174',Cookie:cookie}},response=>{
  expect(response.statusCode).toBe(200);response.on('data',chunk=>{buffer+=chunk.toString();if(buffer.includes('event: resync'))ready();if(buffer.includes('"topics":["devices","alerts"]'))arrival=performance.now();});
 });connection.end();await initial;
 await send(event());await vi.waitFor(()=>expect(arrival).not.toBeNull());
 const streamMs=arrival-committedAt;expect(streamMs).toBeLessThan(1000);
 const samples=[];let bytes=0;
 for(let i=0;i<10;i++){const start=performance.now();const r=await read('/api/v1/alerts?management=true&limit=25');expect(r.status).toBe(200);samples.push(performance.now()-start);bytes=Buffer.byteLength(JSON.stringify(r.body));}
 const ordered=[...samples].sort((a,b)=>a-b);
 writeFileSync(new URL('../monitoring-benchmark.json',import.meta.url),JSON.stringify({fixture:'one genuine policy-created alert; memory DB; Node loopback; no browser paint',commitToSseMs:Number(streamMs.toFixed(3)),apiRequests:samples.length,apiMedianMs:Number(((ordered[4]+ordered[5])/2).toFixed(3)),apiMaxMs:Number(Math.max(...samples).toFixed(3)),alertResponseBytes:bytes},null,2)+'\n');
},15000);
