import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from './ManagementUI';
import { attendanceChartData, attendanceDecisionStates, attendanceTrend } from './attendance-chart-data';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="cg-chart-tooltip">{label && <strong>{label}</strong>}{payload.map((p, i) => <p key={i}>{p.name}: <strong>{p.value}</strong></p>)}</div>;
}

export default function AttendanceCharts({ summary, roster, days, monthLabel, exportAction }) {
  if (!summary) return null;
  const {legend:distribution,slices,complete,total,decisions,remainder} = attendanceChartData(summary,roster);
  const trend = attendanceTrend(days);
  return <>
    <div className="ao-chart-layout restored-attendance-charts" aria-label="Attendance charts">
      <Panel className="ao-panel ao-pie-panel" title={roster ? 'Daily attendance distribution' : 'Attendance decisions'} description={roster ? 'Counts for the selected day.' : 'Saved attendance decisions in this period.'}>
        <div className="cg-chart-canvas" role="img" aria-label="Attendance status distribution; exact counts are listed below">
          {complete && total > 0 ? <ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={slices} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="#fff" isAnimationActive={false}>{slices.map(r => <Cell key={r.key} fill={r.color} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart></ResponsiveContainer> : <div className="cg-chart-empty">{complete ? 'No stored attendance counts in this period.' : 'Attendance counts are unavailable.'}</div>}
        </div>
        <ul className="cg-chart-legend" aria-label="Exact attendance counts">{distribution.map(r => <li key={r.key}><span className="cg-chart-dot" style={{ '--chart-color': r.color }} aria-hidden="true" />{r.name}: <strong>{r.value ?? 'Unavailable'}</strong></li>)}</ul>
        <p className="ao-muted">{complete ? `${decisions} of ${total} ${roster?'children':'saved records'} have an attendance decision.${remainder?' Grey shows the rest.':''}` : 'Missing attendance is not absence.'}</p>
      </Panel>
      <Panel className="ao-panel ao-bar-panel" title="Attendance Trends" description={roster ? 'Counts from the selected daily roster.' : 'Counts from actual stored records in this period.'}>
        <div className="cg-chart-canvas" role="img" aria-label="Comparison of recorded attendance status counts">
          {complete && total > 0 ? <ResponsiveContainer width="100%" height="100%"><BarChart data={distribution} layout="vertical" margin={{ left: 0, right: 18, top: 12, bottom: 4 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7eef6" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="short" width={98} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="value" name="Count" radius={[0, 5, 5, 0]} maxBarSize={24} isAnimationActive={false}>{distribution.map(r => <Cell key={r.key} fill={r.color} />)}</Bar></BarChart></ResponsiveContainer> : <div className="cg-chart-empty">No comparison available yet.</div>}
        </div>
        <p className="ao-muted">Pending means waiting for Teacher confirmation.</p>
      </Panel>
    </div>
    {!roster && <Panel title={`Daily Attendance — ${monthLabel}`} description="Recorded decisions for each day. Missing dates are not marked absent." actions={exportAction}>
      {trend.length ? <div className="cg-chart-canvas" role="img" aria-label="Historical stored attendance counts"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ left: 0, right: 12 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" stroke="#e7eef6" vertical={false} /><XAxis dataKey="day" tickFormatter={value => value.slice(-2)} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} />{attendanceDecisionStates.map(s => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></div> : <div className="cg-chart-empty">No stored daily counts for this period.</div>}
      <ul className="cg-chart-legend">{attendanceDecisionStates.map(s => <li key={s.key}><span className="cg-chart-dot" style={{ '--chart-color': s.color }} aria-hidden="true" />{s.name}</li>)}</ul>
      <p className="ao-muted">Charts show attendance decisions. Exports retain all saved statuses.</p>
    </Panel>}
  </>;
}
