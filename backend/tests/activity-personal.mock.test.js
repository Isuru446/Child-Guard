import {notifyCommittedTelemetry} from '../src/monitoring-events.js';
import {it,expect,vi} from 'vitest';
import {ingestActivity,activityView} from '../src/activity.js';
import {analyzeActivity,previousDays} from '../src/activity-analysis.js';
import {DEFAULT_ACTIVITY_POLICY,MEASUREMENT_VERSION} from '../src/activity-contract.js';

const now=new Date('2026-10-22T11:00:00+05:30');
const at=(day,minute)=>new Date(Date.parse(`${day}T00:00:00+05:30`)+minute*60000);
const policy={...DEFAULT_ACTIVITY_POLICY,enabled:true,weekdays:[0,1,2,3,4,5,6]};
const interval=(day,minute,mg=100,seconds=1800)=>({childId:'child',centerId:'center',day,startMinute:minute,utcStart:at(day,minute),timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,validSeconds:seconds,observedSeconds:1800,movementIntegral:mg/1000*seconds,clockAmbiguous:false});
function analysis(){
 const days=previousDays('2026-10-22',7);
 return {policy,now,attendanceStatus:'PRESENT',latest:{endAt:now,sensorStatus:'OK',eligible:true},intervals:[...days.flatMap(day=>[interval(day,600),interval(day,630)]),interval('2026-10-22',600,70),interval('2026-10-22',630,70)],sessions:[...days,'2026-10-22'].map(day=>({startedAt:at(day,480),endedAt:at(day,1020)}))};
}

it('uses duration-normalized daily scores with equal day weight and exact 30-percent boundaries per period',()=>{
 const f=analysis();f.intervals=f.intervals.filter(r=>r.day==='2026-10-22');
 const days=previousDays('2026-10-22',4);
 days.forEach((day,i)=>{f.intervals.push(interval(day,600,(i+1)*100,i%2?1440:1800),interval(day,630,(i+1)*300,i%2?1800:1440));});
 f.intervals.find(r=>r.startMinute===600).movementIntegral=.175*1800;
 f.intervals.find(r=>r.startMinute===630).movementIntegral=.525*1800;
 const v=analyzeActivity(f);expect(v.comparisonWindows.map(w=>w.baselineScoreMg)).toEqual([250,750]);expect(v.reductionPercent).toBeCloseTo(30);expect(v.state).toBe('LOW_ACTIVITY');
 f.intervals.find(r=>r.startMinute===600).movementIntegral=.17501*1800;
 expect(analyzeActivity(f).state).toBe('BELOW_BASELINE_CANDIDATE');
});
it('does not borrow older days or treat missing comparable days as zero',()=>{
 const f=analysis();f.intervals=f.intervals.filter(r=>!['2026-10-18','2026-10-17','2026-10-16','2026-10-15'].includes(r.day));f.intervals.push(interval('2026-10-14',600,900),interval('2026-10-14',630,900));
 const v=analyzeActivity(f);expect(v.state).toBe('BASELINE_LEARNING');expect(v.baselineDayCount).toBe(3);expect(v.baselineCalendar).toHaveLength(7);expect(v.baselineCalendar.filter(d=>d.scoreMg===null)).toHaveLength(4);
 expect(v.baselineWindow).toEqual({start:'2026-10-15',end:'2026-10-21'});
 expect(previousDays('2024-03-01',2)).toEqual(['2024-02-29','2024-02-28']);expect(previousDays('2027-01-01',1)).toEqual(['2026-12-31']);
});
it('does not bridge a changed assignment or device reboot to claim a sustained comparison',()=>{
 const f=analysis();f.latest.deviceId='device';f.latest.sessionId='boot';
 f.assignment={deviceId:'device',device:{active:true},startedAt:at('2026-10-22',630)};
 expect(analyzeActivity(f).reason).toBe('CURRENT_ASSIGNMENT_MUST_COVER_PERIOD');
 f.assignment.startedAt=at('2026-10-22',480);f.currentSummaries=[{startAt:at('2026-10-22',600),endAt:at('2026-10-22',601),sessionId:'old-boot',deviceId:'device'}];
 expect(analyzeActivity(f).reason).toBe('CONTINUOUS_DEVICE_BOOT_REQUIRED');
});

