import {attendanceTime} from '../lib/attendance-report';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AttendanceOverview from './AttendanceOverview';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../components/Topbar',()=>({default:()=>null}));
vi.mock('../components/Footer',()=>({default:()=>null}));
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,BarChart:({children})=><div>{children}</div>,PieChart:({children})=><div>{children}</div>,Pie:()=>null,Cell:()=>null,Bar:()=>null,CartesianGrid:()=>null,Legend:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}));
let rows,visible;
const pending={id:'pending',attendanceId:'pending',child:{id:'child-1',name:'Pending child'},day:'2026-10-25',status:'CHECKIN_PENDING',arrival:{wearable:'Recorded belt',gate:'CG-GATE-01',receivedAt:'2026-10-25T05:00:00Z'},currentAssignment:{device:{hardwareId:'Current replacement'}},confirmation:null,previousConfirmations:[],resets:[],canConfirm:false,canReset:false};
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.parse('2026-10-25T08:00:00Z'));visible=true;vi.spyOn(document,'hidden','get').mockImplementation(()=>!visible);vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 rows=[pending,{...pending,id:'confirmed',attendanceId:'confirmed',child:{id:'child-2',name:'Present child'},status:'PRESENT',confirmation:{username:'Actual Teacher',roleAtConfirmation:'TEACHER',confirmedAt:'2026-10-25T05:01:00Z'}},{...pending,id:'missing',attendanceId:null,child:{id:'child-3',name:'Unrecorded child'},status:'NO_RECORD',arrival:null,currentAssignment:null}];
 api.mockReset().mockImplementation(async path=>{
  const q=new URLSearchParams(path.split('?')[1]);let data=rows.filter(r=>(!q.get('status')||q.get('status')===r.status)&&(!q.get('search')||r.child.name.toLowerCase().includes(q.get('search').toLowerCase()))&&(q.get('view')!=='history'||r.attendanceId));
  if(q.get('offset')==='25')data=[];
  return {rows:structuredClone(data),summary:{PRESENT:1,CHECKIN_PENDING:1,NOT_CHECKED_IN:0,CHECKED_OUT:0,ABSENT:0,NO_RECORD:1,rosterCount:3},days:[{day:'2026-10-25',status:'PRESENT',count:1}],hasMore:false,rosterNote:'Current center roster; missing records do not establish absence.'};
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
const tick=async ms=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
const mount=()=>render(<MemoryRouter><AttendanceOverview/></MemoryRouter>);
it('shows exact stored states, missing-record labels and real Teacher identity without an Admin approval button',async()=>{
 mount();await tick(250);const table=screen.getByRole('table',{name:'Center attendance records'});expect(within(table).getByText('Unrecorded child')).toBeTruthy();expect(within(within(table).getByRole('row',{name:/Unrecorded child/})).getByText('\u2014')).toBeTruthy();expect(within(table).getAllByText(attendanceTime('2026-10-25T05:01:00Z'))[0]).toBeTruthy();expect(screen.queryByRole('button',{name:'Approve Attendance'})).toBeNull();expect(screen.getByText(/A dash/)).toBeTruthy();expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);
});
it('uses center-local selected dates, status and search filters instead of fabricating past records',async()=>{
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-24'}});fireEvent.change(screen.getByLabelText('Attendance status'),{target:{value:'PRESENT'}});fireEvent.change(screen.getByLabelText('Search children'),{target:{value:'Present'}});await tick(250);
 expect(api.mock.calls.some(([p])=>{const q=new URLSearchParams(p.split('?')[1]);return q.get('day')==='2026-10-24'&&q.get('status')==='PRESENT'&&q.get('search')==='Present';})).toBe(true);
 const table=screen.getByRole('table',{name:'Center attendance records'});expect(within(table).getByText('Present child')).toBeTruthy();expect(within(table).queryByText('Unrecorded child')).toBeNull();
});
it('reads bounded monthly history with actual daily counts and retains the export controls',async()=>{
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance view'),{target:{value:'history'}});await tick(250);expect(screen.getByRole('heading',{name:/Daily Attendance.*October 2026/})).toBeTruthy();expect(screen.getByRole('button',{name:'Export daily counts'})).toBeTruthy();expect(screen.getByRole('button',{name:'Export current page'})).toBeTruthy();
 expect(api.mock.calls.some(([p])=>{const q=new URLSearchParams(p.split('?')[1]);return q.get('view')==='history'&&q.get('from')==='2026-10-01'&&q.get('to')==='2026-10-25';})).toBe(true);expect(screen.queryByRole('option',{name:'No Attendance Recorded'})).toBeNull();
});
it('keeps current assignment distinct from recorded arrival and displays preserved confirmation history',async()=>{
 rows[0].previousConfirmations=[{username:'Original actor',confirmedAt:'2026-10-24T05:00:00Z'}];rows[0].resets=[{id:'reset',username:'Actual Admin',createdAt:'2026-10-25T04:00:00Z'}];mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'View details for Pending child'}));const d=screen.getByRole('dialog');expect(within(d).getByText('Current replacement')).toBeTruthy();expect(within(d).getByText('Recorded belt')).toBeTruthy();expect(within(d).getByText(/Previous confirmation: Original actor/)).toBeTruthy();expect(within(d).getByText(/Development reset: Actual Admin/)).toBeTruthy();expect(within(d).queryByRole('button',{name:'Approve Attendance'})).toBeNull();fireEvent.click(within(d).getByRole('button',{name:'Close dialog'}));await tick(250);expect(screen.queryByRole('dialog')).toBeNull();
});
it('pauses hidden polling and background reads never call the activity or confirmation endpoint',async()=>{
 mount();await tick(250);const first=api.mock.calls.length;await tick(15000);expect(api.mock.calls.length).toBeGreaterThan(first);visible=false;act(()=>document.dispatchEvent(new Event('visibilitychange')));const count=api.mock.calls.length;await tick(60000);expect(api).toHaveBeenCalledTimes(count);expect(api.mock.calls.every(([p,o])=>p.startsWith('/api/v1/attendance?')&&!o.method)).toBe(true);
});
it('handles empty results and backend failure without reporting children absent',async()=>{
 rows=[];mount();await tick(250);expect(screen.getByText('No children match this attendance view.')).toBeTruthy();api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh attendance'}));await tick(0);expect(screen.getAllByRole('alert').some(n=>n.textContent.includes('Cannot reach ChildGuard API'))).toBe(true);expect(screen.getByRole('option',{name:'Absent'})).toBeTruthy();expect(within(screen.getByRole('table',{name:'Center attendance records'})).queryByRole('cell',{name:'Absent'})).toBeNull();
});
it('respects bounded history pagination using backend hasMore rather than invented rows',async()=>{
 const original=api.getMockImplementation();api.mockImplementation(async(p,o)=>({...await original(p,o),hasMore:!p.includes('offset=25')}));mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Next records'}));await tick(250);await tick(250);expect(api.mock.calls.some(([p])=>p.includes('offset=25')&&!p.includes('status=CHECKIN_PENDING'))).toBe(true);expect(screen.getByRole('button',{name:'Previous records'}).disabled).toBe(true);expect(screen.getByRole('button',{name:'Next records'}).disabled).toBe(false);
});

