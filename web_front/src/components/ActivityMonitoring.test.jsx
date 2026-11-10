import { activityLabel } from '../lib/ui-language';
import { act,cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import ActivityMonitoring from '../pages/ActivityMonitoring';
import Alerts from '../pages/Alerts';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
// Render the actual chart data accessibly; no synthetic observations are generated.
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,LineChart:({data})=><output aria-label="Activity chart data">{JSON.stringify(data)}</output>,Line:()=>null,CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null,Legend:()=>null}));
const policy={enabled:true,timezone:'Asia/Colombo',startMinute:480,endMinute:1020,weekdays:[1,2,3,4,5],quietPeriods:[],baselineDays:7,minBaselineDays:5,reductionPercent:40,sustainedMinutes:60,minCoveragePercent:80,minimumBaselineMADg:.005};
const base={child:{id:'child',name:'Registered child'},wearableId:'CG-WEARABLE-001',day:'2026-10-22',state:'NORMAL',reason:'NO_SUSTAINED_REDUCTION',currentScoreMg:85,baselineScoreMg:100,reductionPercent:15,coveragePercent:96,sensorStatus:'OK',lastSummaryAt:'2026-10-22T05:30:00Z',baselineDayCount:7,baselineAvailable:true,baselineDays:[{day:'2026-10-20',scoreMg:98},{day:'2026-10-21',scoreMg:102}],period:{startMinute:600,endMinute:660},todayIntervals:[{startMinute:600,scoreMg:85,baselineScoreMg:100,coveragePercent:96,complete:true}],history:[{day:'2026-10-21',scoreMg:90,validMinutes:350,observedMinutes:400,partial:true}],alert:null,policy};
let rows,role;
const mount=node=>render(<MemoryRouter>{node}</MemoryRouter>);
beforeEach(()=>{rows=[base];role='ADMIN';api.mockReset().mockImplementation(async(path,options)=>{
 if(path.includes('auth/me'))return {role,centerId:'center'};
 if(path.includes('pending-count'))return {count:0};
 if(path.includes('/activity/settings'))return options?.method==='PATCH'?JSON.parse(options.body):policy;
 return rows;
});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('loads real API scores, personal baseline and equivalent-period history chart',async()=>{
 mount(<ActivityMonitoring />);expect(await screen.findByText('Registered child')).toBeTruthy();expect(screen.getByText('85.00 mg MAD')).toBeTruthy();expect(screen.getByText('100.00 mg MAD')).toBeTruthy();expect(screen.getByLabelText('Activity chart data').textContent).toContain('"scoreMg":85');
 fireEvent.change(screen.getByLabelText('History view'),{target:{value:'baseline'}});expect(screen.getByLabelText('Activity chart data').textContent).toContain('2026-10-20');expect(screen.getByLabelText('Activity chart data').textContent).toContain('"scoreMg":98');
 fireEvent.change(screen.getByLabelText('History view'),{target:{value:'daily'}});expect(screen.getByLabelText('Activity chart data').textContent).toContain('"scoreMg":90');expect(screen.getByText('Observed attendance only; may be partial')).toBeTruthy();
});
it.each(['BASELINE_LEARNING','INSUFFICIENT_DATA','SENSOR_UNAVAILABLE','NOT_MONITORING'])('shows %s explicitly and does not display missing movement as zero',async state=>{
 rows=[{...base,state,currentScoreMg:null,baselineScoreMg:null,baselineAvailable:false,sensorStatus:state==='SENSOR_UNAVAILABLE'?'UNAVAILABLE':'OK',todayIntervals:[],baselineDays:[],history:[]}];mount(<ActivityMonitoring />);expect(await screen.findByText(activityLabel(state))).toBeTruthy();expect(screen.queryByText('0.00 mg MAD')).toBeNull();expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);expect(screen.getByText('No valid movement history for this view yet. Measurements and baseline will appear as real data becomes available.')).toBeTruthy();
});
it('displays a persisted LOW_ACTIVITY state without presenting a diagnosis',async()=>{
 rows=[{...base,state:'LOW_ACTIVITY',currentScoreMg:40,reductionPercent:60,alert:{status:'RECORDED',createdAt:base.lastSummaryAt}}];mount(<ActivityMonitoring />);expect(await screen.findByText('Low movement detected')).toBeTruthy();expect(screen.getByText('60.0%')).toBeTruthy();expect(screen.getByText(/RECORDED ·/)).toBeTruthy();expect(screen.getByText(/not a health diagnosis/)).toBeTruthy();
});
it('requires an admin to save policy and prevents duplicate submissions',async()=>{
 mount(<ActivityMonitoring />);fireEvent.click(await screen.findByText('Configure movement monitoring'));
 fireEvent.change(screen.getByLabelText('Required reduction (%)'),{target:{value:'45'}});
 let finish;const original=api.getMockImplementation();api.mockImplementation((path,options)=>options?.method==='PATCH'?new Promise(resolve=>{finish=()=>resolve(JSON.parse(options.body));}):original(path,options));
 fireEvent.click(screen.getByRole('button',{name:'Save activity settings'}));expect(screen.getByRole('button',{name:'Saving…'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Saving…'}));
 expect(api.mock.calls.filter(([,o])=>o?.method==='PATCH')).toHaveLength(1);expect(JSON.parse(api.mock.calls.find(([,o])=>o?.method==='PATCH')[1].body).reductionPercent).toBe(45);
 await act(async()=>finish());expect(await screen.findByText(/Activity policy saved/)).toBeTruthy();
});
it('keeps teacher settings read-only and shows authorization failures without data',async()=>{
 role='TEACHER';const view=mount(<ActivityMonitoring />);await screen.findByText('Registered child');expect(screen.queryByText('Configure movement monitoring')).toBeNull();view.unmount();
 api.mockRejectedValue(new Error('Sign in required'));mount(<ActivityMonitoring />);expect((await screen.findAllByRole('alert'))[0].textContent).toContain('Sign in required');expect(screen.queryByText('Registered child')).toBeNull();
});
it('shows LOW_ACTIVITY details in existing alerts without requiring a beacon',async()=>{
 api.mockImplementation(async path=>path.includes('/alerts')?{rows:[{id:'low-alert',kind:'LOW_ACTIVITY',category:'ACTIVITY',state:'RECORDED',activity:{currentScoreMg:40,baselineScoreMg:100,reductionPercent:60,coveragePercent:95,period:{day:'2026-10-22',startMinute:600,endMinute:660},timezone:'Asia/Colombo'},assessment:{verification:'MOVEMENT_OBSERVATION',note:'Stored movement comparison, not a medical diagnosis.'},event:{recordedChild:{id:'child',name:'Registered child'},device:{id:'device',hardwareId:'CG-WEARABLE-001'},zone:null,payload:{},receivedAt:base.lastSummaryAt}}],total:1,hasMore:false}:{count:0});
 mount(<Alerts />);fireEvent.click(await screen.findByRole('button',{name:/View details: LOW_ACTIVITY/}));const dialog=screen.getByRole('dialog');expect(dialog.textContent).toContain('personal baseline: 100.00 mg MAD');expect(dialog.textContent).toContain('reduction: 60.00%');expect(dialog.textContent).toContain('coverage: 95.00%');expect(within(dialog).getByText(/not a medical diagnosis/)).toBeTruthy();expect(dialog.textContent).toContain('10:00');expect(dialog.textContent).toContain('11:00');
});

it('shows raw sensor movement while comparable attendance monitoring is unavailable',async()=>{
 rows=[{...base,state:'NOT_MONITORING',currentScoreMg:null,latestMeasurement:{scoreMg:23.5,coveragePercent:96,eligible:false}}];
 mount(<ActivityMonitoring />);
 expect(await screen.findByText(/Latest movement reading: 23.50 mg MAD/)).toBeTruthy();
 expect(screen.getByText(/Attendance confirmed: No/)).toBeTruthy();
});

it('shows the seven calendar-day comparable series with real gaps and an amber advisory category',async()=>{
 rows=[{...base,state:'BELOW_BASELINE_CANDIDATE',requiredBaselineDays:4,baselineDayCount:4,baselineCalendar:[{day:'2026-10-21',scoreMg:100},{day:'2026-10-20',scoreMg:null}],comparisonWindows:[{baselineScoreMg:100}]}];
 mount(<ActivityMonitoring/>);await screen.findByText('Registered child');fireEvent.change(screen.getByLabelText('History view'),{target:{value:'baseline'}});
 const chart=JSON.parse(screen.getByLabelText('Activity chart data').textContent);expect(chart.find(r=>r.day==='2026-10-20').scoreMg).toBeNull();expect(chart.find(r=>r.day==='2026-10-21').scoreMg).toBe(100);
 expect(screen.queryByText(/recommended exercise/i)).toBeNull();
});
it('renders a new advisory as amber with an activity icon and actual measurement details',async()=>{
 api.mockImplementation(async path=>path.includes('/alerts')?{rows:[{id:'advisory',kind:'LOW_ACTIVITY_ADVISORY',category:'ACTIVITY',createdAt:base.lastSummaryAt,activity:{currentScoreMg:70,baselineScoreMg:100,reductionPercent:30,coveragePercent:90,baselineDayCount:4,period:{day:'2026-10-22',startMinute:600,endMinute:660}},assessment:{note:'Wearable movement advisory, not a diagnosis.'},event:{recordedChild:{name:'Registered child'},device:{hardwareId:'CG-WEARABLE-001'},payload:{},receivedAt:base.lastSummaryAt}}],total:1,hasMore:false}:{count:0});
 mount(<Alerts/>);const button=await screen.findByRole('button',{name:'View details: LOW_ACTIVITY_ADVISORY'});expect(button.className).toContain('al-tone--medium');fireEvent.click(button);expect(screen.getByRole('dialog').textContent).toContain('30.00%');
});
