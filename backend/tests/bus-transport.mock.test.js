import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {BUS_UUID,busReportSchema,createTransportManager,transportPolicy} from '../src/bus-transport.js';
import {createApp,tokenHash} from '../src/app.js';
import {createMonitoringHub} from '../src/monitoring-events.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
import {prepareAdminSessionCutover} from '../src/admin-session-cutover.js';
import {adminCookieTransport} from '../src/admin-session-http.js';

const config={enabled:true,centerId:'center-a',busId:'CG-BUS-01',beaconId:'CG-BUS-BEACON-01',beaconUuid:BUS_UUID,entryRssi:-63,exitRssi:-72};
let now,manager,assignment,device,sequence,uptime;
beforeEach(()=>{
 now=Date.parse('2026-10-29T08:00:00Z');manager=createTransportManager({config,clock:()=>now});sequence=0;uptime=10000;
 device={id:randomUUID(),hardwareId:'SYNTHETIC-WEARABLE',centerId:'center-a',active:true};
 assignment={id:randomUUID(),childId:randomUUID(),child:{id:'unused',name:'Synthetic child',centerId:'center-a'},device};
});
function report(p={}){
 now+=5000;uptime+=5000;
 return {eventId:randomUUID(),deviceId:device.hardwareId,deviceBootId:'boot-one',sequence:++sequence,deviceUptimeMs:uptime,assignmentId:assignment.id,sessionEpoch:manager.session('center-a')?.epoch??'',busId:config.busId,beaconId:config.beaconId,beaconUuid:BUS_UUID,queueAgeMs:0,proximity:'NEAR',rssi:-45,lastSeenAgeMs:100,scannerHealthy:true,scanWindowMs:5000,healthyScanMs:5000,maxScanGapMs:200,...p};
}
const send=p=>manager.ingest('center-a',assignment,device,report(p));
function board(){manager.activate('center-a');send();send();return send();}
function exit(){let result;for(let i=0;i<8;i++)result=send({proximity:'UNKNOWN',rssi:undefined,lastSeenAgeMs:5000+i*5000});return result;}
const rows=()=>manager.notifications('center-a',assignment.childId);
it('reports diagnostics without transitions before Admin activation',()=>{for(let i=0;i<4;i++)expect(send().state).toBe('DISARMED');expect(rows()).toEqual([]);});
it('activates only the configured center and is idempotent without attendance changes',()=>{expect(()=>manager.activate('center-b')).toThrow();const s=manager.activate('center-a');expect(manager.activate('center-a')).toBe(s);expect(rows()).toEqual([]);});
it('requires stable NEAR then produces one boarding notice, not one per scan',()=>{manager.activate('center-a');expect(send().state).toBe('BOARDING_CANDIDATE');expect(rows()).toHaveLength(0);send();expect(send().state).toBe('ON_BOARD');for(let i=0;i<4;i++)send();expect(rows().map(r=>r.kind)).toEqual(['BUS_BOARDED']);});
it('does not board from FAR or a single brief NEAR',()=>{manager.activate('center-a');send();for(let i=0;i<6;i++)send({proximity:'FAR',rssi:-90});expect(rows()).toHaveLength(0);});
it('infers exit only after 35 seconds of continuous healthy absent reports',()=>{board();expect(send({proximity:'UNKNOWN',rssi:undefined,lastSeenAgeMs:5000}).state).toBe('EXIT_CANDIDATE');expect(rows()).toHaveLength(1);send();expect(manager.view('center-a',assignment).state).toBe('ON_BOARD');expect(exit().state).toBe('OFF_BOARD');for(let i=0;i<4;i++)send({proximity:'UNKNOWN',rssi:undefined,lastSeenAgeMs:60000});expect(rows().filter(r=>r.kind==='BUS_EXIT_INFERRED')).toHaveLength(1);});
it('allows confirmed FAR exit, reboarding after cooldown, and another episode',()=>{board();for(let i=0;i<8;i++)send({proximity:'FAR',rssi:-90});expect(rows()).toHaveLength(2);for(let i=0;i<6;i++)send();expect(rows().filter(r=>r.kind==='BUS_BOARDED')).toHaveLength(2);});
it('silence makes connection and RSSI unknown, never generates get-off',()=>{board();now+=60000;const v=manager.view('center-a',assignment);expect(v).toMatchObject({state:'CONNECTION_UNKNOWN',lastConfirmedState:'ON_BOARD',rssi:null,proximity:'UNKNOWN'});expect(rows()).toHaveLength(1);});
it('keeps telemetry freshness separate from an expired actual RSSI measurement',()=>{manager.activate('center-a');send({proximity:'FAR',rssi:-90,lastSeenAgeMs:3500});now+=8000;expect(manager.view('center-a',assignment)).toMatchObject({connection:'RECENT_REPORT',proximity:'UNKNOWN',rssi:null});});
it('recovery while absent must see healthy NEAR again before it can infer exit',()=>{board();now+=20000;exit();expect(rows()).toHaveLength(1);send();expect(exit().state).toBe('OFF_BOARD');});
it('a missing scan window cancels exit even while network communication is still recent',()=>{board();send({proximity:'FAR',rssi:-90});now+=2500;send({proximity:'FAR',rssi:-90});exit();expect(rows()).toHaveLength(1);expect(manager.view('center-a',assignment).lastConfirmedState).toBe('ON_BOARD');});
it('a reboot while absent cannot create exit or re-use a retired boot',()=>{board();for(let i=0;i<9;i++)send({deviceBootId:'boot-two',proximity:'UNKNOWN',rssi:undefined,lastSeenAgeMs:null});expect(rows()).toHaveLength(1);expect(()=>send()).toThrow('Old wearable boot');});
it.each([{scannerHealthy:false},{healthyScanMs:1000},{maxScanGapMs:1200},{scanWindowMs:8000}])('scanner failure %j cancels exit continuity',patch=>{board();send({proximity:'FAR',rssi:-90});send({...patch,proximity:'FAR',rssi:-90});exit();expect(rows()).toHaveLength(1);});
it('same event retries are idempotent and altered content is rejected',()=>{manager.activate('center-a');send();send();const p=report();const r=manager.ingest('center-a',assignment,device,p);expect(r.notification.kind).toBe('BUS_BOARDED');expect(manager.ingest('center-a',assignment,device,{...p,queueAgeMs:100})).toMatchObject({duplicate:true,notification:null});expect(rows()).toHaveLength(1);expect(()=>manager.ingest('center-a',assignment,device,{...p,rssi:-40})).toThrow('Event identity changed');});
it.each([{queueAgeMs:2001},{sequence:0},{deviceUptimeMs:1},{beaconUuid:randomUUID()},{sessionEpoch:'old-session'},{assignmentId:randomUUID()}])('rejects stale, out-of-order and mismatched evidence %j',patch=>{board();expect(()=>send(patch)).toThrow();expect(rows()).toHaveLength(1);});
it('keeps children and wearable assignments independent',()=>{board();const other={...assignment,id:randomUUID(),childId:randomUUID(),child:{...assignment.child,name:'Other demo child'}};expect(manager.view('center-a',other).state).toBe('WAITING_FOR_BOARDING');expect(manager.notifications('center-a',other.childId)).toEqual([]);expect(manager.notifications('center-b',assignment.childId)).toEqual([]);});
it('backend restart and Sri Lanka midnight both reset activation safely',()=>{board();const restarted=createTransportManager({config,clock:()=>now});expect(restarted.session('center-a')).toBeNull();expect(restarted.notifications('center-a',assignment.childId)).toEqual([]);now=Date.parse('2026-10-29T18:30:00Z');expect(manager.session('center-a')).toBeNull();expect(rows()).toEqual([]);});
it('bounds notification and duplicate history and expires old data',()=>{manager=createTransportManager({config,clock:()=>now,policy:{...transportPolicy,maxHistory:2,maxSeen:3}});board();exit();for(let i=0;i<6;i++)send();expect(rows()).toHaveLength(2);now+=13*3600000;expect(rows()).toEqual([]);});
it('wire validation rejects invented child IDs, missing health, invalid RSSI and inconsistent evidence',()=>{const p=report();expect(busReportSchema.safeParse(p).success).toBe(true);for(const patch of [{childId:randomUUID()},{scannerHealthy:undefined},{rssi:1},{proximity:'UNKNOWN'},{healthyScanMs:6000},{lastSeenAgeMs:null}])expect(busReportSchema.safeParse({...p,...patch}).success).toBe(false);});

