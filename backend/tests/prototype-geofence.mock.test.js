import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp,tokenHash } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory,instrumentAttendanceMemory } from './helpers/attendance-memory.js';
const password='Synthetic-prototype-password',hash=bcrypt.hashSync(password,4),secret='synthetic-prototype-jwt-secret-over-32',token='synthetic-prototype-device-secret';
let f,m,app,cookie,csrf,installed,sequence;
const zone=()=>m.data().protoZones[0];
const send=(extra={})=>request(app).post('/api/events').set('X-Device-Token',token).send({eventId:randomUUID(),deviceId:m.device.hardwareId,gateId:m.gate.hardwareId,eventType:'GPS_STATUS',gpsStatus:'GPS_FIX',latitude:0,longitude:0,deviceUptimeMs:10000*(++sequence),deviceBootId:'boot-1',gpsEvidenceVersion:'CG_GPS_V1',gpsObservedAt:new Date(f.clock).toISOString(),gpsFixAgeMs:100,gpsQueueAgeMs:0,gpsSequence:sequence,gpsHdop:1.2,gpsSatellites:8,...extra});
const http=method=>request(app)[method]('/api/v1/safe-zones').set('Host','localhost:5174').set('Origin','http://localhost:5174').set('Cookie',cookie);
async function sample(longitude=0,extra={}){f.tick(11000);const r=await send({longitude,...extra});expect(r.status).toBe(201);return r;}
beforeEach(async()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();f.state.user.passwordHash=hash;m=attendanceMemory(f,{hash,tokenHash:tokenHash(token)});installed=true;sequence=0;
 Object.assign(m.data(),{protoZones:[{id:randomUUID(),centerId:'center-a',name:'Synthetic test circle',latitude:0,longitude:0,radiusM:100,active:true,revision:1,effectiveAt:new Date(f.clock-1000)}],protoStates:[],protoReadings:[]});
 const originalRaw=m.db.$queryRaw;
 m.db.$queryRaw=vi.fn(async(strings,...v)=>{
  const sql=strings.join('?');
  if(sql.includes('to_regclass'))return [{installed}];
  if(sql.includes('INSERT INTO public."SafeZone"')){const old=zone();const r={id:v[0],centerId:v[1],name:v[2],latitude:v[3],longitude:v[4],radiusM:v[5],active:v[6],revision:(old?.revision??0)+1,effectiveAt:new Date(f.clock)};m.data().protoZones=[r];return [r];}
  if(sql.includes('SELECT checkpoint'))return m.data().protoStates.filter(r=>r.zoneId===v[0]&&r.deviceId===v[1]);
  if(sql.includes('FROM public."SafeZone"'))return m.data().protoZones.filter(r=>r.centerId===v[0]);
  if(sql.includes('FROM public."GeofenceReading"'))return [];
  return originalRaw(strings,...v);
 });
 m.db.$executeRaw=vi.fn(async(strings,...v)=>{
  const sql=strings.join('?');if(sql.includes('"GeofenceState"')){m.data().protoStates=[{zoneId:v[0],deviceId:v[1],checkpoint:JSON.parse(v[2])}];return 1;}
  if(sql.includes('"GeofenceReading"')){if(m.data().protoReadings.some(r=>r.eventId===v[0]))throw Object.assign(Error(),{code:'P2002'});m.data().protoReadings.push({eventId:v[0],zoneId:v[1],zoneRevision:v[2],state:v[3],reason:v[4],distanceM:v[5],observedAt:v[6]});return 1;}
  throw Error('Unexpected synthetic write');
 });
 const orig=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>orig(key,tx=>{tx.db=m.db;return work(tx);},level);
 const p=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:p.database,adminAuthRouter:p.router,jwtSecret:secret,environment:'test',registrationEnabled:false,logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});cookie=r.headers['set-cookie'][0].split(';')[0];csrf=r.body.data.csrfToken;
});
it('records actual qualified inside/outside states and one sustained boundary alert, not one per heartbeat',async()=>{
 expect((await sample()).body.data.geofence.state).toBe('UNKNOWN');expect((await sample()).body.data.geofence.state).toBe('INSIDE');await sample(.002);expect((await sample(.002)).body.data.geofence.alertCreated).toBe(true);await sample(.002);expect(m.data().alert).toHaveLength(1);
 const r=await request(app).get('/api/v1/alerts?management=true&category=GEOFENCE').set('Host','localhost:5174').set('Cookie',cookie);expect(r.status).toBe(200);expect(r.body.data.rows[0]).toMatchObject({kind:'GEOFENCE_OUTSIDE',category:'GEOFENCE',geofence:{name:'Synthetic test circle',radiusM:100},event:{recordedChild:{id:m.child.id}}});expect(m.data().attendance).toEqual([]);
});
it('does not alert when first observed outside, oscillating in boundary band, or after reboot without new inside evidence',async()=>{
 await sample(.002);await sample(.002);expect(m.data().alert).toEqual([]);await sample();await sample();await sample(100/111195.0802);await sample(.002);expect(m.data().alert).toEqual([]);await sample(.002,{deviceBootId:'boot-2'});expect(m.data().alert).toEqual([]);
});
it.each([{gpsQueueAgeMs:1001},{gpsObservedAt:'2000-01-01T00:00:00.000Z'},{gpsHdop:undefined},{gpsSatellites:3},{gpsFixAgeMs:5001},{gpsObservedAt:'2999-01-01T00:00:00.000Z'}])('never alerts or misattributes unreliable evidence %j',async extra=>{
 const r=await sample(.002,extra);expect(r.body.data.geofence.state).toBe('UNKNOWN');expect(m.data().deviceEvent[0].childId).toBeUndefined();expect(m.data().alert).toEqual([]);
});
it('keeps old-client telemetry operational before migration without creating geofence state',async()=>{
 installed=false;const r=await sample(.002);expect(r.body.data.geofence.reason).toBe('MIGRATION_REQUIRED');expect(m.data().protoReadings).toEqual([]);expect((await http('get')).body.data.configurationAvailable).toBe(false);
});
it('rejects forged device credentials and serializes concurrent observations without duplicate alerts',async()=>{
 await sample();await sample();await sample(.002);f.tick(11000);const r=await Promise.all([send({longitude:.002}),send({longitude:.002})]);expect(r.every(x=>x.status===201)).toBe(true);expect(m.data().alert).toHaveLength(1);
 expect((await request(app).post('/api/events').set('X-Device-Token','wrong').send({deviceId:m.device.hardwareId})).status).toBe(401);
});
it('rolls back event, checkpoint, reading and alert on persistence failure',async()=>{
 await sample();await sample();await sample(.002);f.tick(11000);const before=structuredClone(m.data());m.db.alert.create.mockRejectedValue(Error('Synthetic private failure'));expect((await send({longitude:.002})).status).toBe(503);expect(m.data()).toEqual(before);
});
it('preserves historical attribution and refuses a previous child GPS observation after reassignment',async()=>{
 await sample();await sample();const time=new Date(f.clock).toISOString();m.data().assignment[0].endedAt=new Date(f.clock+1);f.tick(1000);m.data().assignment.push({...m.data().assignment[0],id:randomUUID(),childId:m.unrecorded.id,startedAt:new Date(f.clock),endedAt:null});
 const r=await send({longitude:.002,gpsObservedAt:time});expect(r.body.data.geofence.reason).toBe('ASSIGNMENT_OR_ZONE_CHANGED');expect(m.data().deviceEvent.at(-1).childId).toBe(m.child.id);expect(m.data().alert).toEqual([]);
});
it('writes only the authenticated center configuration under session/CSRF/audit boundaries and checks revisions',async()=>{
 const body={name:'New real-zone form',latitude:1,longitude:1,radiusM:150,active:false,revision:1};
 expect((await http('put').send(body)).status).toBe(403);expect((await http('put').set('X-CSRF-Token',csrf).send({...body,centerId:'foreign'})).status).toBe(422);
 expect((await http('put').set('X-CSRF-Token',csrf).send(body)).status).toBe(200);expect(zone().centerId).toBe('center-a');expect(m.data().auditLog).toHaveLength(1);expect((await http('put').set('X-CSRF-Token',csrf).send(body)).status).toBe(409);
 f.tick(300000);expect((await http('put').set('X-CSRF-Token',csrf).send({...body,revision:2})).status).toBe(401);
});
