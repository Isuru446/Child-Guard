import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createApp,tokenHash } from '../src/app.js';
import { createMonitoringHub } from '../src/monitoring-events.js';
import { mobileStream } from '../src/mobile-stream.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory,instrumentAttendanceMemory } from './helpers/attendance-memory.js';
const secret='synthetic-mobile-completion-secret-over-32',hash=bcrypt.hashSync('Synthetic-current-password',4);
let f,m,app,hub,available,zoneInstalled,zone;
const bearer=(user=m.parent,expiresIn='1h')=>jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn});
const get=(path,user=m.parent)=>request(app).get('/api/v1'+path).set('Authorization','Bearer '+bearer(user));
const patch=body=>request(app).patch('/api/v1/mobile/profile').set('Authorization','Bearer '+bearer()).send(body);
const profile=()=>({fullName:'Synthetic Parent',email:'synthetic@example.invalid',phone:'0700000000',emergencyContacts:[{name:'Verified contact',phone:'0711111111',relationship:'Guardian'}]});
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash,tokenHash:tokenHash('synthetic-device-token')});hub=createMonitoringHub();available=true;zoneInstalled=false;
 vi.spyOn(Date,'now').mockImplementation(()=>f.clock);m.device.lastSeen=new Date(f.clock);
 m.db.center={findUnique:vi.fn(async()=>({id:m.parent.centerId,name:'Synthetic center'}))};
 const profiles=[];m.db.userProfile={findUnique:vi.fn(async({where})=>profiles.find(p=>where.userId?p.userId===where.userId:p.email===where.email)??null),upsert:vi.fn(async({where,create,update})=>{let p=profiles.find(p=>p.userId===where.userId);if(p)Object.assign(p,update);else{p={...create};profiles.push(p);}return p;})};
 const query=m.db.$queryRaw.getMockImplementation();m.db.$queryRaw.mockImplementation(async(strings,...values)=>{
  const sql=strings.join('?');if(sql.includes('to_regclass')&&sql.includes('UserProfile'))return [{available}];
  if(sql.includes('to_regclass')&&sql.includes('SafeZone'))return [{installed:zoneInstalled}];
  if(sql.includes('FROM public."SafeZone"'))return zone?[zone]:[];return query(strings,...values);
 });
 app=createApp({db:m.db,jwtSecret:secret,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
});
afterEach(()=>vi.restoreAllMocks());
function gps(extra={}){const e={id:randomUUID(),eventId:randomUUID(),deviceId:m.device.id,childId:m.child.id,beaconId:m.gate.id,eventType:'GPS_STATUS',receivedAt:new Date(f.clock),observedAt:new Date(f.clock-500),payload:{gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8},...extra};m.data().deviceEvent.push(e);return e;}
it('uses only authorized child GPS, with real coordinates/timestamps and persisted zone configuration',async()=>{
 gps();zoneInstalled=true;zone={id:'zone',name:'School',latitude:6.9,longitude:79.8,radiusM:100,active:true,revision:2};
 const r=await get(`/mobile/children/${m.child.id}/location`);expect(r.status).toBe(200);expect(r.body.data.gpsMonitoring.lastValidLocation).toMatchObject({latitude:6.9,longitude:79.8,state:'RECENT',recordedChildId:m.child.id});expect(r.body.data.geofence).toEqual(zone);
 expect((await get(`/mobile/children/${m.unrecorded.id}/location`)).status).toBe(404);
 expect((await get(`/mobile/children/${m.foreignChild.id}/location`,m.teacher)).status).toBe(404);
 expect((await get(`/mobile/children/${m.child.id}/location`,m.teacher)).status).toBe(200);
});
it('does not disclose a previous wearer’s GPS after a belt transfer',async()=>{
 gps({childId:m.unrecorded.id});const r=await get(`/mobile/children/${m.child.id}/location`);expect(r.body.data.gpsMonitoring.lastValidLocation).toBeNull();
});
it('distinguishes stale, no-fix, unknown timing, zero coordinates, unassigned and inactive devices',async()=>{
 const e=gps({payload:{gpsStatus:'GPS_FIX',latitude:0,longitude:0}});expect((await get(`/mobile/children/${m.child.id}/location`)).body.data.gpsMonitoring.lastValidLocation.latitude).toBe(0);
 f.tick(61000);expect((await get(`/mobile/children/${m.child.id}/location`)).body.data.gpsMonitoring.lastValidLocation.state).toBe('HISTORICAL');
 e.payload.gpsEvidenceVersion='CG_GPS_V1';e.observedAt=null;expect((await get(`/mobile/children/${m.child.id}/location`)).body.data.gpsMonitoring.lastValidLocation.state).toBe('UNKNOWN_TIME');
 m.data().deviceEvent=[];gps({payload:{gpsStatus:'GPS_NO_FIX'}});expect((await get(`/mobile/children/${m.child.id}/location`)).body.data.gpsMonitoring).toMatchObject({latestStatus:'GPS_NO_FIX',lastValidLocation:null});
 m.device.active=false;expect((await get(`/mobile/children/${m.child.id}/device`)).body.data.connectionState).toBe('INACTIVE');m.data().assignment[0].endedAt=new Date(f.clock);expect((await get(`/mobile/children/${m.child.id}/device`)).body.data).toBeNull();
});
it('returns authorized BLE/geofence/activity alert detail and no credentials or other children',async()=>{
 const e=gps();for(const kind of ['DANGER_ZONE_NEAR','GEOFENCE_OUTSIDE','LOW_ACTIVITY'])m.data().alert.push({id:randomUUID(),eventId:e.id,kind,createdAt:new Date(f.clock),details:{recorded:true}});
 const r=await get(`/mobile/children/${m.child.id}/alerts`);expect(r.status).toBe(200);expect(r.body.data).toHaveLength(3);expect(r.body.data[0]).toMatchObject({state:'RECORDED',child:{id:m.child.id},location:{latitude:6.9},event:{device:{hardwareId:m.device.hardwareId}}});
 expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|passwordHash|deviceBootId/);
 expect((await get(`/mobile/children/${m.unrecorded.id}/alerts`)).status).toBe(404);
});
it('persists own profile and contacts with registration disabled without enabling enrollment',async()=>{
 expect((await get('/mobile/profile')).body.data).toMatchObject({profileAvailable:true,registrationEnabled:false,profile:null});expect((await patch(profile())).status).toBe(200);
 expect((await get('/mobile/profile')).body.data.profile).toMatchObject(profile());expect((await get('/mobile/profile',m.teacher)).body.data.profile).toBeNull();
 expect((await request(app).post('/api/v1/account/children').set('Authorization','Bearer '+bearer()).send({})).status).toBe(503);
 expect((await patch({...profile(),userId:m.teacher.id})).status).toBe(422);expect((await patch({...profile(),emergencyContacts:[{name:'x',phone:'bad',relationship:'x'}]})).status).toBe(422);
});
it('Teacher center feed includes all local children, excludes foreign events and denies Parent/global scope inputs',async()=>{
 for(const child of [m.child,m.unrecorded,m.foreignChild]){
  const e=gps({childId:child.id});m.data().alert.push({id:randomUUID(),eventId:e.id,kind:'DANGER_ZONE_NEAR',createdAt:new Date(f.clock)});
 }
 const r=await get('/mobile/alerts',m.teacher);expect(r.status).toBe(200);expect(r.body.data).toHaveLength(2);
 expect(new Set(r.body.data.map(a=>a.child.id))).toEqual(new Set([m.child.id,m.unrecorded.id]));
 expect(r.body.data[0]).toMatchObject({state:'RECORDED',event:{device:{hardwareId:m.device.hardwareId}}});
 expect((await get('/mobile/alerts',m.parent)).status).toBe(403);
 expect((await get('/mobile/alerts?centerId='+m.parent.centerId,m.teacher)).status).toBe(422);
 expect((await request(app).get('/api/v1/mobile/alerts')).status).toBe(401);
 expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|passwordHash|deviceBootId/);
});
it('Teacher center stream filters foreign-child IDs and closes after role downgrade',async()=>{
 const ownEvent=gps({childId:m.unrecorded.id}),foreignEvent=gps({childId:m.foreignChild.id});
 const own={id:randomUUID(),eventId:ownEvent.id,kind:'DANGER_ZONE_NEAR'},foreign={id:randomUUID(),eventId:foreignEvent.id,kind:'DANGER_ZONE_NEAR'};m.data().alert.push(own,foreign);
 const res=new EventEmitter(),frames=[];Object.assign(res,{set:()=>res,flushHeaders:()=>{},write:frame=>{frames.push(frame);return true;},end:vi.fn()});
 let downgraded=false;
 const req={params:{},user:m.teacher,authTransport:'legacy-mobile',validateMobileStream:async()=>({user:downgraded?{...m.teacher,role:'PARENT'}:m.teacher,expiresAt:Date.now()+60000})};
 await mobileStream(req,res,{db:m.db,hub,authorize:async()=>{},centerWide:true});
 try{
  hub.publish(m.teacher.centerId,{topics:['alerts'],alertIds:[foreign.id]});await vi.waitFor(()=>expect(m.db.alert.findMany).toHaveBeenCalled());expect(frames.join('')).not.toContain(foreign.id);
  hub.publish(m.teacher.centerId,{topics:['alerts'],alertIds:[own.id]});await vi.waitFor(()=>expect(frames.join('')).toContain(own.id));
  downgraded=true;hub.publish(m.teacher.centerId,{topics:['alerts'],alertIds:[own.id]});await vi.waitFor(()=>expect(res.end).toHaveBeenCalled());
 }finally{res.emit('close');}
 expect((await get('/mobile/alerts/stream',m.parent)).status).toBe(403);
});
it('handles absent profile storage honestly and rejects unauthorized, invalid or conflicting writes',async()=>{
 available=false;expect((await get('/mobile/profile')).body.data.profileAvailable).toBe(false);expect((await patch(profile())).body.error.code).toBe('PROFILE_UNAVAILABLE');available=true;
 expect((await request(app).patch('/api/v1/mobile/profile').send(profile())).status).toBe(401);
 m.db.userProfile.findUnique.mockResolvedValueOnce({userId:m.teacher.id});expect((await patch(profile())).status).toBe(409);
});
it('changes only the authenticated mobile password after verification, independently of registration',async()=>{
 const post=current=>request(app).post('/api/v1/mobile/password').set('Authorization','Bearer '+bearer()).send({currentPassword:current,newPassword:'Synthetic-new-password-123'});
 expect((await post('wrong')).status).toBe(422);const before=m.teacher.passwordHash;expect((await post('Synthetic-current-password')).status).toBe(200);expect(await bcrypt.compare('Synthetic-new-password-123',m.data().user.find(u=>u.id===m.parent.id).passwordHash)).toBe(true);expect(m.teacher.passwordHash).toBe(before);
});
it('streams only the selected authorized child and closes when Guardian authority is removed',async()=>{
 const e=gps(),own={id:randomUUID(),eventId:e.id,kind:'DANGER_ZONE_NEAR',createdAt:new Date(f.clock)};m.data().alert.push(own);
 const otherEvent=gps({childId:m.unrecorded.id}),other={id:randomUUID(),eventId:otherEvent.id,kind:'GEOFENCE_OUTSIDE'};m.data().alert.push(other);
 const res=new EventEmitter(),frames=[];Object.assign(res,{set:()=>res,flushHeaders:()=>{},write:frame=>{frames.push(frame);return true;},end:vi.fn()});
 const req={params:{id:m.child.id},user:m.parent,authTransport:'legacy-mobile',validateMobileStream:async()=>({user:m.parent,expiresAt:f.clock+60000})};
 const authorize=async req=>{const c=await m.db.child.findFirst({where:{id:req.params.id,centerId:req.user.centerId,guardians:{some:{userId:req.user.id}}}});if(!c)throw Error('not authorized');return c;};
 await mobileStream(req,res,{db:m.db,hub,authorize});
 try{
  hub.publish(m.parent.centerId,{topics:['alerts'],alertIds:[other.id]});await vi.waitFor(()=>expect(m.db.alert.findMany).toHaveBeenCalled());expect(frames.join('')).not.toContain(other.id);
  hub.publish(m.parent.centerId,{topics:['alerts'],alertIds:[own.id]});await vi.waitFor(()=>expect(frames.join('')).toContain(own.id));
  m.data().guardian=[];hub.publish(m.parent.centerId,{topics:['alerts'],alertIds:[own.id]});await vi.waitFor(()=>expect(res.end).toHaveBeenCalled());
 }finally{res.emit('close');}
});
it('rejects unauthenticated streams and closes at JWT expiry without extending it',async()=>{
 expect((await request(app).get(`/api/v1/mobile/children/${m.child.id}/stream`)).status).toBe(401);
 expect((await get(`/mobile/children/${m.unrecorded.id}/stream`)).status).toBe(404);
 expect((await get(`/mobile/children/${m.foreignChild.id}/stream`,m.teacher)).status).toBe(404);
 expect((await request(app).get(`/api/v1/mobile/children/${m.child.id}/stream`).set('Authorization','Bearer '+bearer(m.parent,-1))).status).toBe(401);
 vi.useFakeTimers();vi.setSystemTime(f.clock);
 const res=new EventEmitter(),frames=[];
 Object.assign(res,{set:()=>res,flushHeaders:()=>{},write:frame=>{frames.push(frame);return true;},end:vi.fn()});
 const expiresAt=Date.now()+20000;
 const req={params:{id:m.child.id},user:m.teacher,authTransport:'legacy-mobile',validateMobileStream:async()=>({user:m.teacher,expiresAt})};
 try{
  await mobileStream(req,res,{db:m.db,hub,authorize:async()=>m.child});
  await vi.advanceTimersByTimeAsync(15000);expect(frames.join('')).toContain(': keepalive');expect(res.end).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);expect(res.end).toHaveBeenCalledOnce();
 }finally{res.emit('close');vi.useRealTimers();}
});
it('closes a stream before sending data after account revocation or a changed center',async()=>{
 for(const reason of ['revoked','center']){
  const res=new EventEmitter(),frames=[];Object.assign(res,{set:()=>res,flushHeaders:()=>{},write:frame=>{frames.push(frame);return true;},end:vi.fn()});
  let invalid=false;
  const req={params:{id:m.child.id},user:m.teacher,authTransport:'legacy-mobile',validateMobileStream:async()=>{
   if(invalid&&reason==='revoked')throw Error('revoked');
   return {user:{...m.teacher,...(invalid?{centerId:randomUUID()}:{} )},expiresAt:Date.now()+60000};
  }};
  await mobileStream(req,res,{db:m.db,hub,authorize:async()=>m.child});
  try{invalid=true;hub.publish(m.teacher.centerId,{topics:['alerts'],alertIds:[randomUUID()]});await vi.waitFor(()=>expect(res.end).toHaveBeenCalledOnce());expect(frames).toHaveLength(1);}finally{res.emit('close');}
 }
});

