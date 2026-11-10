import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecordedAttendanceCalendar from './RecordedAttendanceCalendar';
import ChildProfileEvidence from './ChildProfileEvidence';
import AttendanceExplorer from './AttendanceExplorer';
import RecordedLocationPreview from './RecordedLocationPreview';
import { api } from '../lib/api';

vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./LocationMap',()=>({default:({locations,label})=><output aria-label={label}>{JSON.stringify(locations)}</output>}));
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,BarChart:({data,children})=><><output aria-label="Child chart source">{JSON.stringify(data)}</output>{children}</>,Bar:({dataKey,name})=><span aria-label={`Child chart series ${dataKey}`}>{name}</span>,CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});
const child={id:'child-authorized',name:'Authorized Child',groupName:'Blue',guardians:[],assignments:[]};
const record={id:'record',child,day:'2026-10-02',status:'PRESENT'};
const profile=()=>render(<MemoryRouter><ChildProfileEvidence child={child}/></MemoryRouter>);

it('restores a full month calendar without inventing attendance for missing dates',()=>{
  render(<RecordedAttendanceCalendar month="2026-10" childId={child.id} rows={[record]}/>);
  expect(screen.getByLabelText('2026-10-02: Present')).toBeTruthy();
  expect(screen.getByLabelText('2026-10-03: No record in this response')).toBeTruthy();
  expect(screen.queryByText('ABSENT')).toBeNull();
});
it('keeps a different child with the same name out of the selected calendar',()=>{
  render(<RecordedAttendanceCalendar month="2026-10" childId={child.id} rows={[{...record,child:{...child,id:'other-child'}}]}/>);
  expect(screen.getByLabelText('2026-10-02: No record in this response')).toBeTruthy();
});
it('keeps saved not-checked-in records neutral while allowing their original details to open',()=>{
 const open=vi.fn(),raw={...record,status:'NOT_CHECKED_IN'};
 render(<RecordedAttendanceCalendar month="2026-10" childId={child.id} rows={[raw]} onSelect={open}/>);
 const day=screen.getByRole('button',{name:'2026-10-02: Not Checked In Yet'});
 expect(day.className).toContain('cm-calendar-day--unrecorded');
 expect(day.className).not.toContain('cm-calendar-day--pending');
 fireEvent.click(day);expect(open).toHaveBeenCalledWith(raw);
});
it('preserves pending evidence as pending, never as Teacher confirmed',()=>{
  render(<RecordedAttendanceCalendar month="2026-10" childId={child.id} rows={[{...record,status:'CHECKIN_PENDING'}]}/>);
  expect(screen.getByLabelText('2026-10-02: Pending')).toBeTruthy();
  expect(screen.queryByText('Present')).toBeNull();
});
it('displays actual center counts and delegates child record opening without a mutation',()=>{
  const open=vi.fn();render(<AttendanceExplorer rows={[record]} days={[{day:record.day,status:'PRESENT',count:1}]} month="2026-10" view="history" onDetails={open}/>);
  expect(screen.getByLabelText('2026-10-02: Present: 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Authorized Child/}));expect(open).toHaveBeenCalledWith(record);
  fireEvent.change(screen.getByLabelText('Calendar records'),{target:{value:child.id}});
  fireEvent.click(screen.getByRole('button',{name:'2026-10-02: Present'}));expect(open).toHaveBeenCalledTimes(2);
});
it('qualifies a daily calendar and an incomplete child-history page truthfully',()=>{
  render(<AttendanceExplorer rows={[record]} days={[]} month="2026-10" view="roster" day="2026-10-02" hasMore/>);
  expect(screen.getByText(/Showing 2026-10-02. Select Monthly History for past dates/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Calendar records'),{target:{value:child.id}});
  expect(screen.getByText(/additional pages may contain more history/)).toBeTruthy();
});
it('shows original-style profile sections but fetches nothing until history is requested',()=>{
  profile();expect(screen.getByRole('heading',{name:'Location Preview'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Attendance Calendar'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'View Location'})).toBeTruthy();expect(screen.queryByText('No location saved in this child profile')).toBeNull();expect(api).not.toHaveBeenCalled();
});
it('loads bounded real history and filters by child identity rather than matching names',async()=>{
  api.mockResolvedValue({rows:[record,{...record,id:'foreign',day:'2026-10-03',child:{...child,id:'foreign'}}],hasMore:true});
  profile();fireEvent.change(screen.getByLabelText('Child history month'),{target:{value:'2026-10'}});
  fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  await screen.findByRole('button',{name:'Load more child history'});
  expect(screen.getByLabelText('2026-10-02: Present')).toBeTruthy();
  expect(screen.getByLabelText('2026-10-03: No record in this response')).toBeTruthy();
  const path=api.mock.calls[0][0],q=new URLSearchParams(path.split('?')[1]);
  expect(q.get('view')).toBe('history');expect(q.get('childId')).toBe(child.id);expect(q.has('search')).toBe(false);expect(q.get('limit')).toBe('50');
  expect(q.get('from')).toBe('2026-10-01');expect(api.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);expect(api.mock.calls[0][1].method).toBeUndefined();
  fireEvent.click(screen.getByRole('button',{name:'Load more child history'}));
  await screen.findByRole('button',{name:'Load monthly records'});
  expect(new URLSearchParams(api.mock.calls[1][0].split('?')[1]).get('offset')).toBe('50');
});
it('shows failed history reads as errors instead of fabricated success',async()=>{
  api.mockRejectedValue(new Error('History unavailable'));profile();fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  expect((await screen.findByRole('alert')).textContent).toBe('History unavailable');
  expect(screen.getByText(/Choose Load monthly records/)).toBeTruthy();
});
it('plots real child absences and keeps saved undecided history without promoting it as a chart series',async()=>{
 api.mockResolvedValue({rows:[{...record,status:'ABSENT'},{...record,id:'undecided',day:'2026-10-03',status:'NOT_CHECKED_IN'}],hasMore:false});
 profile();fireEvent.change(screen.getByLabelText('Child history month'),{target:{value:'2026-10'}});
 fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
 expect(await screen.findByLabelText('Child chart series ABSENT')).toBeTruthy();
 expect(screen.queryByLabelText('Child chart series NOT_CHECKED_IN')).toBeNull();
 expect(screen.queryByLabelText('Child chart series NO_RECORD')).toBeNull();
 const data=JSON.parse(screen.getByLabelText('Child chart source').textContent);
 expect(data.find(row=>row.day==='2026-10-02').ABSENT).toBe(1);
 expect(data.find(row=>row.day==='2026-10-03').NOT_CHECKED_IN).toBe(1);
});
it('does not create a map from missing coordinates or substitute zero',()=>{
  const {container}=render(<RecordedLocationPreview latitude={null} longitude={null}/>);
  expect(screen.getByText('No valid coordinates supplied')).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(container.querySelector('output')).toBeNull();
});
it('opens the original map only on request with the supplied valid coordinates',()=>{
  render(<RecordedLocationPreview latitude={0} longitude={0} name="Recorded point" label="Evidence map"/>);
  expect(screen.queryByLabelText('Evidence map')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Preview recorded location'}));
  expect(JSON.parse(screen.getByLabelText('Evidence map').textContent)[0]).toMatchObject({lat:0,lng:0,name:'Recorded point'});
  fireEvent.click(screen.getByRole('button',{name:'Hide map'}));expect(screen.queryByLabelText('Evidence map')).toBeNull();
});
it('keeps empty attendance and report sections available without fake child rows',()=>{
  render(<AttendanceExplorer rows={[]} days={[]} month="2026-10" view="history" reportDisabled/>);
  expect(screen.getByRole('heading',{name:'Monthly Report'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Download Monthly Report'}).disabled).toBe(true);
  expect(within(screen.getByRole('combobox')).getAllByRole('option')).toHaveLength(1);
});

it('cancels an old child read and never renders its late response under another profile',async()=>{
  let finish;api.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {rerender}=profile();fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  const signal=api.mock.calls[0][1].signal;
  rerender(<MemoryRouter><ChildProfileEvidence child={{...child,id:'other-child',name:'Other child'}}/></MemoryRouter>);
  expect(signal.aborted).toBe(true);
  await act(async()=>finish({rows:[record],hasMore:false}));
  expect(screen.getByRole('heading',{name:'Other child'})).toBeTruthy();
  expect(screen.queryByLabelText('Child chart source')).toBeNull();expect(screen.getByRole('button',{name:'Load monthly records'}).disabled).toBe(false);
});
it('discards a late response when the selected history month changes',async()=>{
  let finish;api.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  profile();fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  fireEvent.change(screen.getByLabelText('Child history month'),{target:{value:'2026-09'}});
  expect(api.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async()=>finish({rows:[record],hasMore:true}));
  expect(screen.queryByRole('button',{name:'Load more child history'})).toBeNull();expect(screen.queryByLabelText('Child chart source')).toBeNull();
});
it('bounds a stalled history read and allows a deliberate retry after timeout',async()=>{
  vi.useFakeTimers();api.mockImplementation((_,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  profile();fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(screen.getByRole('alert').textContent).toContain('timed out');
  expect(screen.getByRole('button',{name:'Load monthly records'}).disabled).toBe(false);
});
