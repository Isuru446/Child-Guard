import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import BusTransportMonitoring from './BusTransportMonitoring';
import {api} from '../lib/api';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {monitoringTopics} from '../lib/monitoring-events';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
let read;
beforeEach(()=>{
 read={data:{enabled:true,busId:'SYNTHETIC-BUS',beaconId:'SYNTHETIC-BUS-BEACON',session:null,rows:[{child:{id:'child-one',name:'Demo child'},wearableId:'DEMO-WEARABLE',proximity:'NEAR',rssi:-48.25,connection:'RECENT_REPORT',state:'WAITING_FOR_BOARDING',lastReportAt:'2026-10-29T09:00:00Z',lastHealthyScanAt:'2026-10-29T09:00:00Z'}]},loading:false,error:'',stale:false,refresh:vi.fn()};
 useMonitoringRead.mockImplementation(()=>read);api.mockReset().mockResolvedValue({epoch:'committed-epoch'});vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows live signal and temporary limitations without bus registration controls',()=>{
 render(<BusTransportMonitoring/>);expect(screen.getByText('Bus BLE Monitoring')).toBeTruthy();expect(screen.getByText(/-48\.3 dBm/)).toBeTruthy();expect(screen.getByText('Demo child')).toBeTruthy();expect(screen.getByText(/Backend restart clears/)).toBeTruthy();expect(screen.queryByRole('button',{name:/add.*beacon|register.*bus/i})).toBeNull();expect(monitoringTopics('/api/v1/transport')).toEqual(['transport']);
});
it('activates only after confirmation with the existing authenticated API, and prevents duplicate submissions',async()=>{
 let finish;api.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<BusTransportMonitoring/>);
 const button=screen.getByRole('button',{name:'End Daycare Session'});fireEvent.click(button);fireEvent.click(button);
 expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('/api/v1/transport/end-daycare',{method:'POST',body:JSON.stringify({confirm:true})});expect(screen.getByRole('button',{name:'Activating…'}).disabled).toBe(true);
 await act(async()=>finish({epoch:'committed'}));expect(read.refresh).toHaveBeenCalledTimes(1);
});
it('cancel makes no request; active or disabled sessions cannot activate',()=>{
 window.confirm.mockReturnValue(false);const mounted=render(<BusTransportMonitoring/>);fireEvent.click(screen.getByRole('button',{name:'End Daycare Session'}));expect(api).not.toHaveBeenCalled();
 read.data.session={activatedAt:'2026-10-29T09:00:00Z'};mounted.rerender(<BusTransportMonitoring/>);expect(screen.getByRole('button',{name:'End Daycare Session'}).disabled).toBe(true);
 read.data.session=null;read.data.enabled=false;mounted.rerender(<BusTransportMonitoring/>);expect(screen.getByRole('button',{name:'End Daycare Session'}).disabled).toBe(true);
});
it('stale/error readings never show current RSSI or a fresh onboard claim',()=>{
 read.stale=true;read.error='Connection unavailable';read.data.rows[0].state='ON_BOARD';render(<BusTransportMonitoring/>);expect(screen.queryByText(/-48\.3 dBm/)).toBeNull();expect(screen.getByText(/No current RSSI/)).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('Connection unavailable');expect(screen.getByText('Connection lost / location unconfirmed')).toBeTruthy();
});
it('updates state without replacing the existing child row and preserves real detection times',()=>{
 const mounted=render(<BusTransportMonitoring/>);const original=screen.getByText('Demo child');
 read.data.rows[0]={...read.data.rows[0],state:'ON_BOARD',boardedAt:'2026-10-29T09:00:00Z'};mounted.rerender(<BusTransportMonitoring/>);expect(screen.getByText('On Board')).toBeTruthy();expect(screen.getByText('Demo child')).toBe(original);
 read.data.rows[0]={...read.data.rows[0],state:'OFF_BOARD',rssi:null,proximity:'UNKNOWN',exitedAt:'2026-10-29T09:01:00Z'};mounted.rerender(<BusTransportMonitoring/>);expect(screen.getByText('Off Board')).toBeTruthy();expect(screen.queryByText('-48.3 dBm')).toBeNull();
});
it('failed activation shows the error and does not pretend the session started',async()=>{
 api.mockRejectedValue(Error('Not permitted'));render(<BusTransportMonitoring/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'End Daycare Session'})));expect(screen.getByRole('alert').textContent).toContain('Not permitted');expect(read.refresh).not.toHaveBeenCalled();expect(screen.getByText('Inactive')).toBeTruthy();
});