it('Teacher Home danger filter returns only saved scoped danger alerts with historic beacon labels',async()=>{
 const event=gps({childId:m.child.id});event.beaconId=m.gate.id;event.payload={...event.payload,beaconMetadata:{name:'Recorded danger beacon',location:'Recorded boundary',kind:'DANGER_ZONE'}};
 m.data().alert.push({id:randomUUID(),eventId:event.id,kind:'DANGER_ZONE_NEAR',createdAt:new Date(f.clock)},{id:randomUUID(),eventId:event.id,kind:'BEACON_SIGNAL_LOST',createdAt:new Date(f.clock)});
 const foreign=gps({childId:m.foreignChild.id});m.data().alert.push({id:randomUUID(),eventId:foreign.id,kind:'DANGER_ZONE_NEAR',createdAt:new Date(f.clock)});
 const r=await get('/mobile/alerts?kind=DANGER_ZONE_NEAR&limit=5&offset=0',m.teacher);expect(r.status).toBe(200);expect(r.body.data).toHaveLength(1);expect(r.body.data[0]).toMatchObject({kind:'DANGER_ZONE_NEAR',state:'RECORDED',event:{device:{hardwareId:m.device.hardwareId},beacon:{name:'Recorded danger beacon',location:'Recorded boundary'}}});
 expect((await get('/mobile/alerts?kind=DANGER_ZONE_NEAR',m.parent)).status).toBe(403);expect((await get('/mobile/alerts?kind=BLE_PROXIMITY',m.teacher)).status).toBe(422);expect((await get('/mobile/alerts?kind=DANGER_ZONE_NEAR&centerId=foreign',m.teacher)).status).toBe(422);
});

