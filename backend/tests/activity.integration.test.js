import { assertTestDatabase, validateTestDatabaseUrl } from './database-safety.js';
import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp,tokenHash } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
import { DEFAULT_ACTIVITY_POLICY,MEASUREMENT_VERSION } from '../src/activity-contract.js';
validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const secret=randomUUID()+randomUUID(),fixedNow=new Date('2026-10-22T11:05:00+05:30');let now=fixedNow;
// Deterministic domain clock; all SQL and Prisma persistence still use real PostgreSQL.
const queryClock=client=>(strings,...values)=>strings.join('').includes('clock_timestamp()')?Promise.resolve([{now}]):client.$queryRaw(strings,...values);
const clockDb=new Proxy(db,{get(target,key){if(key==='$queryRaw')return queryClock(target);if(key==='$transaction')return (work,options)=>target.$transaction(tx=>work(new Proxy(tx,{get(t,k){return k==='$queryRaw'?queryClock(t):t[k];}})),options);return target[key];}});
const app=createApp({db:clockDb,jwtSecret:secret,environment:'test',enableDevAttendanceReset:'true',logger:{error(){}}});
const sign=u=>jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const api=(method,path,user,body)=>request(app)[method](path).set('Authorization',`Bearer ${sign(user)}`).send(body);
const iso=(day,minute)=>new Date(new Date(`${day}T00:00:00+05:30`).getTime()+minute*60000);
const policy={...DEFAULT_ACTIVITY_POLICY,enabled:true,weekdays:[0,1,2,3,4,5,6]};
let outsider;
beforeAll(async()=>{
 await assertTestDatabase(db);const c=await db.center.create({data:{name:'Other synthetic activity center'}});outsider=await db.user.create({data:{username:randomUUID(),passwordHash:'unused-test',role:'ADMIN',centerId:c.id}});});
beforeEach(()=>{now=fixedNow;});
afterAll(async()=>db.$disconnect());
async function flow(){
 const center=await db.center.create({data:{name:'Synthetic activity center'}}),token=randomUUID()+randomUUID();
 const user=role=>db.user.create({data:{username:randomUUID(),passwordHash:'unused-test',role,centerId:center.id}});
 const admin=await user('ADMIN'),teacher=await user('TEACHER'),parent=await user('PARENT');
 const child=await db.child.create({data:{name:'Synthetic movement child',centerId:center.id}}),device=await db.device.create({data:{hardwareId:`MAD-${randomUUID()}`,tokenHash:tokenHash(token),centerId:center.id}});
 const assignment=await db.assignment.create({data:{deviceId:device.id,childId:child.id,startedAt:new Date(fixedNow.getTime()-120*86400000)}});
 await db.activityPolicy.create({data:{centerId:center.id,settings:policy}});
 const attendance=await db.attendance.create({data:{childId:child.id,day:attendanceDay(now),status:'PRESENT'}});
 const confirmation=await db.confirmation.create({data:{attendanceId:attendance.id,userId:admin.id,confirmedAt:iso(attendance.day,480)}});
 const session=await db.activityAttendanceSession.create({data:{attendanceId:attendance.id,startedAt:confirmation.confirmedAt}});
 const sessionId=randomUUID(),bootStart=new Date(fixedNow.getTime()-10*86400000);let sequence=0;
 const payload=(extra={},endAt=new Date(fixedNow.getTime()-60000))=>({eventId:randomUUID(),eventType:'ACTIVITY_SUMMARY',deviceId:device.hardwareId,sessionId,sequence:++sequence,measurementVersion:MEASUREMENT_VERSION,movementIntensity:.02,windowDurationSeconds:60,validSampleCount:1500,expectedSampleCount:1500,validDurationSeconds:60,sensorStatus:'OK',deviceUptimeMs:endAt-bootStart,queueAgeMs:now-endAt,...extra});
 const post=p=>request(app).post('/api/events').set('X-Device-Token',token).send(p);
 const view=()=>api('get',`/api/v1/activity/children/${child.id}`,admin);
 return {center,token,admin,teacher,parent,child,device,assignment,attendance,confirmation,session,payload,post,view};
}
async function seedComparison(f,days=7,baseline=.1){
 // Batch synthetic fixture creation so fsync/CI load does not dominate domain tests.
 await db.$transaction(async tx=>{
  const attendance=[],confirmations=[],sessions=[],intervals=[],daily=[];
  for(let i=1;i<=days;i++){
   const day=`2026-10-${String(22-i).padStart(2,'0')}`,id=randomUUID();
   attendance.push({id,childId:f.child.id,day,status:'CHECKED_OUT'});
   confirmations.push({id:randomUUID(),attendanceId:id,userId:f.teacher.id,confirmedAt:iso(day,480)});
   sessions.push({id:randomUUID(),attendanceId:id,startedAt:iso(day,480),endedAt:iso(day,1020),lastObservedAt:iso(day,1020)});
   for(const startMinute of [600,630])intervals.push({childId:f.child.id,centerId:f.center.id,day,startMinute,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,utcStart:iso(day,startMinute),movementIntegral:baseline*1800,validSeconds:1800,observedSeconds:1800});
   daily.push({childId:f.child.id,centerId:f.center.id,day,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,movementIntegral:baseline*3600,validSeconds:3600,observedSeconds:3600});
  }
  for(const [startMinute,seconds] of [[600,1800],[630,1740]])intervals.push({childId:f.child.id,centerId:f.center.id,day:'2026-10-22',startMinute,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,utcStart:iso('2026-10-22',startMinute),movementIntegral:.04*seconds,validSeconds:seconds,observedSeconds:seconds});
  await tx.attendance.createMany({data:attendance});await tx.confirmation.createMany({data:confirmations});await tx.activityAttendanceSession.createMany({data:sessions});
  await tx.activityInterval.createMany({data:intervals});await tx.activityDaily.createMany({data:daily});
  await tx.activityAttendanceSession.update({where:{id:f.session.id},data:{lastObservedAt:iso('2026-10-22',659)}});
 });
}

