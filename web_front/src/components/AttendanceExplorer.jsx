import { useState } from 'react';
import { CalendarDays, Users, FileText } from 'lucide-react';
import ActionButton from './ActionButton';
import RecordedAttendanceCalendar from './RecordedAttendanceCalendar';
import { attendanceLabel } from './attendance-chart-data';

export default function AttendanceExplorer({rows,days,month,view,day,hasMore,onDetails,onReport,reportBusy,reportDisabled}) {
  const [selectedId,setSelectedId]=useState('');
  const children=[...new Map(rows.map(row=>[row.child.id,row.child])).values()];
  const childId=children.some(c=>c.id===selectedId)?selectedId:'';
  return <>
    <div className="ao-calendar-layout">
      <section className="ao-panel"><div className="ao-panel-header"><h3><CalendarDays size={18}/> Attendance Calendar</h3></div><label className="ao-month-input">Calendar records<select value={childId} onChange={e=>setSelectedId(e.target.value)}><option value="">Center stored counts</option>{children.map(child=><option key={child.id} value={child.id}>{child.name}</option>)}</select></label><p className="ao-muted">{view==='roster'?`Showing ${day}. Select Monthly History for past dates.`:'Child calendars show the current page of records.'}</p><RecordedAttendanceCalendar month={view==='roster'?day.slice(0,7):month} days={days} rows={rows} childId={childId||undefined} limited={!!childId&&hasMore} onSelect={childId?onDetails:undefined}/></section>
      <section className="ao-panel ao-children-panel"><div className="ao-panel-header"><h3><Users size={18}/> Children's Attendance</h3></div><p className="ao-muted">Select a child to view attendance details.</p><div className="restored-attendance-children">{rows.length?rows.map(row=><button key={`${row.child.id}-${row.day}`} type="button" className="ao-child" onClick={()=>onDetails(row)}><span className="ao-avatar" aria-hidden="true">{row.child.name.slice(0,1)}</span><span className="ao-child-info"><strong>{row.child.name}</strong><small>{row.day} · {attendanceLabel(row.status)}</small></span></button>):<p className="ao-list-empty">No child records match this view.</p>}</div></section>
    </div>
    <section className="ao-panel ao-report"><div className="ao-panel-header"><h3><FileText size={18}/> {view==='history'?'Monthly Report':'Attendance Report'}</h3><ActionButton disabled={reportBusy||reportDisabled} onClick={onReport}>{reportBusy?'Preparing report...':view==='history'?'Download Monthly Report':'Download Daily Report'}</ActionButton></div><p className="ao-muted">Includes all matching pages for the selected {view==='history'?'month':'date'}, search and status. Original attendance statuses are kept.</p></section>
  </>;
}
