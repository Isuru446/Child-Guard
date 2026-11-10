import { MEASUREMENT_VERSION } from './activity-contract.js';
export const INTERVAL_MINUTES=30;
export const LOOKBACK_DAYS=90;
export function localParts(date,timezone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const day=`${parts.year}-${parts.month}-${parts.day}`;
 return {day,minute:Number(parts.hour)*60+Number(parts.minute),second:Number(parts.second),weekday:new Date(`${day}T12:00:00Z`).getUTCDay()};
}
export function bucketParts(date,timezone){
 const p=localParts(date,timezone),startMinute=Math.floor(p.minute/30)*30;
 const utcStart=new Date(date.getTime()-((p.minute-startMinute)*60+p.second)*1000-date.getUTCMilliseconds());
 return {...p,startMinute,utcStart};
}
export const intervalScore=r=>r?.validSeconds>0?r.movementIntegral/r.validSeconds:null;
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
export function scheduled(policy,day,start,end){
 const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
 return policy.weekdays.includes(weekday)&&start>=policy.startMinute&&end<=policy.endMinute&&!policy.quietPeriods.some(p=>start<p.endMinute&&end>p.startMinute);
}
export function qualifyingInterval(row,policy,sessions){
 if(!row||!Number.isFinite(row.validSeconds)||!Number.isFinite(row.observedSeconds)||!Number.isFinite(row.movementIntegral)||row.movementIntegral<0||row.validSeconds>row.observedSeconds+0.1||row.observedSeconds>1800.1||row.measurementVersion!==MEASUREMENT_VERSION||row.timezone!==policy.timezone||row.clockAmbiguous||!scheduled(policy,row.day,row.startMinute,row.startMinute+30)||row.validSeconds<1800*policy.minCoveragePercent/100||row.validSeconds>1800.1)return false;
 const start=new Date(row.utcStart),end=new Date(start.getTime()+1800000);
 if(!Number.isFinite(start.getTime())||intervalScore(row)>4)return false;
 const local=localParts(start,policy.timezone);
 if(local.day!==row.day||Math.floor(local.minute/30)*30!==row.startMinute)return false;
 return sessions.some(s=>new Date(s.startedAt)<=start&&(!s.endedAt||new Date(s.endedAt)>=end));
}
// Previous completed local calendar days, not the last N days with readings.
export function previousDays(day,count){
 return Array.from({length:count},(_,i)=>new Date(Date.parse(`${day}T12:00:00Z`)-(i+1)*86400000).toISOString().slice(0,10));
}
// Existing persisted intervals already integrate MAD by valid measurement duration.
export function analyzeActivity({policy,now,attendanceStatus,intervals,sessions,latest,assignment,currentSummaries}){
 const current=localParts(now,policy.timezone),days=previousDays(current.day,policy.baselineDays);
 const daySet=new Set(days),endMinute=Math.floor(current.minute/30)*30;
 const count=Math.max(2,policy.sustainedMinutes/30),startMinute=endMinute-count*30;
 const result={day:current.day,measurementVersion:MEASUREMENT_VERSION,metric:'MAD',units:'mg',comparisonWindowMinutes:30,consecutiveLowWindows:count,requiredBaselineDays:policy.minBaselineDays,evaluatedAt:now.toISOString(),baselineWindow:{start:days.at(-1),end:days[0]},state:'NOT_MONITORING',reason:'OUTSIDE_ELIGIBILITY',currentScoreMg:null,baselineScoreMg:null,reductionPercent:null,coveragePercent:0,baselineDayCount:0,baselineDays:[],baselineCalendar:[],comparisonWindows:[],baselineAvailable:false,sensorStatus:latest?.sensorStatus||'NOT_REPORTED',lastSummaryAt:latest?.endAt||null,period:null,todayIntervals:[]};
 const today=intervals.filter(r=>r.day===current.day).sort((a,b)=>a.startMinute-b.startMinute);
 const history=intervals.filter(r=>daySet.has(r.day));
 const eligible=r=>qualifyingInterval(r,policy,sessions)&&Number.isFinite(intervalScore(r))&&intervalScore(r)>=0;
 function comparable(key){
  const daily=days.map(day=>{
   const rows=history.filter(r=>r.day===day&&r.startMinute===key);
   const r=rows.length===1&&eligible(rows[0])?rows[0]:null;
   return {day,scoreMg:r?intervalScore(r)*1000:null,coveragePercent:r?Math.min(100,r.validSeconds/18):null};
  });
  const valid=daily.filter(r=>r.scoreMg!==null);
  return {daily,valid,baselineScoreMg:valid.length>=policy.minBaselineDays?mean(valid.map(r=>r.scoreMg)):null};
 }
 result.todayIntervals=today.map(r=>({startMinute:r.startMinute,scoreMg:eligible(r)?intervalScore(r)*1000:null,coveragePercent:Math.min(100,r.validSeconds/18),complete:new Date(r.utcStart).getTime()+1800000<=now.getTime(),baselineScoreMg:comparable(r.startMinute).baselineScoreMg}));
 if(!policy.enabled||attendanceStatus!=='PRESENT'||!scheduled(policy,current.day,current.minute,current.minute+1))return result;
 const latestAt=latest?new Date(latest.endAt).getTime():NaN;
 if(!latest||!latest.eligible||!Number.isFinite(latestAt)||latestAt>now.getTime()+5000||latestAt<now.getTime()-600000||latest.sensorStatus==='UNAVAILABLE')return {...result,state:'SENSOR_UNAVAILABLE',reason:'NO_RECENT_VALID_SENSOR_DATA'};
 if(startMinute<0)return {...result,state:'INSUFFICIENT_DATA',reason:'NOT_ENOUGH_ELAPSED_DAY'};
 result.period={startMinute,endMinute,day:current.day};
 const keys=Array.from({length:count},(_,i)=>startMinute+i*30);
 const windows=keys.map(key=>{
  const rows=today.filter(r=>r.startMinute===key),r=rows.length===1?rows[0]:null,base=comparable(key);
  const currentScoreMg=r&&eligible(r)&&new Date(r.utcStart).getTime()+1800000<=now.getTime()?intervalScore(r)*1000:null;
  const meaningful=base.baselineScoreMg!==null&&base.baselineScoreMg>=policy.minimumBaselineMADg*1000;
  const reductionPercent=currentScoreMg!==null&&meaningful?(base.baselineScoreMg-currentScoreMg)/base.baselineScoreMg*100:null;
  return {startMinute:key,endMinute:key+30,currentScoreMg,baselineScoreMg:base.baselineScoreMg,baselineDayCount:base.valid.length,coveragePercent:r?Math.min(100,r.validSeconds/18):0,history:base.daily,reductionPercent,low:reductionPercent!==null&&reductionPercent+1e-9>=policy.reductionPercent,row:r};
 });
 result.comparisonWindows=windows.map(({row,...w})=>w);
 const last=windows.at(-1);
 result.baselineCalendar=last.history;
 result.baselineDays=last.history.filter(r=>r.scoreMg!==null);
 result.baselineDayCount=Math.min(...windows.map(w=>w.baselineDayCount));
 result.coveragePercent=windows.reduce((n,w)=>n+w.coveragePercent,0)/count;
 if(windows.some(w=>w.currentScoreMg===null))return {...result,state:'INSUFFICIENT_DATA',reason:'COMPLETE_MATCHING_ATTENDANCE_INTERVALS_REQUIRED'};
 if(windows.some(w=>w.baselineDayCount<policy.minBaselineDays))return {...result,state:'BASELINE_LEARNING',reason:'COMPARABLE_CALENDAR_HISTORY_REQUIRED'};
 if(windows.some(w=>w.baselineScoreMg<policy.minimumBaselineMADg*1000))return {...result,state:'INSUFFICIENT_DATA',reason:'BASELINE_TOO_SMALL'};
 result.baselineAvailable=true;
 result.currentScoreMg=mean(windows.filter(w=>w.currentScoreMg!==null).map(w=>w.currentScoreMg));
 result.baselineScoreMg=mean(windows.map(w=>w.baselineScoreMg));
 result.reductionPercent=(result.baselineScoreMg-result.currentScoreMg)/result.baselineScoreMg*100;
 const complete=windows.every(w=>w.currentScoreMg!==null);
 if(complete){
  result.period.startAt=new Date(windows[0].row.utcStart).toISOString();
  result.period.endAt=new Date(new Date(last.row.utcStart).getTime()+1800000).toISOString();
  if(assignment&&(!assignment.device?.active||new Date(assignment.startedAt)>new Date(result.period.startAt)||latest.deviceId!==assignment.deviceId))return {...result,state:'INSUFFICIENT_DATA',reason:'CURRENT_ASSIGNMENT_MUST_COVER_PERIOD'};
  if(currentSummaries){
   const records=currentSummaries.filter(r=>new Date(r.startAt)>=new Date(result.period.startAt)&&new Date(r.endAt)<=new Date(result.period.endAt));
   if(!records.length||records.some(r=>r.sessionId!==latest.sessionId||r.deviceId!==latest.deviceId))return {...result,state:'INSUFFICIENT_DATA',reason:'CONTINUOUS_DEVICE_BOOT_REQUIRED'};
  }
 }
 const sustained=complete&&windows.every(w=>w.low);
 return {...result,state:sustained?'LOW_ACTIVITY':last.low?'BELOW_BASELINE_CANDIDATE':complete?'NORMAL':'INSUFFICIENT_DATA',reason:sustained?'SUSTAINED_PERSONAL_REDUCTION':last.low?'ONE_LOW_COMPLETE_WINDOW':'NO_SUSTAINED_REDUCTION'};
}