it('real cookie/CSRF activation, authenticated observation and authorized Parent feed work without database writes',async()=>{
 instrumentAttendanceMemory(vi.fn);const f=sessionFixture();const password='Synthetic-bus-password',hash=bcrypt.hashSync(password,4),token='synthetic-bus-device-token';f.state.user.passwordHash=hash;
 const m=attendanceMemory(f,{hash,tokenHash:tokenHash(token)}),hub=createMonitoringHub(),events=[];
 const query=m.db.$queryRaw.getMockImplementation();m.db.$queryRaw.mockImplementation((strings,...values)=>strings.join('?').includes('l.action AS kind')?[]:query(strings,...values));
 manager=createTransportManager({config,clock:()=>f.clock});hub.subscribe('center-a',e=>events.push(e));
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=m.db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db:m.db,service:f.service,jwtSecret:'synthetic-bus-secret-over-thirty-two-characters',transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 const secret='synthetic-bus-secret-over-thirty-two-characters';
 const app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,transportManager:manager,monitoringHub:hub,registrationEnabled:false,logger:{error:vi.fn()}});
 const admin=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
 const login=await admin('post','/api/v1/auth/login').send({username:'admin',password});expect(login.status).toBe(200);
 const cookie=login.headers['set-cookie'][0].split(';')[0],csrf=login.body.data.csrfToken;
 const activate=()=>admin('post','/api/v1/transport/end-daycare').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({confirm:true});
 expect((await admin('post','/api/v1/transport/end-daycare').set('Cookie',cookie).send({confirm:true})).status).toBe(403);
 const activation=await activate();expect(activation.status).toBe(200);expect((await activate()).body.data.epoch).toBe(activation.body.data.epoch);
 const bearer=user=>jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 expect((await request(app).post('/api/v1/transport/end-daycare').set('Authorization','Bearer '+bearer(m.teacher)).send({confirm:true})).status).toBe(403);
 const cfg=await request(app).get('/api/device/transport').query({deviceId:m.device.hardwareId}).set('X-Device-Token',token);expect(cfg.status).toBe(200);
 const post=p=>request(app).post('/api/device/transport/observations').set('X-Device-Token',token).send(p);
 let p;for(let i=0;i<3;i++){f.tick(5000);p={...report(),deviceId:m.device.hardwareId,assignmentId:m.data().assignment[0].id,sessionEpoch:activation.body.data.epoch};expect((await post(p)).status).toBe(200);}
 expect(events.at(-1).topics).toContain('transport-notifications');expect(events.at(-1).topics).not.toContain('alerts');
 expect((await post(p)).body.data.duplicate).toBe(true);
 const path=`/api/v1/mobile/children/${m.child.id}/updates`;
 const parent=await request(app).get(path).set('Authorization','Bearer '+bearer(m.parent));expect(parent.status).toBe(200);expect(parent.body.data.filter(r=>r.kind==='BUS_BOARDED')).toHaveLength(1);
 expect((await request(app).get(`/api/v1/mobile/children/${m.foreignChild.id}/updates`).set('Authorization','Bearer '+bearer(m.parent))).status).toBe(404);
 expect((await request(app).get(`/api/v1/mobile/children/${m.unrecorded.id}/updates`).set('Authorization','Bearer '+bearer(m.parent))).status).toBe(404);
 const read=await admin('get','/api/v1/transport').set('Cookie',cookie);expect(read.status).toBe(200);expect(read.body.data.rows[0]).toMatchObject({state:'ON_BOARD',rssi:-45});
 expect(m.db.attendance.create).not.toHaveBeenCalled();expect(m.db.deviceEvent.create).not.toHaveBeenCalled();expect(m.db.alert.create).not.toHaveBeenCalled();expect(m.db.device.update).not.toHaveBeenCalled();
});
