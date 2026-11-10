import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ActivityDailyHistory from './ActivityDailyHistory';
import history from '../../../backend/tests/fixtures/activity-history.contract.json';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('recharts', () => ({
 ResponsiveContainer: ({ children }) => <div>{children}</div>,
 BarChart: ({ data, children }) => <div><output aria-label="Daily chart data">{JSON.stringify(data)}</output>{children}</div>,
 Bar: ({ children }) => <div>{children}</div>, Cell: ({ fill }) => <span data-testid="daily-bar" data-fill={fill}/>,
 CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
 ReferenceDot: () => null,
 ReferenceLine: ({ y }) => <span aria-label="Average line">{y}</span>,
}));
const activity = { child: history.child, dailyHistory: history, historyPreviewAvailable: true };
beforeEach(() => { api.mockReset().mockImplementation(async path=>({...activity,dailyHistory:path.includes('?source=sample')?history:{...history,provenance:'recorded',sourceLabel:'Recorded history'}})); });
afterEach(cleanup);
it('shows exact shared values, source and dated status without a live-alert claim', async () => {
 render(<ActivityDailyHistory activity={activity}/>);
 await screen.findByText('9.3 mg');
 expect(screen.getByText('9.3 mg')).toBeTruthy();
 expect(screen.getAllByText('6.2 mg').length).toBeGreaterThan(0);
 expect(screen.getByText('33% below average')).toBeTruthy();
 expect(screen.getByText(/Demonstration activity history · 2026-10-07/)).toBeTruthy();
 expect(screen.getByText(/Demo Child's movement on October 27 was approximately 33% below/)).toBeTruthy();
 expect(screen.getByText(/not a safety advisory/)).toBeTruthy();
 const rows = JSON.parse(screen.getByLabelText('Daily chart data').textContent);
 expect(rows).toEqual(history.periods['7'].days);
 expect(screen.getByLabelText('Average line').textContent).toBe('9.26');
 expect(screen.getAllByTestId('daily-bar').filter(e => e.dataset.fill === '#d84343')).toHaveLength(1);
 expect(screen.getAllByTestId('daily-bar')[3].dataset.fill).toBe('transparent');
 expect(rows[3].scoreMg).toBeNull();
});
it('switches to all 21 calendar positions and the backend-supplied selected-period mean', async () => {
 render(<ActivityDailyHistory activity={activity}/>);
 await screen.findByText('9.3 mg');
 fireEvent.click(screen.getByRole('button', { name: 'Last 21 Days' }));
 expect(JSON.parse(screen.getByLabelText('Daily chart data').textContent)).toEqual(history.periods['21'].days);
 expect(Number(screen.getByLabelText('Average line').textContent)).toBe(history.periods['21'].averageMg);
 fireEvent.click(screen.getByRole('button', { name: 'Last 7 Days' }));
 expect(JSON.parse(screen.getByLabelText('Daily chart data').textContent)).toHaveLength(7);
});
it('automatically loads the existing sample endpoint only after authorized availability, without source controls', async () => {
 render(<ActivityDailyHistory activity={activity}/>);
 await screen.findByText('9.3 mg');
 expect(api).toHaveBeenCalledWith('/api/v1/activity/children/fixture-demo-child?source=sample', expect.anything());
 expect(screen.queryByRole('button',{name:'Recorded history'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Sample history'})).toBeNull();
 expect(screen.queryByText('History source')).toBeNull();
 expect(screen.getAllByText(/Demonstration activity history/)).toHaveLength(1);
 expect(screen.getByRole('button',{name:'Last 7 Days'}).getAttribute('aria-pressed')).toBe('true');
});
it('uses recorded values unchanged when the server does not allow a preview', async()=>{
 const recorded={...history,provenance:'recorded',sourceLabel:'Recorded history'};
 api.mockResolvedValue({...activity,historyPreviewAvailable:false,dailyHistory:recorded});
 render(<ActivityDailyHistory activity={activity}/>);
 await screen.findByText(/Recorded history ?/);
 expect(api.mock.calls.some(([path])=>path.includes('source=sample'))).toBe(false);
 expect(JSON.parse(screen.getByLabelText('Daily chart data').textContent)).toEqual(recorded.periods['7'].days);
 expect(screen.queryByText(/Demonstration activity history/)).toBeNull();
});
it('handles missing history without fabricating zero movement or a low day', async () => {
 api.mockResolvedValue({ child: history.child });
 render(<ActivityDailyHistory activity={{ child: history.child }}/>);
 expect(await screen.findByText(/Daily activity history is unavailable/)).toBeTruthy();
 expect(screen.queryByText('0.0 mg')).toBeNull();
});