describe('authenticated activity history and alert persistence in PostgreSQL',()=>{
 it('persists a validated summary, daily aggregation and exact retries transactionally',async()=>{
  const f=await flow(),p=f.payload();expect((await f.post(p)).status).toBe(201);expect((await f.post({...p,queueAgeMs:p.queueAgeMs+5000})).body.data.duplicate).toBe(true);
  expect(await db.activitySummary.count({where:{childId:f.child.id}})).toBe(1);
  const daily=await db.activityDaily.findFirst({where:{childId:f.child.id}});expect(daily.validSeconds).toBe(60);expect(daily.movementIntegral/daily.validSeconds).toBeCloseTo(.02);
  const event=await db.deviceEvent.findUnique({where:{eventId:p.eventId}});expect(event.beaconId).toBeNull();expect(event.childId).toBe(f.child.id);
  expect((await f.post({...p,movementIntensity:.03})).status).toBe(409);expect((await f.post({...p,eventId:randomUUID()})).body.error.code).toBe('ACTIVITY_SEQUENCE_CONFLICT');
 });
 it('stores sensor failure as null without reducing the valid daily score',async()=>{
  const f=await flow();await f.post(f.payload());const missing=f.payload({movementIntensity:null,validSampleCount:0,validDurationSeconds:0,sensorStatus:'UNAVAILABLE'},fixedNow);
  expect((await f.post(missing)).status).toBe(201);const daily=await db.activityDaily.findFirst({where:{childId:f.child.id}});expect(daily.validSeconds).toBe(60);expect(daily.observedSeconds).toBe(120);expect(daily.movementIntegral/daily.validSeconds).toBeCloseTo(.02);
  const view=(await f.view()).body.data;expect(view.state).toBe('SENSOR_UNAVAILABLE');expect(view.currentScoreMg).toBeNull();expect(view.history[0].scoreMg).toBeCloseTo(20);
 });
 it('authenticates devices and strictly validates numeric quality and versions',async()=>{
  const f=await flow(),p=f.payload();
  expect((await request(app).post('/api/events').set('X-Device-Token','wrong').send(p)).status).toBe(401);expect((await f.post({...p,deviceId:'unregistered'})).status).toBe(401);
  for(const extra of [{movementIntensity:-1},{validDurationSeconds:30},{measurementVersion:'MAD_V2'},{childId:'other'},{validSampleCount:5000}])expect((await f.post({...p,...extra})).status).toBe(422);
  expect(await db.activitySummary.count({where:{childId:f.child.id}})).toBe(0);
 });
 it('protects JWT roles and center isolation on child history and settings',async()=>{
  const f=await flow();await f.post(f.payload());
  expect((await request(app).get('/api/v1/activity/children')).status).toBe(401);
  expect((await api('get',`/api/v1/activity/children/${f.child.id}`,outsider)).status).toBe(404);
  expect((await api('get',`/api/v1/activity/children/${f.child.id}/summaries`,outsider)).status).toBe(404);
  expect((await api('get','/api/v1/activity/children',f.parent)).status).toBe(403);
  expect((await api('get',`/api/v1/activity/children/${f.child.id}`,f.teacher)).status).toBe(200);
  expect((await api('patch','/api/v1/activity/settings',f.teacher,policy)).status).toBe(403);
  expect((await api('patch','/api/v1/activity/settings',f.admin,{...policy,centerId:outsider.centerId})).status).toBe(422);
  expect((await api('patch','/api/v1/activity/settings',f.admin,{...policy,enabled:false})).status).toBe(200);
  expect((await f.view()).body.data.state).toBe('NOT_MONITORING');expect((await api('get','/api/v1/activity/children?limit=26',f.admin)).status).toBe(422);
 });
 it('exposes raw movement during pending attendance and disabled monitoring without comparable activity',async()=>{
  const f=await flow();
  await db.activityAttendanceSession.delete({where:{id:f.session.id}});
  await db.attendance.update({where:{id:f.attendance.id},data:{status:'CHECKIN_PENDING'}});
  await db.activityPolicy.update({where:{centerId:f.center.id},data:{settings:{...policy,enabled:false}}});
  expect((await f.post(f.payload())).status).toBe(201);
  const view=(await f.view()).body.data;
  expect(view.state).toBe('NOT_MONITORING');expect(view.currentScoreMg).toBeNull();
  expect(view.latestMeasurement).toMatchObject({scoreMg:20,coveragePercent:100,eligible:false,sensorStatus:'OK'});
  expect(view.history).toHaveLength(0);
 });
 it('handles out-of-order measurements and rejects overlap or future boot timing',async()=>{
  const f=await flow(),later=f.payload({sequence:2});await f.post(later);
  const earlier=f.payload({sequence:1,movementIntensity:.04},new Date(fixedNow.getTime()-120000));expect((await f.post(earlier)).status).toBe(201);
  const daily=await db.activityDaily.findFirst({where:{childId:f.child.id}});expect(daily.validSeconds).toBe(120);expect(daily.movementIntegral/daily.validSeconds).toBeCloseTo(.03);
  expect((await f.view()).body.data.lastSummaryAt).toBe(new Date(fixedNow.getTime()-60000).toISOString());
  expect((await f.post(f.payload({sequence:3},new Date(fixedNow.getTime()-90000)))).body.error.code).toBe('ACTIVITY_OVERLAP');
  expect((await f.post({...f.payload({sequence:4}),deviceUptimeMs:later.deviceUptimeMs+1000000,queueAgeMs:0})).body.error.code).toBe('ACTIVITY_TIME_INVALID');
 });
 it('preserves activity and closes eligibility across development attendance reset',async()=>{
  const f=await flow();await f.post(f.payload());
  expect((await api('post',`/api/v1/attendance/${f.attendance.id}/reset`,f.admin,{confirmedAt:f.confirmation.confirmedAt.toISOString()})).status).toBe(200);
  expect((await db.activityAttendanceSession.findUnique({where:{id:f.session.id}})).endedAt).toEqual(fixedNow);
  now=new Date(fixedNow.getTime()+120000);
  const reply=await f.post(f.payload({},now));expect(reply.status).toBe(201);expect(reply.body.data.eligible).toBe(false);
  expect(await db.activitySummary.count({where:{childId:f.child.id}})).toBe(2);expect((await db.activityDaily.findFirst({where:{childId:f.child.id}})).validSeconds).toBe(60);
  expect((await f.view()).body.data.state).toBe('NOT_MONITORING');
 });
 it('creates one persisted LOW_ACTIVITY alert under concurrent retries and a later summary',async()=>{
  const f=await flow();await seedComparison(f);const p=f.payload({movementIntensity:.04},iso('2026-10-22',660));
  const replies=await Promise.all([f.post(p),f.post(p)]);expect(replies.map(r=>r.status).sort()).toEqual([200,201]);
  expect(await db.alert.count({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}})).toBe(1);
  const alert=await db.alert.findFirst({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}});expect(alert.details.reductionPercent).toBeCloseTo(60);expect(alert.details.coveragePercent).toBe(100);
  expect((await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',661)))).body.data.alertCreated).toBe(false);
  const view=(await f.view()).body.data;expect(view.state).toBe('LOW_ACTIVITY');expect(view.baselineDayCount).toBe(7);expect(view.baselineScoreMg).toBeCloseTo(100);expect(view.alert.status).toBe('RECORDED');
  const alerts=await api('get','/api/v1/alerts',f.admin);expect(alerts.body.data.find(a=>a.id===alert.id).event.beacon).toBeNull();expect((await api('get','/api/v1/alerts',outsider)).body.data.some(a=>a.id===alert.id)).toBe(false);
  // A new app instance reads the same persisted result; no restart-induced alert duplication.
  const restarted=createApp({db:clockDb,jwtSecret:secret});expect((await request(restarted).get(`/api/v1/activity/children/${f.child.id}`).set('Authorization',`Bearer ${sign(f.admin)}`)).body.data.alert.id).toBe(alert.id);
 });
 it('suppresses alerts with insufficient baseline or unavailable current sensor',async()=>{
  const f=await flow();await seedComparison(f,4);await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',660)));expect((await f.view()).body.data.state).toBe('BASELINE_LEARNING');expect(await db.alert.count({where:{event:{childId:f.child.id}}})).toBe(0);
  const unavailable=await f.post(f.payload({movementIntensity:null,validSampleCount:0,validDurationSeconds:0,sensorStatus:'UNAVAILABLE'},iso('2026-10-22',661)));expect(unavailable.body.data.alertCreated).toBe(false);expect((await f.view()).body.data.state).toBe('SENSOR_UNAVAILABLE');
 });
 it.each(['NOT_CHECKED_IN','CHECKIN_PENDING','CHECKED_OUT'])('records but does not count %s activity as attending',async status=>{
  const f=await flow();await db.attendance.update({where:{id:f.attendance.id},data:{status}});
  const result=await f.post(f.payload());expect(result.status).toBe(201);expect(result.body.data.eligible).toBe(false);expect(await db.activityDaily.count({where:{childId:f.child.id}})).toBe(0);expect((await f.view()).body.data.state).toBe('NOT_MONITORING');
 });
 it('associates delayed data with the correct historical assignment and rejects a straddling reassignment',async()=>{
  const f=await flow(),cut=iso('2026-10-22',645);await db.assignment.update({where:{id:f.assignment.id},data:{endedAt:cut}});
  const next=await db.child.create({data:{name:'Other synthetic child',centerId:f.center.id}});await db.assignment.create({data:{deviceId:f.device.id,childId:next.id,startedAt:cut}});
  const old=f.payload({},iso('2026-10-22',630));expect((await f.post(old)).status).toBe(201);expect((await db.deviceEvent.findUnique({where:{eventId:old.eventId}})).childId).toBe(f.child.id);
  expect((await f.post(f.payload({},new Date(cut.getTime()+30000)))).body.error.code).toBe('NO_ACTIVITY_ASSIGNMENT');
 });
 it('does not turn delayed completion of an old period into a new current alert',async()=>{
  const f=await flow();await seedComparison(f);now=iso('2026-10-22',680);
  const delayed=await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',660)));expect(delayed.status).toBe(201);expect(delayed.body.data.alertCreated).toBe(false);
  const recent=await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',679)));expect(recent.status).toBe(201);expect(recent.body.data.alertCreated).toBe(false);
  expect(await db.alert.count({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}})).toBe(0);
 });
 it('keeps follow-ups off by default and deduplicates them when explicitly enabled',async()=>{
  const f=await flow();await seedComparison(f);await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',660)));
  const initial=await db.alert.findFirst({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}});
  await db.alert.update({where:{id:initial.id},data:{createdAt:new Date(fixedNow.getTime()-3600000)}});
  expect((await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',661)))).body.data.alertCreated).toBe(false);
  expect((await api('patch','/api/v1/activity/settings',f.admin,{...policy,followUpMinutes:60})).status).toBe(200);
  expect((await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',662)))).body.data.alertCreated).toBe(true);
  expect((await f.post(f.payload({movementIntensity:.04},iso('2026-10-22',663)))).body.data.alertCreated).toBe(false);
  const alerts=await db.alert.findMany({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}});expect(alerts).toHaveLength(2);expect(alerts.filter(a=>a.details.followUp)).toHaveLength(1);
 });
 it('evaluates a batch after its final sensor status rather than alerting on an earlier minute',async()=>{
  const f=await flow();await seedComparison(f);
  const events=[f.payload({movementIntensity:.04},iso('2026-10-22',660)),f.payload({movementIntensity:null,validSampleCount:0,validDurationSeconds:0,sensorStatus:'UNAVAILABLE'},iso('2026-10-22',661))];
  const result=await request(app).post('/api/events/batch').set('X-Device-Token',f.token).send({deviceId:f.device.hardwareId,events});expect(result.status).toBe(200);expect(result.body.data.map(r=>r.alertCreated)).toEqual([false,false]);
  expect(await db.alert.count({where:{kind:'LOW_ACTIVITY',event:{childId:f.child.id}}})).toBe(0);
 });
 it('accepts bounded activity batches using the existing device authentication',async()=>{
  const f=await flow(),events=[f.payload({},iso('2026-10-22',663)),f.payload({},iso('2026-10-22',664))];
  const r=await request(app).post('/api/events/batch').set('X-Device-Token',f.token).send({deviceId:f.device.hardwareId,events});expect(r.status).toBe(200);expect(r.body.data.map(e=>e.status)).toEqual([201,201]);
  const summaries=await api('get',`/api/v1/activity/children/${f.child.id}/summaries?days=7`,f.admin);expect(summaries.body.data).toHaveLength(2);
 });
});
