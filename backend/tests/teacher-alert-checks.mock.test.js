import {beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createApp,tokenHash} from '../src/app.js';
import {checkId,CHECK_PREFIX} from '../src/teacher-alert-checks.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
const secret='synthetic-teacher-check-secret-32-characters';
let f,m,app,teacherB;
const bearer=u=>'Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const get=(path='/api/v1/mobile/alerts/danger-groups',actor=m.teacher)=>request(app).get(path).set('Authorization',bearer(actor));
const check=(row,actor=m.teacher,extra={})=>request(app).post(`/api/v1/mobile/alerts/${row.id}/check`).set('Authorization',bearer(actor)).send({reviewToken:row.reviewToken,...extra});
function alert(child=m.child,{kind='DANGER_ZONE_NEAR',id=randomUUID(),time=f.clock}={}){
 const e={id:randomUUID(),eventId:randomUUID(),deviceId:m.device.id,childId:child.id,beaconId:m.gate.id,eventType:kind,receivedAt:new Date(time),observedAt:new Date(time),payload:{beaconMetadata:{name:'Recorded Beacon',location:'Recorded Place'}}};m.data().deviceEvent.push(e);
 const a={id,eventId:e.id,kind,createdAt:new Date(time)};m.data().alert.push(a);return a;
}
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'synthetic',tokenHash:tokenHash('synthetic')});
 teacherB={...m.teacher,id:randomUUID(),username:'Teacher B'};m.data().user.push(teacherB);
 m.db.$executeRaw=vi.fn(async()=>0);
 const raw=m.db.$queryRaw.getMockImplementation();
 m.db.$queryRaw.mockImplementation(async(strings,...values)=>{
  if(!strings.join('').includes('WITH unchecked_groups'))return raw(strings,...values);
  const center=values[0],user=values[2],limit=values.at(-2),offset=values.at(-1);
  const rows=await m.db.alert.findMany({where:{kind:{in:['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN']},event:{device:{centerId:center},child:{centerId:center}}},include:{event:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10000});
  const seen=new Set(),groups=[];
  for(const row of rows){const done=m.data().auditLog.some(log=>log.id===checkId(user,center,row.id)&&log.userId===user&&log.resourceId===row.id&&log.action.startsWith(CHECK_PREFIX));if(!done&&!seen.has(row.event.childId)){seen.add(row.event.childId);groups.push({id:row.id,childId:row.event.childId,createdAt:row.createdAt});}}
  return groups.slice(offset,offset+limit);
 });
 const create=m.db.auditLog.create.getMockImplementation();m.db.auditLog.create.mockImplementation(async args=>{if(m.data().auditLog.some(log=>log.id===args.data.id))throw Object.assign(Error('duplicate fixture'),{code:'P2002'});return create(args);});
 m.db.auditLog.createMany=vi.fn(async({data})=>{for(const row of data)await m.db.auditLog.create({data:row});return {count:data.length};});
 app=createApp({db:m.db,jwtSecret:secret,registrationEnabled:false,logger:{error:vi.fn()}});
});
it('groups before pagination so repeated child A events cannot hide child B, preserving stable child identity',async()=>{
 m.child.name='Same name';m.unrecorded.name='Same name';for(let i=0;i<8;i++)alert(m.child,{time:f.clock+i});alert(m.unrecorded,{time:f.clock-10});
 const r=await get();expect(r.status).toBe(200);expect(r.body.data).toHaveLength(2);expect(r.body.data[0].uncheckedCount).toBe(8);expect(new Set(r.body.data.map(r=>r.child.id)).size).toBe(2);
 const next=await get('/api/v1/mobile/alerts/danger-groups?limit=1&offset=1');expect(next.body.data[0].child.id).toBe(m.unrecorded.id);
 expect(m.data().auditLog).toHaveLength(0);
});
it('uses latest recorded identity and excludes informational, raw telemetry and foreign children',async()=>{
 alert(m.child,{time:f.clock-10});const latest=alert();for(const kind of ['BEACON_SIGNAL_LOST','GPS_STATUS','BLE_PROXIMITY','ACTIVITY_WINDOW'])alert(m.child,{kind});alert(m.foreignChild);
 const r=await get();expect(r.body.data.map(r=>r.id)).toEqual([latest.id]);expect(r.body.data[0]).toMatchObject({event:{device:{hardwareId:m.device.hardwareId},beacon:{name:'Recorded Beacon',location:'Recorded Place'}}});
});
it('checks every reviewed older event, retains alerts, shows checked history and persists through a recreated API',async()=>{
 for(let i=0;i<5;i++)alert(m.child,{time:f.clock+i});const original=structuredClone(m.data().alert);const row=(await get()).body.data[0];const result=await check(row);expect(result.status).toBe(200);expect(result.body.data.checkedCount).toBe(5);expect(m.data().alert).toEqual(original);expect(m.data().auditLog).toHaveLength(5);
 expect(m.data().auditLog.every(l=>l.userId===m.teacher.id&&l.action===CHECK_PREFIX+row.id&&+l.createdAt===f.clock)).toBe(true);
 expect((await get()).body.data).toEqual([]);app=createApp({db:m.db,jwtSecret:secret,registrationEnabled:false});expect((await get()).body.data).toEqual([]);
 const history=(await get('/api/v1/mobile/alerts')).body.data;expect(history).toHaveLength(5);expect(history.every(r=>r.checkedByMe&&r.checkedAt&&!r.canCheck)).toBe(true);
});
it('keeps another Teacher independent, and a genuinely new event reappears unchecked',async()=>{
 alert();const row=(await get()).body.data[0];await check(row);expect((await get(undefined,teacherB)).body.data).toHaveLength(1);const newer=alert(m.child,{time:f.clock+100});expect((await get()).body.data.map(r=>r.id)).toEqual([newer.id]);
 const history=(await get('/api/v1/mobile/alerts')).body.data;expect(history.find(r=>r.id===row.id).checkedByMe).toBe(true);expect(history.find(r=>r.id===newer.id).checkedByMe).toBe(false);
});
it('a newer boundary after the reviewed representative is not checked by an old token',async()=>{alert();const row=(await get()).body.data[0];const fresh=alert(m.child,{time:f.clock+100});expect((await check(row)).status).toBe(200);expect((await get()).body.data[0].id).toBe(fresh.id);});
it('rejects equal-time older-ID inserts committed after review instead of silently checking unseen records',async()=>{
 alert(m.child,{id:'ffffffff-ffff-4fff-8fff-ffffffffffff'});const row=(await get()).body.data[0];alert(m.child,{id:'00000000-0000-4000-8000-000000000001'});const result=await check(row);expect(result.status).toBe(409);expect(result.body.error.code).toBe('ALERT_REVIEW_CHANGED');expect(m.data().auditLog).toEqual([]);
});
it('frozen check IDs do not include an alert arriving while audit writes are pending',async()=>{
 alert();const row=(await get()).body.data[0];let fresh;
 const create=m.db.auditLog.create.getMockImplementation();m.db.auditLog.create.mockImplementation(async args=>{fresh??=alert(m.child,{time:f.clock-1});return create(args);});
 expect((await check(row)).status).toBe(200);expect(m.data().auditLog.some(log=>log.resourceId===fresh.id)).toBe(false);expect((await get()).body.data[0].id).toBe(fresh.id);
});
it('serializes duplicate checks into one audit per event using the existing primary key',async()=>{
 alert();const row=(await get()).body.data[0];const results=await Promise.all([check(row),check(row)]);expect(results.map(r=>r.status)).toEqual([200,200]);expect(results.some(r=>r.body.data.duplicate)).toBe(true);expect(m.data().auditLog).toHaveLength(1);
});
it('history and Home use the same durable checking operation',async()=>{alert();const history=(await get('/api/v1/mobile/alerts')).body.data[0];expect(history.canCheck).toBe(true);expect((await check(history)).status).toBe(200);expect((await get()).body.data).toEqual([]);});
it('denies Parent, Admin, foreign-center, inactive Teacher and missing authentication',async()=>{
 alert();const row=(await get()).body.data[0];expect((await check(row,m.parent)).status).toBe(403);expect((await check(row,f.state.user)).status).toBe(403);expect((await check(row,m.otherTeacher)).status).toBe(404);
 expect((await request(app).post(`/api/v1/mobile/alerts/${row.id}/check`).send({reviewToken:row.reviewToken})).status).toBe(401);m.data().user.find(u=>u.id===m.teacher.id).active=false;expect((await check(row)).status).toBe(401);expect(m.data().auditLog).toHaveLength(0);
});
it('rejects forged authority, invalid IDs, wrong Teacher token, tampering and non-danger alerts',async()=>{
 const a=alert(),row=(await get()).body.data[0];expect((await check(row,m.teacher,{teacherId:teacherB.id})).status).toBe(422);expect((await check(row,teacherB)).status).toBe(409);expect((await check({...row,reviewToken:'invalid'})).status).toBe(409);expect((await check({...row,id:'not-an-id'})).status).toBe(422);expect((await check({...row,id:randomUUID()})).status).toBe(404);
 m.data().alert.find(row=>row.id===a.id).kind='BEACON_SIGNAL_LOST';expect((await check(row)).status).toBe(404);expect(m.data().auditLog).toEqual([]);
});
it('rolls back partial acknowledgement on storage failure',async()=>{
 alert();alert();const row=(await get()).body.data[0];const write=m.db.auditLog.create.getMockImplementation();let writes=0;m.db.auditLog.create.mockImplementation(async args=>{if(++writes===2)throw Error('synthetic storage failure');return write(args);});expect((await check(row)).status).toBe(503);expect(m.data().auditLog).toEqual([]);expect((await get()).body.data).toHaveLength(1);
});
it('keeps ordinary history pagination and reads non-mutating, with strict group query scope',async()=>{
 for(let i=0;i<27;i++)alert();expect((await get('/api/v1/mobile/alerts?limit=25&offset=0')).body.data).toHaveLength(25);expect((await get('/api/v1/mobile/alerts?limit=25&offset=25')).body.data).toHaveLength(2);expect((await get('/api/v1/mobile/alerts/danger-groups?centerId=foreign')).status).toBe(422);expect((await get(undefined,m.parent)).status).toBe(403);expect(m.data().auditLog).toEqual([]);
});
it('raw grouped query uses parameterized center scope and audit primary-key lookups before limit',()=>{
 const source=readFileSync('src/teacher-alert-checks.js','utf8');expect(source).toContain('SELECT DISTINCT ON (e."childId")');expect(source).toContain('d."centerId"=${teacher.centerId} AND c."centerId"=${teacher.centerId}');expect(source).toContain('WHERE l.id=');expect(source.indexOf('DISTINCT ON')).toBeLessThan(source.indexOf('LIMIT ${limit}'));expect(source).not.toContain('queryRawUnsafe');
 expect(checkId('a:b','c','d')).not.toBe(checkId('a','b:c','d'));
});