it('filters actual absent children, shows recorded count and remains read-only',async()=>{
 rows=[{...pending,id:'absent',status:'ABSENT',child:{id:'absent-child',name:'Absent child'},absenceHistory:[{id:'absence',type:'ABSENT',at:'2026-10-25T04:00:00Z',by:{id:'teacher',username:'Recording Teacher'}}]}];
 const original=api.getMockImplementation();api.mockImplementation(async(p,o)=>({...await original(p,o),absenceAvailable:true,summary:{PRESENT:0,CHECKIN_PENDING:0,NOT_CHECKED_IN:0,CHECKED_OUT:0,ABSENT:1,NO_RECORD:0,rosterCount:1}}));
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance status'),{target:{value:'ABSENT'}});await tick(250);expect(api.mock.calls.some(([p])=>p.includes('status=ABSENT'))).toBe(true);expect(screen.getByRole('cell',{name:'Absent'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Mark Absent'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'View details for Absent child'}));expect(screen.getByText(/Marked absent: Recording Teacher/)).toBeTruthy();
});

it('shows exactly five summary cards and only the four attendance-decision filters',async()=>{
 mount();await tick(250);
 const summary=screen.getByRole('region',{name:'Stored attendance summary'});
 const cards=within(summary).getAllByRole('article');
 expect(cards.map(card=>card.querySelector('.cg-stat-card__title').textContent)).toEqual(['Registered Children','Present','Pending','Absent','Checked Out']);
 expect(cards.map(card=>card.querySelector('.cg-stat-card__value').textContent)).toEqual(['3','1','1','0','0']);
 expect(within(screen.getByLabelText('Attendance status')).getAllByRole('option').map(option=>[option.value,option.textContent])).toEqual([['','All Children'],['PRESENT','Present'],['CHECKIN_PENDING','Pending'],['ABSENT','Absent'],['CHECKED_OUT','Checked Out']]);
 expect(screen.getByText('View daily attendance and past records.')).toBeTruthy();
 expect(screen.queryByText('How to use this page')).toBeNull();
});

