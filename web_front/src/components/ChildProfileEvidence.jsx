import ChildLocationControl from './ChildLocationControl';
import TamperStatus from './TamperStatus';
import { useEffect, useRef, useState } from 'react';
import { Activity, MapPin } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ActionButton from './ActionButton';
import RecordedAttendanceCalendar from './RecordedAttendanceCalendar';
import { api } from '../lib/api';
import { getTodayKey, getMonthDates, formatMonth } from '../lib/attendanceDates';
import { attendanceStates, attendanceDecisionStates, attendanceTrend } from './attendance-chart-data';

export default function ChildProfileEvidence({child}) {
  return <ProfileEvidence key={child.id} child={child}/>;
}

function ProfileEvidence({child}) {
  const [month,setMonth]=useState(()=>getTodayKey().slice(0,7));
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0),pending=useRef(null);
  useEffect(()=>()=>{sequence.current++;pending.current?.abort();},[child.id]);
  function changeMonth(value){if(!value)return;sequence.current++;pending.current?.abort();setMonth(value);setResult(null);setError('');setBusy(false);}
  async function load(more=false){
    const own=++sequence.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},15000);setBusy(true);setError('');
    try {
      const dates=getMonthDates(month),today=getTodayKey(),offset=more?(currentResult?.offset??0)+50:0;
      const q=new URLSearchParams({management:'true',view:'history',from:dates[0],to:dates.at(-1)>today?today:dates.at(-1),childId:child.id,limit:'50',offset:String(offset)});
      const data=await api(`/api/v1/attendance?${q}`,{signal:controller.signal});
      if(timedOut)throw Error('Child history request timed out. Please retry.');
      if(own===sequence.current)setResult({childId:child.id,rows:[...(more?currentResult.rows:[]),...(data.rows??[]).filter(row=>row.child?.id===child.id)],hasMore:data.hasMore===true,offset});
    }catch(e){if(own===sequence.current)setError(timedOut?'Child history request timed out. Please retry.':e.message);}finally{clearTimeout(timer);if(pending.current===controller)pending.current=null;if(own===sequence.current)setBusy(false);}
  }
  const currentResult=result?.childId===child.id?result:null;
  const rows=currentResult?.rows??[],trend=attendanceTrend(rows.map(row=>({day:row.day,status:row.status,count:1})));
  return <>
    <div className="cm-profile-card"><span className="cm-profile-image cm-avatar-fallback" aria-hidden="true">{child.name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</span><div className="cm-profile-main"><div className="cm-profile-name-row"><h2>{child.name}</h2><span className="cm-id-badge">{child.groupName||'Group not recorded'}</span></div><p><strong>Child reference:</strong> {child.id}</p><p>{child.guardians.length} linked Guardian(s) · {child.assignments.length?child.assignments.map(a=>a.device.hardwareId).join(', '):'Wearable unassigned'}</p>{child.assignments.map(a=><TamperStatus key={a.id} tamper={a.device.tamper}/>)}</div></div>
    <div className="cm-profile-grid">
      <div className="cm-profile-left"><section className="cm-panel"><h3><MapPin size={18}/>Location Preview</h3><ChildLocationControl key={child.id} child={child}/></section>
      <section className="cm-panel"><h3><Activity size={18}/>Monthly Attendance</h3><p>{formatMonth(month)} · child records loaded for this view</p>{trend.length?<div className="restored-child-chart"><ResponsiveContainer width="100%" height={220}><BarChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickFormatter={v=>v.slice(-2)}/><YAxis allowDecimals={false}/><Tooltip/>{attendanceDecisionStates.map(state=><Bar key={state.key} dataKey={state.key} name={state.name} fill={state.color} isAnimationActive={false}/>)}</BarChart></ResponsiveContainer></div>:<p>Choose Load monthly records to view attendance history.</p>}</section></div>
      <section className="cm-panel"><div className="cm-attendance-header"><h3><Activity size={18}/>Attendance Calendar</h3><label className="cm-month-picker"><span>Child history month</span><input type="month" max={getTodayKey().slice(0,7)} value={month} onChange={e=>changeMonth(e.target.value)}/></label></div><div className="cm-attendance-summary">{['PRESENT','CHECKIN_PENDING','ABSENT','CHECKED_OUT'].map(status=><div key={status}><span>{attendanceStates.find(s=>s.key===status).short}</span><strong>{currentResult?rows.filter(r=>r.status===status).length:'—'}</strong></div>)}</div><ActionButton disabled={busy} onClick={()=>load()}>{busy?'Loading child history…':'Load monthly records'}</ActionButton>{currentResult?.hasMore&&<ActionButton disabled={busy} onClick={()=>load(true)}>Load more child history</ActionButton>}{error&&<p role="alert">{error}</p>}<RecordedAttendanceCalendar month={month} childId={child.id} rows={rows} limited={currentResult?.hasMore}/></section>
    </div>
  </>;
}
