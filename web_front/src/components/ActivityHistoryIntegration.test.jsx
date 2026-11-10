import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ActivityMonitoring from '../pages/ActivityMonitoring';
import history from '../../../backend/tests/fixtures/activity-history.contract.json';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('recharts', () => ({
 ResponsiveContainer: ({ children }) => <div>{children}</div>,
 BarChart: ({ data, children }) => <div><output aria-label="Daily data">{JSON.stringify(data)}</output>{children}</div>,
 Bar: ({ children }) => <div>{children}</div>, Cell: ({ fill }) => <span data-testid="bar-color" data-color={fill}/>,
 ReferenceLine: ({ y }) => <output aria-label="Daily average">{y}</output>, ReferenceDot: () => null,
 LineChart: ({ data }) => <output aria-label="Technical data">{JSON.stringify(data)}</output>,
 Line: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null,
}));

const policy = { enabled: false, timezone: 'Asia/Colombo', startMinute: 480, endMinute: 1020, weekdays: [1, 2, 3, 4, 5], quietPeriods: [], baselineDays: 7, minBaselineDays: 4, reductionPercent: 30, sustainedMinutes: 60, minCoveragePercent: 80, minimumBaselineMADg: .005 };
const empty = { ...history, provenance: 'recorded', sourceLabel: 'Recorded history', lastRecordedDay: null, percentDifference: null, status: 'learning', statusLabel: 'Still learning the activity pattern', explanation: 'We are still learning the child’s usual activity pattern.', periods: Object.fromEntries(['7', '21'].map(period => [period, { ...history.periods[period], validDayCount: 0, averageMg: null, days: history.periods[period].days.map(d => ({ ...d, scoreMg: null, quality: 'noData', classification: 'noData', statusLabel: 'No data' })) }])) };
const demoChild = { child: history.child, policy, dailyHistory: empty, historyPreviewAvailable: true, state: 'NOT_MONITORING', coveragePercent: 0, baselineDayCount: 0, baselineDays: [], todayIntervals: [{ startMinute: 600, scoreMg: 3.75 }], history: [], alert: null };
const other = { ...demoChild, child: { id: 'other-child', name: 'Other child' }, historyPreviewAvailable: false, dailyHistory: { ...empty, child: { id: 'other-child', name: 'Other child' } } };
let roster, fail, samplePending, previewEnabled;
beforeEach(() => {
 // Deliberately old roster shape: selected-child detail must supply availability.
 roster = [{ ...demoChild, dailyHistory: undefined, historyPreviewAvailable: undefined }, other];
 fail = false; samplePending = null; previewEnabled = true;
 api.mockReset().mockImplementation(async path => {
  if (path === '/api/v1/auth/me') return { role: 'ADMIN' };
  if (path.includes('/pending-count')) return { count: 0 };
  if (path === '/api/v1/activity/settings') return policy;
  if (path.startsWith('/api/v1/activity/children?')) return roster;
  if (path === `/api/v1/activity/children/${history.child.id}?source=sample`) return samplePending ? await samplePending : { ...demoChild, dailyHistory: history };
  if (path === `/api/v1/activity/children/${history.child.id}`) {
   if (fail) throw new Error('Activity temporarily unavailable');
   return {...demoChild,historyPreviewAvailable:previewEnabled};
  }
  if (path === '/api/v1/activity/children/other-child') return other;
  throw Error('Unexpected fixture path');
 });
});
afterEach(cleanup);
const mount = () => render(<MemoryRouter><ActivityMonitoring/></MemoryRouter>);

