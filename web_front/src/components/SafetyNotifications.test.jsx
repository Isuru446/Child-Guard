import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import SafetyNotifications from './SafetyNotifications';
import {createDangerNotifications} from '../lib/danger-notifications';
import {useMonitoringRead} from '../lib/use-monitoring-read';
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const row=id=>({id,kind:'DANGER_ZONE_NEAR',createdAt:'2026-10-26T10:00:00Z',event:{recordedChild:{name:'Synthetic child'},device:{hardwareId:'SYNTHETIC-WEARABLE'},zone:{name:'Synthetic danger beacon',location:'Synthetic area'}}});
it('shows a committed-record notice after refresh, links history, and never repeats the same ID',async()=>{
 let receive;useMonitoringRead.mockImplementation((path,options)=>{receive=options.onData;return {};});
 const tree=()=> <MemoryRouter><SafetyNotifications><p>Existing dashboard</p></SafetyNotifications></MemoryRouter>;
 render(tree());act(()=>receive({rows:[]}));expect(screen.queryByRole('alert')).toBeNull();
 act(()=>receive({rows:[row('persisted-alert')]}));
 expect((await screen.findByRole('alert')).textContent).toContain('Synthetic child');expect(screen.getByRole('alert').textContent).toContain('Synthetic danger beacon');
 expect(screen.getByRole('link',{name:'View alert history'}).getAttribute('href')).toBe('/alerts');
 fireEvent.click(screen.getByText('Dismiss notification'));expect(screen.queryByRole('alert')).toBeNull();
 act(()=>receive({rows:[row('persisted-alert')]}));expect(screen.queryByRole('alert')).toBeNull();
});
it('initial history and signal-loss diagnostics are never presented as new danger entry',()=>{
 const tracker=createDangerNotifications();expect(tracker.read([row('old')])).toEqual([]);
 expect(tracker.read([row('old'),{id:'signal',kind:'BEACON_SIGNAL_LOST'}])).toEqual([]);
 expect(tracker.read([row('new'),row('old')]).map(r=>r.id)).toEqual(['new']);
 expect(tracker.read([row('new'),row('old')])).toEqual([]);
});
