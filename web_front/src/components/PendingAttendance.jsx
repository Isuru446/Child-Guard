import { useCallback,useEffect,useState } from 'react';
import {formatDate,getTodayKey} from '../lib/attendanceDates';
import {attendanceTime as time} from '../lib/attendance-report';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import DataTable from './DataTable';
import ActionButton from './ActionButton';
export default function PendingAttendance({day,enabled=true,refreshKey=0}) {
 const [offset,setOffset]=useState(0);
 const q=new URLSearchParams({management:'true',view:'roster',status:'CHECKIN_PENDING',limit:'25',offset:String(offset),...(day?{day}:{})});
 const accept=useCallback(data=>{if(offset>0&&data?.rows?.length===0)setOffset(0);},[offset]);
 const read=useMonitoringRead(`/api/v1/attendance?${q}`,{enabled,onData:accept});
 const refresh=read.refresh;
 useEffect(()=>{if(refreshKey&&enabled)refresh();},[refreshKey,enabled,refresh]);
 return <section className="ao-panel" id="pending-attendance" aria-labelledby="pending-attendance-title"><div className="ao-panel-header"><h3 id="pending-attendance-title">Pending Teacher Confirmations</h3><ActionButton variant="secondary" disabled={read.refreshing} onClick={read.refresh}>Refresh pending</ActionButton></div>
 <p className="ao-muted">{day&&day!==getTodayKey()?`Historical pending records for ${formatDate(day)}. Teacher confirmation is closed.`:`Today, ${formatDate(day||getTodayKey())}. Teachers confirm attendance in the Teacher app. An authorized RFID reader can also confirm an eligible arrival.`}</p>
 {read.error&&<p role="alert">{read.error}</p>}{read.paused&&<p role="status">Pending monitoring paused.</p>}
 <DataTable caption="Pending teacher confirmations" data={read.data?.rows??[]} loading={read.loading} emptyMessage={read.error?'Pending attendance is unavailable. Refresh to try again.':'No pending teacher confirmations in this view.'} columns={[
  {key:'child',label:'Child',render:r=>r.child.name},{key:'day',label:'Attendance date',render:r=>formatDate(r.day)},
  {key:'arrival',label:'Gate event received',render:r=>time(r.arrival?.receivedAt)},
  {key:'belt',label:'Arrival belt',render:r=>r.arrival?.wearable||'Not recorded'},
  {key:'gate',label:'Gate',render:r=>r.arrival?.gate||'Not recorded'},
  {key:'status',label:'Status',render:r=>r.confirmationClosed?'Pending from a prior day; confirmation closed':'Pending'},
 ]}/><div className="ao-panel-header"><ActionButton disabled={read.refreshing||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous pending</ActionButton><span>Page {offset/25+1}</span><ActionButton disabled={read.refreshing||!read.data?.hasMore} onClick={()=>setOffset(n=>n+25)}>Next pending</ActionButton></div>
 </section>;
}
