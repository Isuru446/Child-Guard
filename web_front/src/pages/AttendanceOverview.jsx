import {confirmationLabel} from '../lib/attendance-report';
import MonitoringStatus from '../components/MonitoringStatus';
import {attendanceTime as time,checkinTime,checkoutTime,lastAttendanceUpdate,attendanceCsvRows,downloadCsv,loadAttendanceReport} from '../lib/attendance-report';
import {attendanceDecisionStates,attendanceLabel} from '../components/attendance-chart-data';
import TechnicalDetails from '../components/TechnicalDetails';
import ModalCloseButton from '../components/ModalCloseButton';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import AttendanceCharts from '../components/AttendanceCharts';
import AttendanceExplorer from '../components/AttendanceExplorer';
import '../style/AttendanceRestoration.css';
import { PageHeading } from '../components/ManagementUI';
import { Users, UserCheck, Clock } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import ActionButton from '../components/ActionButton';
import PendingAttendance from '../components/PendingAttendance';
import ResetAttendance from '../components/ResetAttendance';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import { getTodayKey, getMonthDates, formatMonth, formatDate } from '../lib/attendanceDates';
import '../style/AttendanceOverview.css';
import '../style/RegistrationApproval.css';
function Details({row,onClose}) {
 const ref=useRef(null);
 useDialogAccessibility(ref,onClose);
 return <div className="ao-modal-overlay"><section ref={ref} tabIndex={-1} className="ao-modal" role="dialog" data-dialog-size="medium" aria-modal="true" aria-label="Attendance record details"><div className="cg-dialog-header"><h2>{row.child.name}</h2><ModalCloseButton onClick={onClose}/></div><p>{formatDate(row.day)} — {attendanceLabel(row.status,true)}</p><dl><dt>Current assigned belt</dt><dd>{row.currentAssignment?.device?.hardwareId||'Unassigned'}</dd><dt>Recorded arrival belt</dt><dd>{row.arrival?.wearable||'Not recorded'}</dd><dt>Recorded gate</dt><dd>{row.arrival?.gate||'Not recorded'}</dd><dt>Gate event received</dt><dd>{time(row.arrival?.receivedAt)}</dd><dt>Confirmed by</dt><dd>{row.confirmation?.method==='RFID_CARD'?confirmationLabel(row.confirmation):row.confirmation?`${row.confirmation.username} (${row.confirmation.roleAtConfirmation||'historical role unavailable'})`:'Not confirmed'}</dd><dt>Check-in time</dt><dd>{time(checkinTime(row))}</dd><dt>Check-out time</dt><dd>{time(checkoutTime(row))}</dd><dt>Checked out by</dt><dd>{row.checkout?.by?.username||'Not recorded'}</dd></dl>
 {(row.absenceHistory??[]).map(a=><p key={a.id}>{a.type==='ABSENT'?'Marked absent':'Absence corrected'}: {a.by?.username||'Teacher'} / {time(a.at)}</p>)}
 <p>The Gate update time is not proof of physical presence. Check the recorded attendance confirmation method separately.</p><TechnicalDetails title="Previous confirmations and development resets"><p>Record status: {row.status}{row.status==='NO_RECORD'?' (no saved attendance record)':''}.</p>
 {!(row.previousConfirmations?.length||row.resets?.length)&&<p>No previous confirmation/reset records in this response.</p>}{row.previousConfirmations?.map((c,i)=><p key={i}>Previous confirmation: {c.username} / {time(c.confirmedAt)}</p>)}{row.resets?.map(r=><p key={r.id}>Development reset: {r.username} / {time(r.createdAt)}</p>)}
 <ResetAttendance row={row}/></TechnicalDetails></section></div>;
}
export default function AttendanceOverview() {
 const [day,setDay]=useState(getTodayKey),[month,setMonth]=useState(()=>getTodayKey().slice(0,7)),[view,setView]=useState('roster'),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[detail,setDetail]=useState(null);
 const [reportBusy,setReportBusy]=useState(false),[reportFeedback,setReportFeedback]=useState(null);
 const reportController=useRef(null),reportPending=useRef(false),mounted=useRef(true);
 const [pendingRevision,setPendingRevision]=useState(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const today=getTodayKey(),from=month+'-01',to=getMonthDates(month).at(-1)>today?today:getMonthDates(month).at(-1);
 const q=new URLSearchParams({management:'true',view,limit:'25',offset:String(offset),...(view==='roster'?{day}:{from,to}),...(status?{status}:{}),...(search.trim()?{search:search.trim()}:{})});
 const path=`/api/v1/attendance?${q}`;
 const accept=useCallback(data=>{if(offset>0&&data?.rows?.length===0)setOffset(0);},[offset]);
 const read=useMonitoringRead(path,{enabled:!detail,startDelay:200,onData:accept});
 useEffect(()=>()=>{reportController.current?.abort();},[path]);
 const rows=read.data?.rows??[],summary=read.data?.summary;
 function switchView(value){setView(value);setStatus('');setOffset(0);}
 function csv(){
  if(read.loading||read.refreshing||read.stale||!rows.length)return;
  try{downloadCsv(attendanceCsvRows(rows),`childguard-attendance-${view==='roster'?day:month}-page-${offset/25+1}.csv`);setReportFeedback({key:path,text:'Attendance download started.'});}
  catch{setReportFeedback({key:path,error:'Unable to download attendance. Please try again.'});}
 }
 async function report(){
  if(reportPending.current)return;reportPending.current=true;setReportBusy(true);setReportFeedback(null);
  const controller=new AbortController();reportController.current=controller;
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},60000);
  try{
   const all=await loadAttendanceReport(path,{signal:controller.signal});if(controller.signal.aborted)return;
   if(!all.length){setReportFeedback({key:path,text:'No attendance records match this report.'});return;}
   downloadCsv(attendanceCsvRows(all),`childguard-attendance-${view==='roster'?day:month}-all-matching.csv`);setReportFeedback({key:path,text:'Attendance report download started.'});
  }catch{if(mounted.current&&(timedOut||!controller.signal.aborted))setReportFeedback({key:path,error:timedOut?'The report took too long. Narrow your search and try again.':'Unable to download the complete report. Refresh and try again.'});}
  finally{clearTimeout(timeout);reportPending.current=false;if(mounted.current)setReportBusy(false);}
 }
 function countsCsv(){
  try{downloadCsv([['Day','Attendance status','Count'],...read.data.days.map(r=>[r.day,r.status,r.count])],`childguard-attendance-counts-${month}.csv`);setReportFeedback({key:path,text:'Daily counts download started.'});}
  catch{setReportFeedback({key:path,error:'Unable to download daily counts. Please try again.'});}
 }
 function refresh(){read.refresh();setPendingRevision(value=>value+1);}
 const scope=view==='roster'?`Attendance for ${formatDate(day)}`:`Attendance records for ${formatMonth(month)}`;
 const count=value=>Number.isSafeInteger(value)&&value>=0?value:'Unavailable';
 const empty=read.error?'Attendance is unavailable. Refresh to try again.':search.trim()?'No children match your search.':status==='ABSENT'?(view==='roster'&&day===today?'No children have been marked absent today.':view==='history'?'No children have been marked absent for this month.':'No children have been marked absent for this date.'):status==='CHECKED_OUT'?'No children have been checked out for this view.':status==='CHECKIN_PENDING'?'No children are waiting for confirmation in this view.':view==='history'?'No saved attendance records for this month.':'No children match this attendance view.';
 return <div className="attendance-page"><Topbar hideTitle/><main className="attendance-content cg-admin-content"><PageHeading title="Attendance Overview"></PageHeading><p className="ao-muted">View daily attendance and past records.</p>

 <MonitoringStatus read={read}/>
 <h2 className="ao-scope">{scope}</h2><p className="ao-muted">{view==='roster'?'Center totals before search and status filters.':'Saved records this month. Registered Children is the current center roster.'}</p>
 {reportFeedback?.key===path&&(reportFeedback.error?<p role="alert">{reportFeedback.error}</p>:<p role="status">{reportFeedback.text}</p>)}
 {summary&&<section className="ao-stats" aria-label="Stored attendance summary"><StatCard title="Registered Children" value={count(summary.rosterCount)} icon={Users}/><StatCard title="Present" value={count(summary.PRESENT)} icon={UserCheck}/><div className="ao-stat-with-help" title="Waiting for Teacher confirmation."><StatCard title="Pending" value={count(summary.CHECKIN_PENDING)} icon={Clock}/></div><StatCard title="Absent" value={count(summary.ABSENT)} icon={Users}/><StatCard title="Checked Out" value={count(summary.CHECKED_OUT)} icon={Users}/></section>}

 <div className="registration-tools"><label>Attendance view<select value={view} onChange={e=>switchView(e.target.value)}><option value="roster">Daily Attendance</option><option value="history">Monthly History</option></select></label>
 {view==='roster'?<label>Attendance date<input type="date" max={today} value={day} onChange={e=>{if(e.target.value){setDay(e.target.value);setOffset(0);}}}/></label>:<label>History month<input type="month" max={today.slice(0,7)} value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setOffset(0);}}}/></label>}
 <label>Search children<input maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label><label>Attendance status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">All Children</option>{attendanceDecisionStates.map(({key,name})=><option key={key} value={key}>{name}</option>)}</select></label><ActionButton disabled={read.refreshing} onClick={refresh}>Refresh attendance</ActionButton><ActionButton disabled={!rows.length||read.loading||read.refreshing||read.stale||reportBusy} onClick={csv}>Export current page</ActionButton></div>


