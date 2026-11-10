import { getMonthDates, formatMonth } from '../lib/attendanceDates';
import { attendanceStates, attendanceLabel } from './attendance-chart-data';

export default function RecordedAttendanceCalendar({ month, rows = [], days = [], childId, onSelect, limited = false }) {
  const dates = getMonthDates(month);
  const leading = new Date(`${dates[0]}T12:00:00Z`).getUTCDay();
  const source = childId ? rows.filter(row => row.child?.id === childId) : days;
  return <div className="recorded-calendar">
    <div className="cm-calendar-navigation"><h4>{formatMonth(month)}</h4></div>
    <div className="cm-calendar-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><span key={day}>{day}</span>)}</div>
    <div className="cm-calendar-days">
      {Array.from({length:leading},(_,i)=><span key={`empty-${i}`} aria-hidden="true"/>)}
      {dates.map(date=>{
        const records=source.filter(row=>row.day===date && attendanceStates.some(state=>state.key===row.status));
        const actual=records.filter(row=>row.status!=='NO_RECORD');
        const title=actual.length?actual.map(row=>`${attendanceLabel(row.status,true)}${childId?'':`: ${row.count}`}`).join('; '):'No record in this response';
        const className=`cm-calendar-day ${actual.some(row=>row.status==='PRESENT')?'cm-calendar-day--present':actual.some(row=>row.status==='ABSENT')?'cm-calendar-day--absent':actual.some(row=>row.status==='CHECKIN_PENDING')?'cm-calendar-day--pending':actual.some(row=>row.status==='CHECKED_OUT')?'cm-calendar-day--checked-out':'cm-calendar-day--unrecorded'}`;
        const contents=<><strong>{Number(date.slice(-2))}</strong><small>{actual.length?(childId?attendanceLabel(actual[0].status):`${actual.reduce((n,r)=>n+r.count,0)} records`):'—'}</small></>;
        return onSelect&&actual.length?<button type="button" className={className} key={date} title={`${date}: ${title}`} aria-label={`${date}: ${title}`} onClick={()=>onSelect(actual[0])}>{contents}</button>:<div className={className} key={date} title={`${date}: ${title}`} aria-label={`${date}: ${title}`}>{contents}</div>;
      })}
    </div>
    <p className="ao-muted">Blank dates mean no record in this response, not absence.{limited?' Only loaded records are shown; additional pages may contain more history.':''}</p>
  </div>;
}
