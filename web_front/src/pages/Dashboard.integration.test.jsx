import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { api } from '../lib/api';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import { dashboardAttendance, dashboardDaily } from '../lib/dashboard-attendance';

const events=vi.hoisted(()=>({listener:null}));
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
vi.mock('../lib/monitoring-events',()=>({monitoringEvents:{subscribe:fn=>{events.listener=fn;return()=>{events.listener=null;};}}}));
vi.mock('../components/Topbar',()=>({default:()=>null}));
vi.mock('../components/Footer',()=>({default:()=>null}));
vi.mock('../components/LocationMap',()=>({default:({locations,label})=><output aria-label={label||'Dashboard map records'}>{JSON.stringify(locations)}</output>}));
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,BarChart:({data})=><output aria-label="Monthly chart data">{JSON.stringify(data)}</output>,PieChart:({children})=><div>{children}</div>,Pie:({data})=><output aria-label="Daily chart data">{JSON.stringify(data)}</output>,Bar:()=>null,Cell:()=>null,CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null,Legend:()=>null}));
let summary;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
  vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
  summary={PRESENT:1,NOT_CHECKED_IN:0,CHECKIN_PENDING:1,CHECKED_OUT:1,ABSENT:0,NO_RECORD:1,rosterCount:4};
  useMonitoringRead.mockImplementation(path=>({data:path.includes('attendance?')?{summary}:{alerts:2},loading:false,error:''}));
  api.mockImplementation(async path=>{const month=new URLSearchParams(path.split('?')[1]).get('month');return {counts:{children:4},children:[{id:'a',name:'Child A'},{id:'b',name:'Child B'}],attendance:[{childId:'a',date:`${month}-25`,status:'Present'},{childId:'b',date:`${month}-25`,status:'NOT_CHECKED_IN'}]};});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
const tick=async()=>act(async()=>{await vi.advanceTimersByTimeAsync(10);});
const mount=()=>render(<MemoryRouter><Dashboard/></MemoryRouter>);

it('retains raw monthly NOT_CHECKED_IN counts without promoting them as an ordinary filter',async()=>{
  mount();await tick();const data=JSON.parse(screen.getByLabelText('Monthly chart data').textContent);
  expect(data.find(row=>row.date==='2026-10-25')).toMatchObject({present:1,notCheckedIn:1});
  expect(screen.getByRole('button',{name:'Absent'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Not Checked In Yet'})).toBeNull();
});
it('reads the complete daily roster summary independently of the selected history month',async()=>{
  mount();await tick();fireEvent.change(screen.getByLabelText('Month'),{target:{value:'2026-09'}});await tick();
  const values=JSON.parse(screen.getByLabelText('Daily chart data').textContent);
  expect(values.map(row=>[row.name,row.value])).toContainEqual(['Pending',1]);
  expect(values.map(row=>[row.name,row.value])).toContainEqual(['No attendance decision',1]);
  expect(screen.getByText('25%')).toBeTruthy();
  expect(useMonitoringRead.mock.calls.some(([path])=>path.includes('day=2026-10-25&limit=1'))).toBe(true);
  expect(api.mock.calls.some(([path])=>path.includes('month=2026-09'))).toBe(true);
});
it('invalidates the overview after committed attendance notifications without a write request',async()=>{
  mount();await tick();const before=api.mock.calls.length;
  act(()=>events.listener({topics:['attendance']}));await tick();
  expect(api.mock.calls.length).toBeGreaterThan(before);
  expect(api.mock.calls.every(([path,options])=>path.startsWith('/api/v1/admin/overview?')&&!options.method)).toBe(true);
});
it('does not turn incomplete daily summary responses into fabricated zero counts',()=>{
  expect(dashboardDaily({PRESENT:1,rosterCount:4})).toBeNull();
  expect(dashboardAttendance([{status:'CHECKIN_PENDING'},{status:'CHECKED_OUT'},{status:'ABSENT'}])).toMatchObject({present:0,pending:1,checkedOut:1,notCheckedIn:0,absent:1,total:3});
});
it('connects the saved geofence map to the existing authorized API without inventing child GPS',async()=>{
  useMonitoringRead.mockImplementation(path=>({data:path==='/api/v1/safe-zones'?{configurationAvailable:true,zones:[{id:'zone',name:'Recorded boundary',latitude:6.9,longitude:79.8,radiusM:75,active:true}]}:path.includes('attendance?')?{summary}:{alerts:2},loading:false,error:''}));
  mount();await tick();
  const maps=screen.getAllByRole('status').filter(node=>node.tagName==='OUTPUT').map(node=>node.textContent).join(' ');
  expect(maps).toContain('Recorded boundary');expect(maps).toContain('79.8');
  expect(maps).not.toContain('"type":"child"');
});

it('shows real absent counts provided by the daily attendance API',async()=>{summary.ABSENT=2;summary.rosterCount=6;mount();await tick();const values=JSON.parse(screen.getByLabelText('Daily chart data').textContent);expect(values.map(r=>[r.name,r.value])).toContainEqual(['Absent',2]);});

it('keeps registered children as the present-rate denominator and uses a neutral remainder',async()=>{
 mount();await tick();const values=JSON.parse(screen.getByLabelText('Daily chart data').textContent);
 expect(values.reduce((n,row)=>n+row.value,0)).toBe(4);
 expect(values.filter(row=>row.key!=='UNDECIDED').map(row=>row.name)).toEqual(['Present','Pending','Absent','Checked Out']);
 expect(values.find(row=>row.key==='ABSENT').value).toBe(0);expect(screen.getByText('25%')).toBeTruthy();
 expect(screen.queryByText('No Attendance Recorded')).toBeNull();expect(screen.queryByText('Not Checked In Yet')).toBeNull();
});
it('shows unavailable rather than inventing an absent count when an older response omits ABSENT',async()=>{
 delete summary.ABSENT;mount();await tick();expect(screen.queryByLabelText('Daily chart data')).toBeNull();
 expect(screen.getByText('Daily attendance is unavailable.')).toBeTruthy();expect(screen.getByText('25%')).toBeTruthy();
});

it('opens the authorized child GPS picker rather than treating profile coordinates as GPS',async()=>{
 mount();await tick();fireEvent.click(screen.getByRole('button',{name:'Children',exact:true}));
 expect(screen.getByRole('heading',{name:'Child Location'})).toBeTruthy();
 expect(useMonitoringRead.mock.calls.some(([path])=>path.startsWith('/api/v1/admin/children?'))).toBe(true);
 expect(useMonitoringRead.mock.calls.some(([path])=>path.startsWith('/api/v1/mobile'))).toBe(false);
});