it('keeps both undecided states in All Children with neutral cells and accurate record details',async()=>{
 rows.push({...pending,id:'not-checked',attendanceId:'not-checked',child:{id:'child-4',name:'Not arrived child'},status:'NOT_CHECKED_IN',arrival:null});
 const original=api.getMockImplementation();api.mockImplementation(async(p,o)=>({...await original(p,o),summary:{PRESENT:1,CHECKIN_PENDING:1,ABSENT:0,CHECKED_OUT:0,NOT_CHECKED_IN:1,NO_RECORD:1,rosterCount:4}}));
 mount();await tick(250);
 const table=screen.getByRole('table',{name:'Center attendance records'});
 for(const name of ['Not arrived child','Unrecorded child'])expect(within(within(table).getByRole('row',{name:new RegExp(name)})).getByText('—')).toBeTruthy();
 expect(within(table).getAllByRole('row')).toHaveLength(5);
 expect(within(table).queryByRole('cell',{name:'Absent'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'View details for Not arrived child'}));
 expect(within(screen.getByRole('dialog')).getByText(/Record status: NOT_CHECKED_IN/)).toBeTruthy();
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Close dialog'}));await tick(250);
 fireEvent.click(screen.getByRole('button',{name:'View details for Unrecorded child'}));
 expect(within(screen.getByRole('dialog')).getByText(/NO_RECORD \(no saved attendance record\)/)).toBeTruthy();
 expect(api.mock.calls.every(([,options])=>!options.method)).toBe(true);
});

it('exports original undecided and saved status codes without changing or dropping any current-page records',async()=>{
 rows.push({...pending,id:'not-checked',attendanceId:'not-checked',child:{id:'child-4',name:'Not arrived child'},status:'NOT_CHECKED_IN'});
 let blob;
 vi.stubGlobal('Blob',class{constructor(parts){this.parts=parts;}});
 vi.stubGlobal('URL',class extends URL{static createObjectURL(value){blob=value;return 'blob:attendance-test';}static revokeObjectURL(){}});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 try{
  mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Export current page'}));
  const csv=blob.parts[0];expect(csv.split('\r\n')).toHaveLength(5);
  for(const status of ['PRESENT','CHECKIN_PENDING','NOT_CHECKED_IN','NO_RECORD'])expect(csv).toContain(`"${status}"`);
  expect(csv).not.toContain('"ABSENT"');
  expect(csv).toContain('"child-4","Not arrived child","NOT_CHECKED_IN"');
  expect(api.mock.calls.every(([,options])=>!options.method)).toBe(true);
 }finally{vi.unstubAllGlobals();}
});