<p className="cg-field-help">Teachers record attendance in the Teacher app. A dash (—) means no attendance decision has been recorded.</p>
 <section className="ao-panel"><h2>{view==='roster'?'Daily Attendance':'Attendance history'}</h2><DataTable caption="Center attendance records" loading={read.loading} data={rows} emptyMessage={empty} columns={[
  {key:'child',label:'Child',render:r=>r.child.name},{key:'day',label:'Attendance Date',render:r=>formatDate(r.day)},{key:'status',label:'Attendance Status',render:r=><span title={r.confirmationClosed?'This date is closed for Teacher confirmation.':r.status==='CHECKIN_PENDING'?'Waiting for Teacher confirmation.':r.status==='ABSENT'?'Marked absent by a Teacher.':r.status==='CHECKED_OUT'?'Child has left for the day.':undefined}>{attendanceLabel(r.status)}</span>},
  {key:'source',label:'Confirmation source',render:r=>confirmationLabel(r.confirmation)},
  {key:'checkin',label:'Check-in Time',render:r=>time(checkinTime(r))},
  {key:'checkout',label:'Check-out Time',render:r=>time(checkoutTime(r))},
  {key:'updated',label:'Last Updated',render:r=>time(lastAttendanceUpdate(r))},
  {key:'details',label:'Details',render:r=><ActionButton aria-label={`View details for ${r.child.name}`} onClick={()=>setDetail(r)}>View Details</ActionButton>},
 ]}/><div className="cg-pagination"><ActionButton disabled={read.refreshing||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous records</ActionButton><span> Page {offset/25+1} </span><ActionButton disabled={read.refreshing||!read.data?.hasMore} onClick={()=>setOffset(n=>n+25)}>Next records</ActionButton></div></section>

 {view==='roster'&&<PendingAttendance key={day} day={day} enabled={!detail} refreshKey={pendingRevision}/>}
 <AttendanceCharts summary={summary} roster={view==='roster'} days={read.data?.days??[]} monthLabel={formatMonth(month)} exportAction={<ActionButton title="All center daily counts for this month; search and status filters do not apply." disabled={!read.data?.days?.length||read.loading||read.refreshing||read.stale} onClick={countsCsv}>Export daily counts</ActionButton>}/>
 <AttendanceExplorer rows={rows} days={read.data?.days??[]} month={month} view={view} day={day} hasMore={read.data?.hasMore||offset>0} reportBusy={reportBusy} reportDisabled={read.loading||!!read.error||read.refreshing} onReport={report} onDetails={setDetail}/>
 {detail&&<Details row={detail} onClose={()=>setDetail(null)}/>}
 </main><Footer/></div>;
}
