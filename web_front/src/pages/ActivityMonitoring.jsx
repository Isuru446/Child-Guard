import ActivityDailyHistory from '../components/ActivityDailyHistory';
import { activityLabel } from '../lib/ui-language';
import {gpsTime} from '../lib/gps-location';
import TechnicalDetails from '../components/TechnicalDetails';
import { useMemo, useRef, useState } from 'react';
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import DataTable from '../components/DataTable';
import ActionButton from '../components/ActionButton';
import usePollingApi from '../hooks/usePollingApi';
import { api } from '../lib/api';
import '../style/AttendanceOverview.css';
import '../style/ActivityMonitoring.css';
import '../style/ActivityRestoration.css';
const score=value=>value==null?'Unavailable':`${value.toFixed(2)} mg MAD`;
const time=gpsTime;
const clock=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const minute=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};

function ActivitySettings({settings,onSaved}){
 const [form,setForm]=useState(settings);
 const [quiet,setQuiet]=useState(settings.quietPeriods.map(p=>`${clock(p.startMinute)}-${clock(p.endMinute)}`).join('\n'));
 const [weekdays,setWeekdays]=useState(settings.weekdays.join(','));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 const save=async event=>{
  event.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try{
   const periods=quiet.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{if(!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(s))throw new Error('Quiet periods use HH:MM-HH:MM, one per line');const [start,end]=s.split('-');return {startMinute:minute(start),endMinute:minute(end)};});
   await api('/api/v1/activity/settings',{method:'PATCH',body:JSON.stringify({...form,quietPeriods:periods,weekdays:weekdays.split(',').map(Number)})});
   onSaved('Activity policy saved. New comparisons use this policy; raw history is preserved.');window.dispatchEvent(new Event('childguard:activity-updated'));
  }catch(err){setError(err.message);}finally{inFlight.current=false;setBusy(false);}
 };
 return <details className="ao-panel"><summary>Configure movement monitoring</summary><form onSubmit={save} className="activity-settings">
  <label><input type="checkbox" checked={form.enabled} disabled={busy} onChange={e=>setForm({...form,enabled:e.target.checked})} /> Enable monitoring during confirmed attendance</label>
  <p>Set the center’s actual schedule and quiet periods before enabling. These are prototype movement thresholds, not clinical limits.</p>
  <label>Timezone<input value={form.timezone} required disabled={busy} onChange={e=>setForm({...form,timezone:e.target.value})} /></label>
  <label>Monitoring starts<input type="time" value={clock(form.startMinute)} disabled={busy} required onChange={e=>setForm({...form,startMinute:minute(e.target.value)})} /></label>
  <label>Monitoring ends<input type="text" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" value={clock(form.endMinute)} disabled={busy} required onChange={e=>setForm({...form,endMinute:minute(e.target.value)})} /></label>
  <label>Weekdays (0 Sunday to 6 Saturday)<input value={weekdays} disabled={busy} required onChange={e=>setWeekdays(e.target.value)} /></label>
  <label>Quiet periods (HH:MM-HH:MM, one per line)<textarea value={quiet} disabled={busy} onChange={e=>setQuiet(e.target.value)} /></label>
  {[
   ['baselineDays','Previous calendar days to compare'],['minBaselineDays','Minimum previous days needed'],['reductionPercent','Required reduction (%)'],['sustainedMinutes','Sustained reduction (minutes, multiples of 30)'],['minCoveragePercent','Minimum monitoring coverage (%)'],['minimumBaselineMADg','Minimum comparison movement (g MAD)'],
  ].map(([key,label])=><label key={key}>{label}<input type="number" step={key==='minimumBaselineMADg'?'0.001':'1'} value={form[key]} disabled={busy} required onChange={e=>setForm({...form,[key]:Number(e.target.value)})} /></label>)}
  <p>At most one advisory per child each operational day. Use the center?s actual rest schedule; none is assumed.</p>
  <ActionButton type="submit" disabled={busy}>{busy?'Saving…':'Save activity settings'}</ActionButton>
  {error&&<p role="alert">{error}</p>}
 </form></details>;
}
export default function ActivityMonitoring(){
 const [policyFeedback,setPolicyFeedback]=useState('');
 const [offset,setOffset]=useState(0),[selectedId,setSelectedId]=useState(''),[view,setView]=useState('today');
 const live=usePollingApi(`/api/v1/activity/children?limit=25&offset=${offset}`,'childguard:activity-updated');
 const settings=usePollingApi('/api/v1/activity/settings','childguard:activity-updated');
 const me=usePollingApi('/api/v1/auth/me');
 const rows=live.data||[],selected=rows.find(r=>r.child.id===selectedId)||rows[0];
 const chartData=useMemo(()=>{
  if(!selected)return [];
  if(view==='today')return selected.todayIntervals.map(r=>({...r,label:clock(r.startMinute)}));
  if(view==='baseline')return [...(selected.baselineCalendar??selected.baselineDays)].reverse().map(r=>({...r,label:r.day,baselineScoreMg:selected.comparisonWindows?.at(-1)?.baselineScoreMg??selected.baselineScoreMg}));
  return [...selected.history].slice(0,30).reverse().map(r=>({...r,label:r.day,baselineScoreMg:null}));
 },[selected,view]);
 const columns=[
  {key:'child',label:'Child',render:r=><button type="button" className="activity-child" onClick={()=>setSelectedId(r.child.id)}>{r.child.name}</button>},
  {key:'wearableId',label:'Wearable',render:r=>r.wearableId||'Not assigned'},
  {key:'state',label:'Monitoring status',render:r=>activityLabel(r.state)},
  {key:'currentScoreMg',label:'Today’s comparable movement',render:r=>score(r.currentScoreMg)},
  {key:'baselineScoreMg',label:'Previous comparable movement',render:r=>score(r.baselineScoreMg)},
  {key:'reductionPercent',label:'Reduction',render:r=>r.reductionPercent==null?'Unavailable':`${r.reductionPercent.toFixed(1)}%`},
  {key:'coveragePercent',label:'Coverage',render:r=>`${r.coveragePercent.toFixed(1)}%`},
  {key:'sensorStatus',label:'Sensor/data status'},
  {key:'lastSummaryAt',label:'Last summary end',render:r=>time(r.lastSummaryAt)},
  {key:'baselineDayCount',label:'Comparison history',render:r=>`${r.baselineDayCount} of ${r.policy.baselineDays} days (at least ${r.policy.minBaselineDays}) · ${r.baselineAvailable?'Available':'Learning'}`},
  {key:'alert',label:'Activity alert',render:r=>r.alert?`${r.alert.status} · ${time(r.alert.createdAt)}`:'None recorded'},
 ];
 return <div className="attendance-page"><Topbar hideTitle /><main className="attendance-content activity-page cg-admin-content">
  <div className="ao-panel-header"><h1>Activity Monitoring</h1><ActionButton variant="secondary" onClick={()=>window.dispatchEvent(new Event('childguard:activity-updated'))}>Refresh</ActionButton></div>
  <p className="cg-important-note">Movement readings are not a medical diagnosis. Missing readings do not prove inactivity.</p><TechnicalDetails title="How movement is measured"><p>Movement is measured from calibrated acceleration. The chart uses mean MAD in g multiplied by 1000 (mg). Missing readings stay unavailable. Readings update every 15 seconds. These readings are not a health diagnosis.</p></TechnicalDetails>
  {settings.data&&!settings.data.enabled&&<p role="status">Monitoring is disabled. An administrator must configure actual monitoring hours and quiet periods before enabling alerts.</p>}
  {rows.length>1&&<label>Child <select value={selected?.child.id??''} onChange={e=>setSelectedId(e.target.value)}>{rows.map(r=><option key={r.child.id} value={r.child.id}>{r.child.name}</option>)}</select></label>}
  {live.error?<p role="alert">{live.error}</p>:<TechnicalDetails title="Children and live monitoring overview"><DataTable columns={columns} data={rows} rowKey={r=>r.child.id} loading={live.loading} caption="Personalized child activity" emptyMessage="No registered children in your authorized center." /></TechnicalDetails>}
  <div className="ao-panel-header"><ActionButton variant="secondary" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous</ActionButton><span>{rows.length} children shown</span><ActionButton variant="secondary" disabled={rows.length<25} onClick={()=>setOffset(n=>n+25)}>Next</ActionButton></div>
  {selected&&<section className="ao-panel">
   <ActivityDailyHistory key={selected.child.id} activity={selected}/>
   <TechnicalDetails title="Authoritative time-matched monitoring and live details">
   <h2>{selected.child.name} — movement history</h2>
   <p>Status: {activityLabel(selected.state)}.</p>
   {selected.state==='BASELINE_LEARNING'&&<p>Collecting activity history. At least {selected.requiredBaselineDays??selected.policy.minBaselineDays??4} comparable days are needed before low-movement comparisons are available.</p>}
   {selected.state==='LOW_ACTIVITY'&&<p className="activity-advisory">Movement is below this child's usual level. Please check whether the child is resting or wearing the device correctly.</p>}
   <p>Previous {selected.policy.baselineDays} calendar days; today is excluded. Each 30-minute period uses its own comparison history. Valid comparison days: {selected.baselineDayCount}. Last evaluation: {time(selected.evaluatedAt)}.</p>
   {selected.alert&&<p className="activity-advisory">Low movement advisory recorded {time(selected.alert.createdAt)}. This is a wearable measurement advisory, not a diagnosis.</p>}
   <TechnicalDetails title="Movement readings and comparison details"><p>System status: {selected.state}</p><p>Latest movement reading: {score(selected.latestMeasurement?.scoreMg)} · Sensor coverage: {selected.latestMeasurement?`${selected.latestMeasurement.coveragePercent.toFixed(1)}%`:'Unavailable'} · Attendance confirmed: {selected.latestMeasurement?(selected.latestMeasurement.eligible?'Yes':'No'):'Unavailable'}. Sensor measurements remain inspectable when monitoring is disabled or attendance is pending; comparison and alert rules still apply.</p>
   <p>Comparison: {selected.period?`${clock(selected.period.startMinute)}–${clock(selected.period.endMinute)} on ${selected.day} (${selected.policy.timezone})`:'No eligible comparison period'}. Only complete, adequately covered attendance intervals qualify. Personal mean uses up to {selected.policy.baselineDays} previous qualifying days and excludes today.</p>
   <p>Today: {score(selected.currentScoreMg)} · Personal baseline: {score(selected.baselineScoreMg)} · Coverage: {selected.coveragePercent.toFixed(1)}%.</p>
   </TechnicalDetails><label>History view <select value={view} onChange={e=>setView(e.target.value)}><option value="today">Today — 30-minute intervals</option><option value="baseline">Previous calendar days — latest comparable period</option><option value="daily">Historical daily movement trend</option></select></label>
   <p>{view==='daily'?'Daily means use valid observed attendance time. Days may be partial and differ in monitoring duration; these daily means are not the alert comparison.':view==='today'?'Current partial intervals may appear in this chart but never trigger alerts. Missing baseline/measurements are gaps.':'Previous calendar days for the latest 30-minute comparison period. Missing days are gaps, not zero activity.'}</p>
   {chartData.length?<div className="activity-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis label={{value:'mg MAD',angle:-90,position:'insideLeft'}} /><Tooltip /><Legend /><Line type="monotone" dataKey="scoreMg" name="Observed movement" stroke="#0284c7" connectNulls={false} />{view!=='daily'&&<Line type="monotone" dataKey="baselineScoreMg" name="Personal baseline" stroke="#8b5cf6" connectNulls={false} />}</LineChart></ResponsiveContainer></div>:<p>No valid movement history for this view yet. Measurements and baseline will appear as real data becomes available.</p>}
   {view==='daily'&&<DataTable caption="Observed daily movement history" columns={[{key:'day',label:'Date'},{key:'scoreMg',label:'Observed mean',render:r=>score(r.scoreMg)},{key:'validMinutes',label:'Valid minutes',render:r=>r.validMinutes.toFixed(1)},{key:'partial',label:'Scope',render:()=> 'Observed attendance only; may be partial'}]} data={chartData} rowKey="day" emptyMessage="No historical activity measurements." />}
   </TechnicalDetails>
  </section>}
  {policyFeedback&&<p role="status">{policyFeedback}</p>}
  {settings.error&&<p role="alert">{settings.error}</p>}
  {me.data?.role==='ADMIN'&&settings.data&&<ActivitySettings key={JSON.stringify(settings.data)} settings={settings.data} onSaved={setPolicyFeedback} />}
 </main><Footer /></div>;
}
