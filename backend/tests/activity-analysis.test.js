import { describe,it,expect } from 'vitest';
import { analyzeActivity, localParts, bucketParts } from '../src/activity-analysis.js';
import { DEFAULT_ACTIVITY_POLICY, MEASUREMENT_VERSION, activitySchema,policySchema } from '../src/activity-contract.js';
const now=new Date('2026-10-22T11:05:00+05:30');
const policy={...DEFAULT_ACTIVITY_POLICY,enabled:true,weekdays:[0,1,2,3,4,5,6]};
const iso=(day,minute)=>new Date(new Date(`${day}T00:00:00+05:30`).getTime()+minute*60000);
const row=(day,minute,value=.1,extra={})=>({day,startMinute:minute,timezone:policy.timezone,measurementVersion:MEASUREMENT_VERSION,utcStart:iso(day,minute),validSeconds:1800,observedSeconds:1800,movementIntegral:value*1800,clockAmbiguous:false,...extra});
function fixture(days=7){
 const dates=Array.from({length:days},(_,i)=>`2026-10-${String(21-i).padStart(2,'0')}`);
 return {policy,now,attendanceStatus:'PRESENT',latest:{sensorStatus:'OK',endAt:now,eligible:true},intervals:[...dates.flatMap(day=>[row(day,600),row(day,630)]),row('2026-10-22',600,.04),row('2026-10-22',630,.04)],sessions:[...dates,'2026-10-22'].map(day=>({startedAt:iso(day,480),endedAt:iso(day,1020)}))};
}
describe('personalized equivalent-period movement comparison',()=>{
 it('uses the mean of the previous seven valid days and excludes today',()=>{
  const result=analyzeActivity(fixture(9));expect(result.baselineDayCount).toBe(7);expect(result.baselineDays.map(d=>d.day)).toEqual(['2026-10-21','2026-10-20','2026-10-19','2026-10-18','2026-10-17','2026-10-16','2026-10-15']);expect(result.currentScoreMg).toBeCloseTo(40);expect(result.baselineScoreMg).toBeCloseTo(100);expect(result.reductionPercent).toBeCloseTo(60);expect(result.state).toBe('LOW_ACTIVITY');
 });
 it('requires four qualifying days, allowing four but not three',()=>{expect(analyzeActivity(fixture(3)).state).toBe('BASELINE_LEARNING');expect(analyzeActivity(fixture(4)).state).toBe('LOW_ACTIVITY');});
 it('does not replace missing calendar days with older history, and qualifies each clock window independently',()=>{const f=fixture(9);f.intervals.find(r=>r.day==='2026-10-21').validSeconds=0;const result=analyzeActivity(f);expect(result.comparisonWindows[0].baselineDayCount).toBe(6);expect(result.comparisonWindows[1].baselineDayCount).toBe(7);expect(result.baselineDayCount).toBe(6);expect(result.baselineCalendar.map(r=>r.day)).not.toContain('2026-10-14');});
 it('compares matching periods, ignoring full-day totals and other periods',()=>{const f=fixture();f.intervals.push(row('2026-10-21',720,3),row('2026-10-22',720,3));expect(analyzeActivity(f).reductionPercent).toBeCloseTo(60);});
 it('does not treat missing or insufficient current coverage as zero movement',()=>{const f=fixture();f.intervals=f.intervals.filter(r=>!(r.day==='2026-10-22'&&r.startMinute===630));const r=analyzeActivity(f);expect(r.state).toBe('INSUFFICIENT_DATA');expect(r.currentScoreMg).toBeNull();expect(r.coveragePercent).toBe(50);});
 it('requires coverage independently in every interval',()=>{const f=fixture();f.intervals.find(r=>r.day==='2026-10-22').validSeconds=1300;expect(analyzeActivity(f).state).toBe('INSUFFICIENT_DATA');});
 it('excludes partial arrival periods even if sample coverage exceeds 80 percent',()=>{const f=fixture();f.sessions.at(-1).startedAt=iso('2026-10-22',605);expect(analyzeActivity(f).state).toBe('INSUFFICIENT_DATA');});
 it('excludes an early-checkout partial comparison period',()=>{const f=fixture();f.sessions.at(-1).endedAt=iso('2026-10-22',655);expect(analyzeActivity(f).state).toBe('INSUFFICIENT_DATA');});
 it.each(['NOT_CHECKED_IN','CHECKIN_PENDING','CHECKED_OUT'])('does not monitor %s attendance',status=>{const f=fixture();f.attendanceStatus=status;expect(analyzeActivity(f).state).toBe('NOT_MONITORING');});
 it('requires an explicitly enabled center schedule',()=>{const f=fixture();f.policy={...policy,enabled:false};expect(analyzeActivity(f).state).toBe('NOT_MONITORING');});
 it('suppresses comparisons when current sensor data is unavailable or stale',()=>{const f=fixture();f.latest.sensorStatus='UNAVAILABLE';expect(analyzeActivity(f).state).toBe('SENSOR_UNAVAILABLE');f.latest={sensorStatus:'OK',endAt:new Date(now-601000),eligible:true};expect(analyzeActivity(f).state).toBe('SENSOR_UNAVAILABLE');});
 it('does not label genuine stillness as sensor failure',()=>{const f=fixture();f.intervals.filter(r=>r.day==='2026-10-22').forEach(r=>r.movementIntegral=0);expect(analyzeActivity(f).state).toBe('LOW_ACTIVITY');expect(analyzeActivity(f).currentScoreMg).toBe(0);});
 it('suppresses near-zero personal baselines without division by zero',()=>{const f=fixture();f.intervals.filter(r=>r.day!=='2026-10-22').forEach(r=>r.movementIntegral=.0001*1800);const r=analyzeActivity(f);expect(r.state).toBe('INSUFFICIENT_DATA');expect(r.reason).toBe('BASELINE_TOO_SMALL');expect(r.reductionPercent).toBeNull();});
 it('requires sustained reduction, not one short low period',()=>{const f=fixture();f.intervals.find(r=>r.day==='2026-10-22'&&r.startMinute===600).movementIntegral=.1*1800;expect(analyzeActivity(f).state).toBe('BELOW_BASELINE_CANDIDATE');});
 it('excludes quiet periods and does not bridge rest gaps to claim sustained reduction',()=>{const f=fixture();f.policy={...policy,quietPeriods:[{startMinute:630,endMinute:660}]};expect(analyzeActivity(f).state).toBe('INSUFFICIENT_DATA');f.now=iso('2026-10-22',645);expect(analyzeActivity(f).state).toBe('NOT_MONITORING');});
 it('excludes incompatible metrics and ambiguous repeated-clock intervals',()=>{const f=fixture();f.intervals.filter(r=>r.day!=='2026-10-22').forEach(r=>r.measurementVersion='MAD_V2');expect(analyzeActivity(f).state).toBe('BASELINE_LEARNING');const a=fixture();a.intervals.find(r=>r.day==='2026-10-22').clockAmbiguous=true;expect(analyzeActivity(a).state).toBe('INSUFFICIENT_DATA');});
 it('groups measurements using the configured local timezone',()=>{expect(localParts(new Date('2026-10-21T20:00:00Z'),'Asia/Colombo').day).toBe('2026-10-22');expect(localParts(new Date('2026-10-21T20:00:00Z'),'UTC').day).toBe('2026-10-21');expect(bucketParts(new Date('2026-10-22T10:17:30+05:30'),'Asia/Colombo').startMinute).toBe(600);});
});
describe('activity wire quality and policy validation',()=>{
 const p={eventId:'event',eventType:'ACTIVITY_SUMMARY',deviceId:'device',sessionId:'boot',sequence:1,measurementVersion:MEASUREMENT_VERSION,movementIntensity:.1,windowDurationSeconds:60,validSampleCount:1500,expectedSampleCount:1500,validDurationSeconds:60,sensorStatus:'OK',deviceUptimeMs:100000,queueAgeMs:0};
 it('accepts quality-valid activity and unavailable periods with null movement',()=>{expect(activitySchema.parse(p)).toEqual(p);expect(activitySchema.safeParse({...p,movementIntensity:null,validSampleCount:0,validDurationSeconds:0,sensorStatus:'UNAVAILABLE'}).success).toBe(true);});
 it('rejects invalid, incompatible and fabricated sensor measurements',()=>{for(const patch of [{movementIntensity:-1},{movementIntensity:Infinity},{measurementVersion:'MAD_V2'},{validDurationSeconds:20},{validSampleCount:1600},{sensorStatus:'UNAVAILABLE'},{movementIntensity:null},{queueAgeMs:-1},{queueAgeMs:86400001},{deviceUptimeMs:59999},{beaconId:'gate'},{childId:'other'}])expect(activitySchema.safeParse({...p,...patch}).success).toBe(false);});
 it('validates center timezone, quiet periods and sustained policy duration',()=>{for(const patch of [{timezone:'Invalid/Zone'},{startMinute:1100},{sustainedMinutes:45},{minBaselineDays:8},{quietPeriods:[{startMinute:700,endMinute:600}]}])expect(policySchema.safeParse({...policy,...patch}).success).toBe(false);});
});