// Database-free transactional fixture: no Prisma import, environment, network or
// SQL execution. Its writer queue models serial transactions and restores failed work.
function fixture(){
 let s={clock:now,device:{id:'device',hardwareId:'BELT',centerId:'center',active:true,tokenHash:'fixture-only'},children:[{id:'child',name:'Fixture child',centerId:'center'},{id:'other',name:'Another child',centerId:'center'}],assignment:{id:'assignment',childId:'child',deviceId:'device',startedAt:at('2026-10-01',480)},events:[],summaries:[],intervals:[],sessions:[],attendances:[],confirmations:[],proofs:[],alerts:[],boots:[{deviceId:'device',sessionId:'boot',anchorAt:at('2026-10-22',480),anchorUptimeMs:0n}]};
 for(const day of [...previousDays('2026-10-22',4),'2026-10-22']){
  const id=`attendance-${day}`,current=day==='2026-10-22';
  s.attendances.push({id,childId:'child',day,status:current?'PRESENT':'CHECKED_OUT'});
  s.confirmations.push({attendanceId:id,userId:'teacher',confirmedAt:at(day,480)});
  s.sessions.push({id:`session-${day}`,attendanceId:id,startedAt:at(day,480),endedAt:current?null:at(day,1020),lastObservedAt:at(day,current?659:1020)});
  s.proofs.push({resourceId:id,action:'ATTENDANCE_CONFIRMED_TEACHER',createdAt:at(day,480)});
  s.intervals.push(interval(day,600,current?40:100),{...interval(day,630,current?40:100,current?1740:1800),observedSeconds:current?1740:1800});
 }
 for(let minute=600;minute<659;minute++)s.summaries.push({id:`summary-${minute}`,childId:'child',deviceId:'device',sessionId:'boot',sequence:minute,startAt:at('2026-10-22',minute),endAt:at('2026-10-22',minute+1),eligible:true,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,sensorStatus:'OK',movementIntensity:.04,validSampleCount:1500,expectedSampleCount:1500});
 let tail=Promise.resolve(),seq=0;
 const matchSummary=(r,w)=>r.childId===w.childId&&(!w.deviceId||r.deviceId===w.deviceId)&&(!w.startAt?.gte||r.startAt>=w.startAt.gte)&&(!w.endAt?.lte||r.endAt<=w.endAt.lte);
 const db={
  $transaction:async fn=>{const previous=tail;let release;tail=new Promise(done=>{release=done;});await previous;const snapshot=structuredClone(s);try{return await fn(db);}catch(e){s=snapshot;throw e;}finally{release();}},
  $queryRaw:async strings=>strings.join('').includes('clock_timestamp()')?[{now:s.clock}]:[],
  device:{findUnique:async()=>s.device,update:async({data})=>Object.assign(s.device,data)},
  deviceEvent:{findUnique:async({where})=>s.events.find(e=>e.eventId===where.eventId),create:async({data})=>{const row={id:`event-${++seq}`,...data};s.events.push(row);return row;}},
  activityBoot:{findUnique:async({where})=>s.boots.find(b=>b.sessionId===where.deviceId_sessionId.sessionId),create:async({data})=>{s.boots.push(data);return data;}},
  assignment:{findFirst:async({where})=>{const a=s.assignment;if(where.childId&&where.childId!==a.childId)return null;if(where.startedAt&&a.startedAt>where.startedAt.lte)return null;return {...a,child:s.children.find(c=>c.id===a.childId),device:s.device};}},
  attendance:{findUnique:async({where})=>s.attendances.find(a=>a.childId===where.childId_day.childId&&a.day===where.childId_day.day)},
  confirmation:{findUnique:async({where})=>s.confirmations.find(c=>c.attendanceId===where.attendanceId)},
  activityPolicy:{findUnique:async()=>({settings:policy})},
  activityAttendanceSession:{
   upsert:async({where})=>s.sessions.find(r=>r.attendanceId===where.attendanceId_startedAt.attendanceId&&+r.startedAt===+where.attendanceId_startedAt.startedAt),
   findMany:async({where})=>s.sessions.map(r=>({...r,attendance:s.attendances.find(a=>a.id===r.attendanceId)})).filter(r=>r.attendance.childId===where.attendance.childId&&(!where.startedAt?.lte||r.startedAt<=where.startedAt.lte)&&(!where.OR||!r.endedAt||r.endedAt>=where.OR[1].endedAt.gte)),
   update:async({where,data})=>Object.assign(s.sessions.find(r=>r.id===where.id),data),
  },
  activitySummary:{
   findUnique:async({where})=>s.summaries.find(r=>r.deviceId===where.deviceId_sessionId_sequence.deviceId&&r.sessionId===where.deviceId_sessionId_sequence.sessionId&&r.sequence===where.deviceId_sessionId_sequence.sequence),
   findFirst:async({where})=>where.startAt?.lt?s.summaries.find(r=>r.childId===where.childId&&r.startAt<where.startAt.lt&&r.endAt>where.endAt.gt):s.summaries.filter(r=>matchSummary(r,where)).sort((a,b)=>b.endAt-a.endAt).map(r=>({...r,device:s.device}))[0],
   create:async({data})=>{const row={id:`summary-${++seq}`,...data};s.summaries.push(row);return row;},
   findMany:async({where})=>s.summaries.filter(r=>matchSummary(r,where)),
  },
  activityInterval:{findMany:async({where})=>s.intervals.filter(r=>r.childId===where.childId),findUnique:async({where})=>s.intervals.find(r=>r.childId===where.childId_day_startMinute_timezone_measurementVersion.childId&&r.day===where.childId_day_startMinute_timezone_measurementVersion.day&&r.startMinute===where.childId_day_startMinute_timezone_measurementVersion.startMinute),upsert:async({where,create,update})=>{let r=await db.activityInterval.findUnique({where});if(!r){s.intervals.push(create);return create;}for(const [k,v] of Object.entries(update))r[k]=typeof v==='object'?r[k]+v.increment:v;return r;}},
  activityDaily:{findMany:async()=>[],upsert:async()=>({})},
  auditLog:{findMany:async({where})=>s.proofs.filter(p=>where.resourceId.in.includes(p.resourceId)&&p.action===where.action)},
  alert:{findUnique:async({where})=>s.alerts.find(a=>a.activityDedupKey===where.activityDedupKey),create:async({data})=>{if(s.alerts.some(a=>a.activityDedupKey===data.activityDedupKey))throw Object.assign(Error('duplicate'),{code:'P2002'});const row={id:`alert-${++seq}`,...data};s.alerts.push(row);return row;}},
 };
 const payload={eventId:'new-event',eventType:'ACTIVITY_SUMMARY',deviceId:'BELT',sessionId:'boot',sequence:660,measurementVersion:MEASUREMENT_VERSION,movementIntensity:.04,windowDurationSeconds:60,validSampleCount:1500,expectedSampleCount:1500,validDurationSeconds:60,sensorStatus:'OK',deviceUptimeMs:10800000,queueAgeMs:0};
 return {db,payload,state:()=>s,send:(p=payload)=>ingestActivity(db,s.device,p)};
}
it('persists one measured advisory with Teacher evidence, exact retry and concurrent duplicate protection',async()=>{
 const f=fixture();const results=await Promise.all([f.send(),f.send()]);expect(results.filter(r=>r.alertCreated)).toHaveLength(1);expect(results.filter(r=>r.duplicate)).toHaveLength(1);
 const s=f.state();expect(s.alerts).toHaveLength(1);expect(s.events).toHaveLength(1);expect(s.alerts[0]).toMatchObject({kind:'LOW_ACTIVITY_ADVISORY',details:{currentScoreMg:40,baselineScoreMg:100,baselineDayCount:4,units:'mg'}});expect(s.alerts[0].details.reductionPercent).toBeCloseTo(60);
 f.state().clock=at('2026-10-22',661);
 await f.send({...f.payload,eventId:'next',sequence:661,deviceUptimeMs:10860000,queueAgeMs:0});
 expect(f.state().alerts).toHaveLength(1);
});
it.each(['ABSENT','CHECKED_OUT','CHECKIN_PENDING','NOT_CHECKED_IN'])('does not create advisories for %s attendance',async status=>{
 const f=fixture();f.state().attendances.at(-1).status=status;await f.send();expect(f.state().alerts).toHaveLength(0);
});
it.each(['sensor','proof','boot','assignment','late','center'])('fails closed for %s without changing unrelated records',async reason=>{
 const f=fixture();let p={...f.payload};
 if(reason==='sensor')p={...p,movementIntensity:null,validSampleCount:0,validDurationSeconds:0,sensorStatus:'UNAVAILABLE'};
 if(reason==='proof')f.state().proofs=[];
 if(reason==='boot')p.sessionId='new-boot';
 if(reason==='assignment')f.state().assignment.startedAt=at('2026-10-22',630);
 if(reason==='late'){f.state().clock=at('2026-10-22',681);p.queueAgeMs=1260000;}
 if(reason==='center')await expect(ingestActivity(f.db,{...f.state().device,centerId:'foreign'},p)).rejects.toMatchObject({code:'DEVICE_UNAUTHORIZED'});
 else await f.send(p);
 expect(f.state().alerts).toHaveLength(0);
});
it('rolls back a failed alert insert rather than leaving partial telemetry and permits safe retry',async()=>{
 const f=fixture();const create=f.db.alert.create;f.db.alert.create=vi.fn(async()=>{throw Error('persistence unavailable');});
 await expect(f.send()).rejects.toThrow('persistence unavailable');expect(f.state().events).toHaveLength(0);expect(f.state().summaries).toHaveLength(59);
 f.db.alert.create=create;expect((await f.send()).alertCreated).toBe(true);
});
it('returns the authoritative read summary with a seven-day calendar, metric and saved advisory',async()=>{
 const f=fixture();await f.send();const view=await activityView(f.db,f.state().children[0],now);
 expect(view.baselineCalendar).toHaveLength(7);expect(view.requiredBaselineDays).toBe(4);expect(view.units).toBe('mg');expect(view.alert.id).toBe(f.state().alerts[0].id);
});

it('publishes the persisted advisory through the existing committed telemetry invalidation',async()=>{
 const f=fixture();const result=await f.send();const hub={publish:vi.fn()};
 f.db.alert.findMany=vi.fn(async()=>f.state().alerts.map(a=>({id:a.id})));
 await notifyCommittedTelemetry(f.db,hub,f.state().device,f.payload,result);
 expect(hub.publish).toHaveBeenCalledWith('center',{topics:['devices','alerts'],alertIds:[f.state().alerts[0].id]});
});
it('does not duplicate an already saved legacy movement warning on the activation day',async()=>{
 const f=fixture();f.state().alerts.push({id:'legacy',kind:'LOW_ACTIVITY',activityDedupKey:`LOW_ACTIVITY:child:2026-10-22:${MEASUREMENT_VERSION}`});
 await f.send();expect(f.state().alerts).toHaveLength(1);expect(f.state().alerts[0].id).toBe('legacy');
});
