import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AttendanceCharts from './AttendanceCharts';
import { attendanceDistribution, attendanceTrend, attendanceChartData } from './attendance-chart-data';

// Keep the exact data visible while avoiding jsdom's lack of SVG layout.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  Pie: ({ data }) => <output aria-label="Distribution chart source">{JSON.stringify(data)}</output>,
  BarChart: ({ data }) => <output aria-label="Comparison chart source">{JSON.stringify(data)}</output>,
  Bar: () => null, Cell: () => null, CartesianGrid: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
afterEach(cleanup);
const summary = { rosterCount: 8, PRESENT: 3, CHECKIN_PENDING: 2, NOT_CHECKED_IN: 1, CHECKED_OUT: 0, ABSENT: 0, NO_RECORD: 2 };

it('uses exact center summary counts, including pending and missing records, without deriving absence', () => {
  render(<AttendanceCharts summary={summary} roster days={[]} />);
  const data = JSON.parse(screen.getByLabelText('Distribution chart source').textContent);
  expect(data.map(r => [r.key, r.value])).toEqual([['PRESENT', 3], ['CHECKIN_PENDING', 2], ['ABSENT', 0], ['CHECKED_OUT', 0], ['UNDECIDED', 3]]);
  expect(screen.getByLabelText('Exact attendance counts').textContent).toContain('Pending: 2');
  expect(screen.getByText('5 of 8 children have an attendance decision. Grey shows the rest.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
});
it('does not turn unavailable or invalid counts into zero or draw a misleading partial pie', () => {
  const data = attendanceDistribution({ ...summary, PRESENT: -1, CHECKED_OUT: undefined });
  expect(data.find(r => r.key === 'PRESENT').value).toBeNull();
  expect(data.find(r => r.key === 'CHECKED_OUT').value).toBeNull();
  render(<AttendanceCharts summary={{ ...summary, PRESENT: undefined }} roster />);
  expect(screen.queryByLabelText('Distribution chart source')).toBeNull();
  expect(screen.getByText('Attendance counts are unavailable.')).toBeTruthy();
});
it('renders honest empty states for zero counts and absent history', () => {
  render(<AttendanceCharts summary={{ PRESENT: 0, CHECKIN_PENDING: 0, NOT_CHECKED_IN: 0, CHECKED_OUT: 0, ABSENT: 0 }} roster={false} days={[]} monthLabel="October 2026" />);
  expect(screen.getByText('No stored attendance counts in this period.')).toBeTruthy();
  expect(screen.getByText('No stored daily counts for this period.')).toBeTruthy();
  expect(screen.queryByLabelText('Comparison chart source')).toBeNull();
});
it('plots only returned historical dates and recorded statuses, with gaps rather than manufactured observations', () => {
  const rows = [{ day: '2026-10-01', status: 'PRESENT', count: 2 }, { day: '2026-10-04', status: 'CHECKIN_PENDING', count: 1 }];
  expect(attendanceTrend(rows)).toEqual([
    { day: '2026-10-01', PRESENT: 2, CHECKIN_PENDING: 0, NOT_CHECKED_IN: 0, CHECKED_OUT: 0, ABSENT: 0 },
    { day: '2026-10-04', PRESENT: 0, CHECKIN_PENDING: 1, NOT_CHECKED_IN: 0, CHECKED_OUT: 0, ABSENT: 0 },
  ]);
  render(<AttendanceCharts summary={summary} roster={false} days={rows} monthLabel="October 2026" />);
  expect(screen.getByRole('heading', { name: 'Daily Attendance — October 2026' })).toBeTruthy();
  expect(screen.getByText(/Missing dates are not marked absent/)).toBeTruthy();
  expect(JSON.stringify(attendanceDistribution(summary, false))).not.toContain('NO_RECORD');
});
it('includes recorded ABSENT while ignoring computed NO_RECORD and invalid measurements', () => {
  expect(attendanceTrend([{ day: '2026-10-01', status: 'ABSENT', count: 5 }, { day: '2026-10-01', status: 'NO_RECORD', count: 5 }, { day: 'bad date', status: 'PRESENT', count: 1 }, { day: '2026-10-01', status: 'PRESENT', count: -1 }])).toEqual([{day:'2026-10-01',PRESENT:0,CHECKIN_PENDING:0,NOT_CHECKED_IN:0,CHECKED_OUT:0,ABSENT:5}]);
});
it('does not render a chart before an authoritative summary is received', () => {
  const { container } = render(<AttendanceCharts summary={null} roster />);
  expect(container.textContent).toBe('');
});
it('keeps the full roster denominator without presenting undecided children as absent or named status series',()=>{
 const counts={rosterCount:10,PRESENT:2,CHECKIN_PENDING:1,ABSENT:1,CHECKED_OUT:1,NOT_CHECKED_IN:2,NO_RECORD:3};
 const chart=attendanceChartData(counts,true);
 expect(chart).toMatchObject({complete:true,total:10,decisions:5,remainder:5});
 expect(chart.legend.map(row=>row.key)).toEqual(['PRESENT','CHECKIN_PENDING','ABSENT','CHECKED_OUT']);
 expect(chart.slices.reduce((n,row)=>n+row.value,0)).toBe(10);
 expect(chart.legend.find(row=>row.key==='ABSENT').value).toBe(1);
 expect(chart.slices.find(row=>row.key==='UNDECIDED').value).toBe(5);
});
it('uses all stored records as the monthly denominator and retains original trend data for exports',()=>{
 const counts={PRESENT:4,CHECKIN_PENDING:2,ABSENT:1,CHECKED_OUT:2,NOT_CHECKED_IN:3,rosterCount:5};
 const chart=attendanceChartData(counts,false);expect(chart).toMatchObject({total:12,decisions:9,remainder:3});
 expect(chart.slices.reduce((n,row)=>n+row.value,0)).toBe(12);
 expect(attendanceTrend([{day:'2026-10-25',status:'NOT_CHECKED_IN',count:3}])[0].NOT_CHECKED_IN).toBe(3);
});
it.each([
 {...summary,ABSENT:undefined},
 {...summary,NO_RECORD:undefined},
 {...summary,rosterCount:9},
 {...summary,ABSENT:-1},
])('refuses partial, inconsistent or invalid pie denominators',counts=>{
 const chart=attendanceChartData(counts,true);expect(chart.complete).toBe(false);expect(chart.slices).toEqual([]);expect(chart.total).toBeNull();
});