it('automatically mounts the configured demo while keeping genuine monitoring paused and source controls absent',async()=>{
 mount();await screen.findByText('9.3 mg',{}, {timeout:3000});
 expect(screen.queryByRole('group',{name:'History source'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Recorded history'})).toBeNull();expect(screen.queryByRole('button',{name:'Sample history'})).toBeNull();
 expect(screen.getByRole('region',{name:'Daily movement history'})).toBeTruthy();expect(screen.getByText(/Monitoring is disabled/)).toBeTruthy();
 expect(api.mock.calls.some(([path])=>path.endsWith('?source=sample'))).toBe(true);
 expect(screen.getByRole('button',{name:'Last 7 Days'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getAllByText(/Demonstration activity history/)).toHaveLength(1);
});

it('loads the existing sample endpoint and correct average, red day, gaps and periods independently of technical charts', async () => {
 mount();
 await screen.findByText('9.3 mg',{}, {timeout:3000});
 expect(await screen.findByText('9.3 mg')).toBeTruthy();
 expect(screen.getAllByText('6.2 mg').length).toBeGreaterThan(0);
 expect(screen.getByText('33% below average')).toBeTruthy();
 expect(screen.getByLabelText('Daily average').textContent).toBe('9.26');
 let days = JSON.parse(screen.getByLabelText('Daily data').textContent);
 expect(days).toEqual(history.periods['7'].days);
 expect(days.filter(d => d.classification === 'belowAverage').map(d => d.day)).toEqual(['2026-10-27']);
 expect(days.filter(d => d.classification === 'noData').map(d => d.day)).toEqual(['2026-10-24', '2026-10-25']);
 expect(screen.getAllByTestId('bar-color').filter(e => e.dataset.color === '#d84343')).toHaveLength(1);
 expect(screen.getAllByTestId('bar-color').filter(e => e.dataset.color === '#1683c7')).toHaveLength(4);
 fireEvent.change(screen.getByLabelText('History view'), { target: { value: 'baseline' } });
 expect(JSON.parse(screen.getByLabelText('Daily data').textContent)).toEqual(days);
 expect(screen.getByRole('button', { name: 'Last 7 Days' }).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button', { name: 'Last 21 Days' }));
 days = JSON.parse(screen.getByLabelText('Daily data').textContent);
 expect(days).toEqual(history.periods['21'].days);
 expect(Number(screen.getByLabelText('Daily average').textContent)).toBe(history.periods['21'].averageMg);
});

it('returns to genuine history when the server disables preview availability', async () => {
 mount();
 await screen.findByText('9.3 mg',{}, {timeout:3000});
 await screen.findByText('9.3 mg');
 const before = api.mock.calls.filter(([p]) => p === `/api/v1/activity/children/${history.child.id}`).length;
 previewEnabled=false;fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 await screen.findByText('Still learning the activity pattern');
 expect(screen.queryByText('9.3 mg')).toBeNull();
 expect(api.mock.calls.filter(([p]) => p === `/api/v1/activity/children/${history.child.id}`).length).toBeGreaterThan(before);
});

it('switching children clears sample values and controls before the next response', async () => {
 mount();
 await screen.findByText('9.3 mg',{}, {timeout:3000});
 await screen.findByText('9.3 mg');
 fireEvent.change(screen.getByLabelText('Child'), { target: { value: other.child.id } });
 expect(screen.queryByText('9.3 mg')).toBeNull();
 expect(screen.queryByRole('button', { name: 'Sample history' })).toBeNull();
 await waitFor(() => expect(api.mock.calls.some(([p]) => p === '/api/v1/activity/children/other-child')).toBe(true));
 expect(screen.getByRole('button', { name: 'Last 7 Days' }).getAttribute('aria-pressed')).toBe('true');
});

it('offers a clear retry after a selected-child API failure', async () => {
 fail = true;
 mount();
 const retry = await screen.findByRole('button', { name: 'Retry activity history' });
 expect(screen.getByRole('alert').textContent).toContain('Activity history could not be loaded');
 expect(screen.queryByText('9.3 mg')).toBeNull();
 fail = false;
 fireEvent.click(retry);
 await screen.findByText('9.3 mg',{}, {timeout:3000});
 expect(screen.queryByRole('button', { name: 'Retry activity history' })).toBeNull();
});

it('page Refresh reloads the selected sample without letting stale roster polling overwrite it', async () => {
 mount();
 await screen.findByText('9.3 mg',{}, {timeout:3000});
 await screen.findByText('9.3 mg');
 fireEvent.click(screen.getByRole('button',{name:'Last 21 Days'}));
 const chart=screen.getByLabelText('Daily data');
 const before = api.mock.calls.filter(([p]) => p.endsWith('?source=sample')).length;
 fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
 await waitFor(() => expect(api.mock.calls.filter(([p]) => p.endsWith('?source=sample')).length).toBeGreaterThan(before));
 expect(screen.getByText('9.3 mg')).toBeTruthy();
 expect(screen.getByLabelText('Daily data')).toBe(chart);
 expect(screen.getByRole('button',{name:'Last 21 Days'}).getAttribute('aria-pressed')).toBe('true');
});
it('does not replace a failed demonstration read with an empty recorded-history claim',async()=>{
 const original=api.getMockImplementation();
 api.mockImplementation(path=>path.endsWith('?source=sample')?Promise.reject(Error('History connection failed')):original(path));
 mount();const retry=await screen.findByRole('button',{name:'Retry activity history'});
 expect(screen.getByRole('alert').textContent).toContain('History connection failed');
 expect(screen.queryByText('9.3 mg')).toBeNull();expect(screen.queryByText('Still learning the activity pattern')).toBeNull();
 api.mockImplementation(original);fireEvent.click(retry);await screen.findByText('9.3 mg');
});

it('does not apply the configured demo to a different child with the same name',async()=>{
 roster[1]={...other,child:{...other.child,name:'Demo Child'}};
 mount();await screen.findByText('9.3 mg',{}, {timeout:3000});
 fireEvent.change(screen.getByLabelText('Child'),{target:{value:other.child.id}});
 await screen.findByText('Still learning the activity pattern');
 expect(screen.queryByText('9.3 mg')).toBeNull();expect(api.mock.calls.some(([path])=>path==='/api/v1/activity/children/other-child?source=sample')).toBe(false);
});
it('ignores a delayed old-child sample response after changing children',async()=>{
 let finish;samplePending=new Promise(resolve=>{finish=resolve;});mount();
 await waitFor(()=>expect(api.mock.calls.some(([path])=>path.endsWith('?source=sample'))).toBe(true));
 expect(screen.queryByText('9.3 mg')).toBeNull();
 fireEvent.change(screen.getByLabelText('Child'),{target:{value:other.child.id}});
 await act(async()=>finish({...demoChild,dailyHistory:history}));await screen.findByText('Still learning the activity pattern');
 expect(screen.queryByText('9.3 mg')).toBeNull();
 expect(api.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
});