it('labels the selected-day center totals and preserves the date, search and status when refreshing both attendance sections',async()=>{
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-24'}});fireEvent.change(screen.getByLabelText('Search children'),{target:{value:'  pReSeNt  '}});fireEvent.change(screen.getByLabelText('Attendance status'),{target:{value:'PRESENT'}});await tick(250);
 expect(screen.getByRole('heading',{name:'Attendance for October 24, 2026'})).toBeTruthy();expect(screen.getByText('Center totals before search and status filters.')).toBeTruthy();
 expect(within(screen.getByRole('table',{name:'Center attendance records'})).getByText('Present child')).toBeTruthy();
 expect(screen.getByText(/Historical pending records for October 24, 2026/)).toBeTruthy();
 const calls=api.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'Refresh attendance'}));await tick(0);
 const queries=api.mock.calls.slice(calls).map(([p])=>new URLSearchParams(p.split('?')[1]));expect(queries.some(q=>q.get('search')==='pReSeNt'&&q.get('status')==='PRESENT'&&q.get('day')==='2026-10-24')).toBe(true);expect(queries.some(q=>q.get('status')==='CHECKIN_PENDING'&&q.get('day')==='2026-10-24')).toBe(true);
 expect(screen.getByLabelText('Attendance date').value).toBe('2026-10-24');expect(screen.getByLabelText('Search children').value).toBe('  pReSeNt  ');
});
it.each(['PRESENT','CHECKIN_PENDING','ABSENT','CHECKED_OUT'])('keeps the %s filter separate from missing records and resets pagination when searching',async status=>{
 rows=[...rows,{...pending,id:'absent',child:{id:'absent',name:'Absent child'},status:'ABSENT'},{...pending,id:'out',child:{id:'out',name:'Out child'},status:'CHECKED_OUT'}];
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance status'),{target:{value:status}});await tick(250);
 const table=screen.getByRole('table',{name:'Center attendance records'});expect(within(table).getAllByRole('row')).toHaveLength(2);expect(within(table).queryByText('Unrecorded child')).toBeNull();
 fireEvent.change(screen.getByLabelText('Search children'),{target:{value:'no matching name'}});await tick(250);expect(screen.getByText('No children match your search.')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Search children'),{target:{value:''}});fireEvent.change(screen.getByLabelText('Attendance status'),{target:{value:''}});await tick(250);expect(within(table).getByText('Unrecorded child')).toBeTruthy();
});
it('never lets a late historical response overwrite a newer selected date or export',async()=>{
 const original=api.getMockImplementation();let finish;
 api.mockImplementation((path,options)=>{
  const q=new URLSearchParams(path.split('?')[1]);
  if(q.get('day')==='2026-10-24'&&!q.get('status'))return new Promise(resolve=>{finish=resolve;});
  if(q.get('day')==='2026-10-23'&&!q.get('status'))return Promise.resolve({rows:[],summary:{rosterCount:3,PRESENT:0,CHECKIN_PENDING:0,ABSENT:0,CHECKED_OUT:0,NOT_CHECKED_IN:0,NO_RECORD:3},hasMore:false,days:[]});
  return original(path,options);
 });
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-24'}});await tick(250);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-23'}});await tick(250);
 await act(async()=>finish({rows:[{...pending,child:{id:'old',name:'Outdated response'}}],summary:{rosterCount:99},hasMore:false}));
 expect(screen.getByRole('heading',{name:'Attendance for October 23, 2026'})).toBeTruthy();expect(screen.queryByText('Outdated response')).toBeNull();expect(screen.getByRole('button',{name:'Export current page'}).disabled).toBe(true);
 expect(within(screen.getByRole('region',{name:'Stored attendance summary'})).getAllByRole('article').map(card=>card.querySelector('.cg-stat-card__value').textContent)).toEqual(['3','0','0','0','0']);
});
it('retains historical totals with a stale warning and disables downloads after a refresh fails',async()=>{
 mount();await tick(250);api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh attendance'}));await tick(0);
 expect(screen.getByRole('region',{name:'Stored attendance summary'})).toBeTruthy();expect(screen.getAllByRole('alert').some(node=>node.textContent.includes('Showing last received data.'))).toBe(true);expect(screen.getByRole('button',{name:'Download Daily Report'}).disabled).toBe(true);
});
it('downloads all matching report pages while current-page export remains separate',async()=>{
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>{
  const q=new URLSearchParams(path.split('?')[1]);
  if(q.get('limit')==='50')return Promise.resolve({rows:Array.from({length:q.get('offset')==='0'?50:1},(_,i)=>({...pending,id:`report-${+q.get('offset')+i}`,child:{id:`report-child-${+q.get('offset')+i}`,name:`Report Child ${+q.get('offset')+i}`}})),hasMore:q.get('offset')==='0'});
  return original(path,options);
 });
 let blob,filename;vi.stubGlobal('Blob',class{constructor(parts){this.parts=parts;}});vi.stubGlobal('URL',class extends URL{static createObjectURL(value){blob=value;return 'blob:test';}static revokeObjectURL(){}});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){filename=this.download;});
 try{
  mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Download Daily Report'}));await tick(0);
  expect(blob.parts[0].split('\r\n')).toHaveLength(52);expect(filename).toBe('childguard-attendance-2026-10-25-all-matching.csv');expect(blob.parts[0]).toContain('Report Child 50');expect(screen.getByText('Attendance report download started.')).toBeTruthy();
  expect(api.mock.calls.filter(([p])=>p.includes('limit=50')).map(([p])=>new URLSearchParams(p.split('?')[1]).get('offset'))).toEqual(['0','50']);
 }finally{vi.unstubAllGlobals();}
});
it('keeps a failed full report distinct from a successful empty report and prevents duplicate submissions',async()=>{
 const original=api.getMockImplementation();let reject;api.mockImplementation((path,options)=>path.includes('limit=50')?new Promise((resolve,fail)=>{reject=fail;}):original(path,options));
 mount();await tick(250);const button=screen.getByRole('button',{name:'Download Daily Report'});fireEvent.click(button);fireEvent.click(button);await tick(0);expect(api.mock.calls.filter(([p])=>p.includes('limit=50'))).toHaveLength(1);expect(screen.getByRole('button',{name:'Preparing report...'}).disabled).toBe(true);
 await act(async()=>reject(Error('offline')));expect(screen.getByText('Unable to download the complete report. Refresh and try again.')).toBeTruthy();expect(screen.queryByText('Attendance report download started.')).toBeNull();
});
it('requests the selected leap-year month for complete monthly reports without exporting today instead',async()=>{
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>path.includes('limit=50')?Promise.resolve({rows:[],hasMore:false}):original(path,options));
 mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance view'),{target:{value:'history'}});fireEvent.change(screen.getByLabelText('History month'),{target:{value:'2024-02'}});await tick(250);
 fireEvent.click(screen.getByRole('button',{name:'Download Monthly Report'}));await tick(0);const q=new URLSearchParams(api.mock.calls.find(([p])=>p.includes('limit=50'))[0].split('?')[1]);expect(q.get('from')).toBe('2024-02-01');expect(q.get('to')).toBe('2024-02-29');expect(screen.getByText('No attendance records match this report.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Export loaded records'})).toBeNull();
});
it('cancels an in-flight report when the selected date changes and never downloads the old scope',async()=>{
 const original=api.getMockImplementation();let finish;
 api.mockImplementation((path,options)=>path.includes('limit=50')?new Promise(resolve=>{finish=resolve;}):original(path,options));
 const create=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL(value){create(value);return 'blob:test';}static revokeObjectURL(){}});
 try{
  mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Download Daily Report'}));await tick(0);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-24'}});await tick(250);
  await act(async()=>finish({rows:[pending],hasMore:false}));expect(create).not.toHaveBeenCalled();expect(screen.queryByText('Attendance report download started.')).toBeNull();expect(screen.getByRole('button',{name:'Download Daily Report'}).disabled).toBe(false);
 }finally{vi.unstubAllGlobals();}
});
it('ends a hung report with a clear timeout instead of an endless loading state',async()=>{
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>path.includes('limit=50')?new Promise(()=>{}):original(path,options));
 mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Download Daily Report'}));await tick(60000);
 expect(screen.getByText('The report took too long. Narrow your search and try again.')).toBeTruthy();expect(screen.getByRole('button',{name:'Download Daily Report'}).disabled).toBe(false);
});
it('exports the chosen historical date and actual checkout evidence with a matching filename',async()=>{
 const original=api.getMockImplementation();api.mockImplementation(async(path,options)=>{
  const result=await original(path,options),q=new URLSearchParams(path.split('?')[1]);
  if(q.get('day')==='2026-10-24'&&!q.get('status'))return {...result,rows:[{...pending,day:'2026-10-24',status:'CHECKED_OUT',confirmation:{username:'Original Teacher',confirmedAt:'2026-10-24T04:00:00Z'},checkout:{at:'2026-10-24T09:00:00Z',by:{username:'Departure Teacher'}}}]};
  return result;
 });
 let blob,filename;vi.stubGlobal('Blob',class{constructor(parts){this.parts=parts;}});vi.stubGlobal('URL',class extends URL{static createObjectURL(value){blob=value;return 'blob:test';}static revokeObjectURL(){}});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){filename=this.download;});
 try{
  mount();await tick(250);fireEvent.change(screen.getByLabelText('Attendance date'),{target:{value:'2026-10-24'}});await tick(250);fireEvent.click(screen.getByRole('button',{name:'Export current page'}));
  expect(filename).toBe('childguard-attendance-2026-10-24-page-1.csv');expect(blob.parts[0]).toContain('"2026-10-24","child-1","Pending child","CHECKED_OUT"');expect(blob.parts[0]).toContain('2026-10-24T04:00:00Z');expect(blob.parts[0]).toContain('2026-10-24T09:00:00Z');
  fireEvent.click(screen.getByRole('button',{name:'View details for Pending child'}));const d=screen.getByRole('dialog');expect(within(d).getByText(/October 24, 2026/)).toBeTruthy();expect(within(d).getByText('Departure Teacher')).toBeTruthy();expect(within(d).getByText('Original Teacher (historical role unavailable)')).toBeTruthy();
 }finally{vi.unstubAllGlobals();}
});
it('searches the complete server-side dataset beyond page one and clearing search restores the roster',async()=>{
 const roster=Array.from({length:64},(_,i)=>({...pending,id:`roster-${i}`,attendanceId:null,child:{id:`child-${i}`,name:i===40?'Demo Child Search':`Student ${i}`},status:'NO_RECORD',arrival:null}));
 api.mockImplementation(async path=>{
  const q=new URLSearchParams(path.split('?')[1]),matches=roster.filter(r=>(!q.get('search')||r.child.name.toLowerCase().includes(q.get('search').toLowerCase()))&&(!q.get('status')||r.status===q.get('status'))),offset=+q.get('offset'),limit=+q.get('limit');
  return {rows:matches.slice(offset,offset+limit),hasMore:offset+limit<matches.length,summary:{rosterCount:64,PRESENT:0,CHECKIN_PENDING:0,ABSENT:0,CHECKED_OUT:0,NOT_CHECKED_IN:0,NO_RECORD:64},days:[]};
 });
 mount();await tick(250);let table=screen.getByRole('table',{name:'Center attendance records'});expect(within(table).queryByText('Demo Child Search')).toBeNull();
 for(const text of ['Demo Child Search','dEmO','  search  ']){
  fireEvent.change(screen.getByLabelText('Search children'),{target:{value:text}});await tick(250);expect(within(table).getByText('Demo Child Search')).toBeTruthy();expect(within(table).getAllByRole('row')).toHaveLength(2);
 }
 fireEvent.change(screen.getByLabelText('Search children'),{target:{value:''}});await tick(250);expect(within(table).getAllByRole('row')).toHaveLength(26);fireEvent.click(screen.getByRole('button',{name:'Next records'}));await tick(250);expect(within(table).getByText('Demo Child Search')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Search children'),{target:{value:'Demo Child'}});await tick(250);expect(screen.getByRole('button',{name:'Previous records'}).disabled).toBe(true);
});

it('renders real RFID source and reader in the existing Present table and details',async()=>{
 rows[1].confirmation={method:'RFID_CARD',confirmedAt:'2026-10-25T05:01:00Z',reader:{hardwareId:'SYNTHETIC-RFID'}};
 mount();await tick(250);expect(screen.getByRole('columnheader',{name:'Confirmation source'})).toBeTruthy();expect(screen.getByText('RFID Card / SYNTHETIC-RFID')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'View details for Present child'}));expect(within(screen.getByRole('dialog')).getByText('RFID Card / SYNTHETIC-RFID')).toBeTruthy();
});
