import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Devices from './Devices';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {api} from '../lib/api';
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../components/Topbar',()=>({default:()=> <header>Admin header</header>}));
vi.mock('../components/Footer',()=>({default:()=> <footer>Admin footer</footer>}));
const device={id:'demo-fixture',hardwareId:'SYNTHETIC-REAL-ROUTE',active:true,lastSeen:new Date().toISOString(),currentAssignment:null,beaconStates:[],monitoring:{serverTime:new Date().toISOString()},gpsMonitoring:{latestStatus:'NOT_REPORTED'}};
beforeEach(()=>{
 useMonitoringRead.mockReset().mockImplementation(path=>({data:path.includes('/rfid/')?[]:[device],loading:false,error:'',updatedAt:Date.now(),refresh:vi.fn()}));
 api.mockReset().mockImplementation(async path=>path.startsWith('/api/v1/admin/children?')?[]:device);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const mount=()=>render(<MemoryRouter><Devices/></MemoryRouter>);
it('starts directly with the real header and has no demo toggle, demo panel or extra toolbar',()=>{
 const view=mount();expect(view.container.firstElementChild.className).toBe('dv-page');
 expect(view.container.firstElementChild.firstElementChild.tagName).toBe('HEADER');
 expect(screen.getByRole('heading',{name:'Wearable devices'})).toBeTruthy();
 expect(screen.queryByText(/Show example device tools|Return to real device records|Demonstration only/)).toBeNull();
 expect(view.container.querySelector('.dv-page > .dv-toolbar')).toBeNull();expect(view.container.firstElementChild.lastElementChild.tagName).toBe('FOOTER');
});
it('keeps genuine registration and per-device management accessible',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'Register wearable'}));
 let dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('heading',{name:'Register wearable belt'})).toBeTruthy();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));
 fireEvent.click(screen.getByRole('button',{name:'Manage SYNTHETIC-REAL-ROUTE'}));
 dialog=screen.getByRole('dialog');await within(dialog).findByText('Device Information');
 expect(api).toHaveBeenCalledWith('/api/v1/devices/demo-fixture?management=true');
 expect(within(dialog).getByText('Assign to Child')).toBeTruthy();
});
it('keeps search, status and assignment filters on the real endpoint',()=>{
 mount();fireEvent.change(screen.getByLabelText('Search devices'),{target:{value:'SYNTHETIC'}});
 fireEvent.change(screen.getByLabelText('Device status'),{target:{value:'ACTIVE'}});fireEvent.change(screen.getByLabelText('Assignment status'),{target:{value:'UNASSIGNED'}});
 expect(useMonitoringRead.mock.calls.some(([path])=>path.includes('search=SYNTHETIC')&&path.includes('state=ACTIVE')&&path.includes('assignment=UNASSIGNED'))).toBe(true);
 expect(screen.getByText('SYNTHETIC-REAL-ROUTE')).toBeTruthy();
});
it('retains the lazy standalone RFID management section below genuine wearables',async()=>{
 const view=mount();const details=view.container.querySelector('.rfid-readers');expect(details).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Register New Reader'})).toBeNull();details.open=true;fireEvent(details,new Event('toggle'));
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Register New Reader'})).toBeTruthy());
 expect(screen.getByLabelText('Reader public ID')).toBeTruthy();expect(screen.getByRole('button',{name:'Register reader'})).toBeTruthy();
 expect(useMonitoringRead.mock.calls.some(([path])=>path==='/api/v1/admin/rfid/readers')).toBe(true);
});
