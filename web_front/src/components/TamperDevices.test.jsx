import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import LiveDevices from './LiveDevices';
import {useMonitoringRead} from '../lib/use-monitoring-read';
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
afterEach(cleanup);
it('mounts tamper in the real Wearable Devices table alongside child and separate online state',()=>{
 const now=Date.now();
 useMonitoringRead.mockReturnValue({data:[{id:'device',hardwareId:'SYNTHETIC-BELT',active:true,lastSeen:new Date(now).toISOString(),connectionState:'ONLINE',currentAssignment:{child:{name:'Assigned child'}},tamper:{state:'OPEN',lastKnownState:'OPEN',stale:false,observedAt:new Date(now).toISOString()},monitoring:{serverTime:new Date(now).toISOString()}}],loading:false,stale:false,updatedAt:now,refresh:vi.fn()});
 render(<MemoryRouter><LiveDevices/></MemoryRouter>);
 expect(screen.getAllByText('Tamper loop: Disconnected').length).toBeGreaterThan(0);
 expect(screen.getByRole('cell',{name:'Assigned child'})).toBeTruthy();expect(screen.getAllByText('Online').length).toBeGreaterThan(0);
 expect(screen.getByRole('columnheader',{name:'Tamper loop'})).toBeTruthy();
});
