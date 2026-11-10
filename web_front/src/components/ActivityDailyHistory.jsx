import { useState } from 'react';
import { BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts';
import { Activity, ArrowDown, Minus } from 'lucide-react';
import usePollingApi from '../hooks/usePollingApi';

const historyColor = row => row.scoreMg == null ? 'transparent' : row.classification === 'belowAverage' ? '#d84343' : '#1683c7';
const mg = value => Number.isFinite(value) ? `${value.toFixed(1)} mg` : 'Not available';
const date = value => value ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Colombo', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00+05:30`)) : 'No recorded day';

function ReadingTooltip({ active, payload, label }) {
 if (!active || !payload?.length) return null;
 const row = payload[0].payload;
 return <div className="activity-reading-tooltip"><strong>{date(label)}</strong><p>{mg(row.scoreMg)} · {row.statusLabel}</p></div>;
}

export default function ActivityDailyHistory({ activity }) {
 const [period, setPeriod] = useState('7');
 const [selectedDay, setSelectedDay] = useState(null);
 const path = `/api/v1/activity/children/${encodeURIComponent(activity.child.id)}`;
 // Only the authorized detail response can enable the existing development
 // fixture. Never select by name or reuse stale availability from a roster.
 const recorded = usePollingApi(path, 'childguard:activity-updated');
 const recordedActivity = recorded.data?.child?.id === activity.child.id ? recorded.data : null;
 const demonstration = recordedActivity?.historyPreviewAvailable === true;
 const preview = usePollingApi(demonstration ? `${path}?source=sample` : null, 'childguard:activity-updated');
 const read = demonstration ? preview : recorded;
 const current = demonstration
  ? preview.data?.child?.id === activity.child.id && preview.data.dailyHistory?.provenance === 'sample' ? preview.data : null
  : recordedActivity;
 const history = current?.dailyHistory;
 const view = history?.periods?.[period];
 const selected = view?.days.find(r => r.day === selectedDay) ?? view?.days.at(-1);
 const latest = history?.lastRecordedDay;
 return <section className="activity-daily" aria-label="Daily movement history">
  <div className="ao-panel-header"><h2><Activity size={18} aria-hidden="true"/> {activity.child.name} · Activity History</h2>
  </div>
  {read.error && <div role="alert"><p>{read.error} Activity history could not be loaded.</p><button type="button" onClick={read.refresh}>Retry activity history</button></div>}
  {!history ? !read.error && <div><p role="status">{read.loading ? 'Loading activity history...' : 'Daily activity history is unavailable. Refresh to load the latest history.'}</p>{!read.loading && <button type="button" onClick={read.refresh}>Retry activity history</button>}</div> : <>
   <div className="activity-periods" role="group" aria-label="Activity chart period">{['7', '21'].map(p => <button key={p} type="button" aria-pressed={period === p} onClick={() => { setPeriod(p); setSelectedDay(null); }}>Last {p} Days</button>)}</div>
   <span className="activity-source">{history.provenance === 'sample' ? 'Demonstration activity history' : history.sourceLabel} · {history.start} – {history.end}</span>
   <div className={`activity-daily-status ${['significantlyBelow', 'slightlyBelow'].includes(history.status) ? 'is-lower' : ''}`}>
    <h3>{['significantlyBelow', 'slightlyBelow'].includes(history.status) ? <ArrowDown size={20} aria-hidden="true"/> : <Activity size={20} aria-hidden="true"/>}{history.statusLabel}</h3><p>{history.explanation}</p>
   </div>
   <div className="activity-daily-summary">
    <div><span>7-Day Average</span><strong>{mg(history.periods['7'].averageMg)}</strong><small>{history.periods['7'].validDayCount} valid recorded days</small></div>
    <div><span>Last Recorded Day · {date(latest?.day)}</span><strong>{mg(latest?.scoreMg)}</strong><small>{history.percentDifference == null ? 'Comparison not available' : `${Math.round(Math.abs(history.percentDifference))}% ${history.percentDifference < 0 ? 'below' : 'above'} average`}</small></div>
   </div>
   {view && <>
    <p><strong>{period}-day average: {mg(view.averageMg)}</strong> · {view.validDayCount} valid days · {view.start} – {view.end}</p>
    <div className="activity-chart" aria-label={`${period}-day activity chart`}>
     <ResponsiveContainer width="100%" height={260}>
      <BarChart data={view.days} margin={{ top: 22, right: 24, bottom: 8, left: 0 }} onClick={state => { if (state?.activeLabel) setSelectedDay(state.activeLabel); }} accessibilityLayer>
       <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickFormatter={date} minTickGap={18} tick={{ fontSize: 11 }}/><YAxis unit=" mg" width={52}/>
       <Tooltip content={<ReadingTooltip/>} filterNull={false}/>
       {view.days.filter(row => row.scoreMg == null).map(row => <ReferenceDot key={row.day} x={row.day} y={0} r={3} fill="#fff" stroke="#94a3b8" onClick={() => setSelectedDay(row.day)}/>)}
       <Bar dataKey="scoreMg" name="Movement (mg)" radius={[5, 5, 0, 0]} maxBarSize={38} isAnimationActive={false}>
        {view.days.map(row => <Cell key={row.day} fill={historyColor(row)}/>)}
       </Bar>
       {view.averageMg != null && <ReferenceLine y={view.averageMg} stroke="#64748b" strokeDasharray="6 4" label={{ value: `${period}-day mean`, position: 'insideTopRight', fontSize: 11 }}/ >}
      </BarChart>
     </ResponsiveContainer>
    </div>
    <div className="activity-chart-legend"><span><i className="activity-key-normal"/>Normal</span><span><i className="activity-key-low"/>↓ Below average</span><span><Minus size={14}/> No data / partial</span><span>-- {period}-day mean</span></div>
    <p aria-live="polite">{selected && `${date(selected.day)}: ${mg(selected.scoreMg)} · ${selected.statusLabel}`}</p>
    <details className="cg-technical"><summary>Daily readings and missing dates</summary><div className="activity-day-list">{view.days.map(row => <button type="button" key={row.day} onClick={() => setSelectedDay(row.day)} aria-label={`${row.day}: ${mg(row.scoreMg)}, ${row.statusLabel}`}><span>{date(row.day)}</span><span>{mg(row.scoreMg)}</span><span>{row.statusLabel}</span></button>)}</div></details>
   </>}
   <p>The mean uses only adequately monitored recorded days in the selected completed calendar period. Missing days are excluded, never counted as zero. {history.comparisonRule}</p>
  </>}
 </section>;
}