it('refreshes Parent routine history through authorized metadata-only invalidations and rechecks Guardian access',async()=>{
 const res=new EventEmitter(),frames=[];Object.assign(res,{set:()=>res,flushHeaders:()=>{},write:frame=>{frames.push(frame);return true;},end:vi.fn()});
 let permitted=true;
 const authorize=vi.fn(async()=>{if(!permitted)throw Error('no access');return m.child;});
 const req={params:{id:m.child.id},user:m.parent,authTransport:'legacy-mobile',validateMobileStream:async()=>({user:m.parent,expiresAt:f.clock+60000})};
 await mobileStream(req,res,{db:m.db,hub,authorize});
 try{
  for(const topic of ['attendance','pickups','transport-notifications']){
   const count=frames.length;
   hub.publish(m.parent.centerId,{topics:[topic],alertIds:['must-not-be-exposed']});
   await vi.waitFor(()=>expect(frames.length).toBeGreaterThan(count));
   expect(frames.at(-1)).toContain('event: resync');expect(frames.at(-1)).toContain(topic==='transport-notifications'?'"transport"':topic);
   expect(frames.at(-1)).not.toContain('must-not-be-exposed');
  }
  const count=frames.length;hub.publish('unrelated-center',{topics:['pickups']});expect(frames).toHaveLength(count);
  hub.publish(m.parent.centerId,{topics:['transport']});expect(frames).toHaveLength(count); // ordinary RSSI updates do not refresh every Parent feed
  permitted=false;hub.publish(m.parent.centerId,{topics:['pickups']});await vi.waitFor(()=>expect(res.end).toHaveBeenCalled());expect(frames).toHaveLength(count);
 }finally{res.emit('close');}
});