it('rechecks Teacher role inside the mutation transaction and excludes foreign-center group reads',async()=>{alert();const row=(await get()).body.data[0];expect((await get(undefined,m.otherTeacher)).body.data).toEqual([]);const original=m.db.user.findUnique.getMockImplementation();let reads=0;m.db.user.findUnique.mockImplementation(async args=>{const user=await original(args);return args.where.id===m.teacher.id&&++reads>1?{...user,role:'PARENT'}:user;});expect((await check(row)).status).toBe(403);expect(m.data().auditLog).toEqual([]);});
it('keeps the foreground watcher read lightweight without granting a checking capability',async()=>{alert();const r=await get('/api/v1/mobile/alerts?kind=DANGER_ZONE_NEAR&review=false');expect(r.status).toBe(200);expect(r.body.data[0].reviewToken).toBeUndefined();expect(r.body.data[0].canCheck).toBe(false);expect(m.data().auditLog).toEqual([]);});

it('groups tamper as danger and checking preserves the saved incident',async()=>{
 alert(m.child,{kind:'TAMPER_LOOP_OPEN'});const r=await get();expect(r.status).toBe(200);expect(r.body.data[0].kind).toBe('TAMPER_LOOP_OPEN');
 const done=await check(r.body.data[0]);expect(done.status).toBe(200);expect(m.data().alert).toHaveLength(1);expect((await get()).body.data).toHaveLength(0);
});
