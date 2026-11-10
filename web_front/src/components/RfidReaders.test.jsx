import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import RfidReaders,{ReaderManagement} from './RfidReaders';
import {api} from '../lib/api';
import {useMonitoringRead} from '../lib/use-monitoring-read';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
let state,refresh;
const recent=()=>({id:'reader-a',hardwareId:'CG-SYNTHETIC-READER-01',active:true,lastSeen:new Date(Date.now()-1000).toISOString(),serverTime:new Date().toISOString(),online:true});
const fill=()=>fireEvent.change(screen.getByLabelText('Reader public ID'),{target:{value:'CG-SYNTHETIC-NEW'}});
beforeEach(()=>{
 refresh=vi.fn();state={data:[recent()],loading:false,refresh,updatedAt:Date.now(),stale:false,error:''};
 useMonitoringRead.mockImplementation(()=>state);api.mockReset().mockResolvedValue({provisioningToken:'SYNTHETIC-ONE-TIME-ONLY'});vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('keeps disclosure lazy, shows the title/subtitle and reports the registered count when open',async()=>{
 const view=render(<RfidReaders/>);expect(useMonitoringRead).not.toHaveBeenCalled();
 expect(screen.getByText('RFID Attendance Readers')).toBeTruthy();expect(screen.getByText('Manage standalone RFID readers used for attendance confirmation.')).toBeTruthy();
 const disclosure=view.container.querySelector('details');disclosure.open=true;fireEvent(disclosure,new Event('toggle'));
 await screen.findByRole('article',{name:'Reader CG-SYNTHETIC-READER-01'});expect(screen.getByLabelText('1 registered readers')).toBeTruthy();
 disclosure.open=false;fireEvent(disclosure,new Event('toggle'));await waitFor(()=>expect(screen.queryByLabelText('RFID reader management')).toBeNull());
});
it('shows separate reader cards, enabled badges and honest recent/old/missing communication',()=>{
 state.data=[recent(),{...recent(),id:'old',hardwareId:'OLD-READER',lastSeen:new Date(Date.now()-61000).toISOString()},
  {...recent(),id:'disabled',hardwareId:'DISABLED-READER',active:false}, {...recent(),id:'missing',hardwareId:'NO-UPDATES',lastSeen:null}];
 render(<ReaderManagement/>);expect(screen.getAllByRole('article')).toHaveLength(4);
 const first=screen.getByRole('article',{name:'Reader CG-SYNTHETIC-READER-01'});expect(within(first).getByText('Enabled')).toBeTruthy();expect(within(first).getByText('Online')).toBeTruthy();expect(within(first).getByText(/Last communication/)).toBeTruthy();
 expect(within(screen.getByRole('article',{name:'Reader OLD-READER'})).getByText('No recent communication')).toBeTruthy();
 const disabled=screen.getByRole('article',{name:'Reader DISABLED-READER'});expect(within(disabled).getByText('Disabled')).toBeTruthy();expect(within(disabled).queryByText('Online')).toBeNull();
 expect(within(screen.getByRole('article',{name:'Reader NO-UPDATES'})).getByText(/Not received/)).toBeTruthy();
});
it('ages an online badge without a backend refresh and never calls stale data online',async()=>{
 vi.useFakeTimers();const r=recent();r.lastSeen=new Date(Date.now()-59500).toISOString();state.data=[r];
 const view=render(<ReaderManagement/>);expect(screen.getByText('Online')).toBeTruthy();
 await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(screen.queryByText('Online')).toBeNull();
 state={...state,stale:true,data:[recent()]};view.rerender(<ReaderManagement/>);expect(screen.getByText('Communication unavailable')).toBeTruthy();expect(screen.queryByText('Online')).toBeNull();
});
it.each([true,false])('keeps the correct enable/disable API request (active=%s)',async active=>{
 state.data=[{...recent(),active}];render(<ReaderManagement/>);fireEvent.click(screen.getByRole('button',{name:active?'Disable reader':'Enable reader'}));
 await waitFor(()=>expect(refresh).toHaveBeenCalled());expect(api).toHaveBeenCalledWith('/api/v1/admin/rfid/readers/reader-a',{method:'PATCH',body:JSON.stringify({active:!active,expectedActive:active})});
});
it('cancels registration without an API request',()=>{
 window.confirm.mockReturnValue(false);render(<ReaderManagement/>);fill();fireEvent.click(screen.getByRole('button',{name:'Register reader'}));expect(api).not.toHaveBeenCalled();
});
it('retains default times and submits the existing payload once while saving',async()=>{
 let finish;api.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<ReaderManagement/>);
 expect(screen.getByLabelText('Daily attendance starts (Sri Lanka)').value).toBe('06:00');expect(screen.getByLabelText('Daily attendance ends (Sri Lanka)').value).toBe('18:00');
 expect(screen.getByLabelText('Reader public ID').value).toBe('');fill();const button=screen.getByRole('button',{name:'Register reader'});fireEvent.click(button);fireEvent.click(button);
 expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('/api/v1/admin/rfid/readers',{method:'POST',body:JSON.stringify({hardwareId:'CG-SYNTHETIC-NEW',startMinute:360,endMinute:1080})});
 expect(screen.getByRole('button',{name:'Saving reader…'}).disabled).toBe(true);
 finish({provisioningToken:'SYNTHETIC-ONE-TIME-ONLY'});await screen.findByLabelText('One-time reader credential');expect(screen.getByText(/Reader registered/)).toBeTruthy();
});
it('places ID and time validation messages under their own fields and sends nothing invalid',()=>{
 render(<ReaderManagement/>);fireEvent.click(screen.getByRole('button',{name:'Register reader'}));
 const id=screen.getByLabelText('Reader public ID');expect(id.getAttribute('aria-invalid')).toBe('true');expect(document.getElementById(id.getAttribute('aria-describedby')).textContent).toContain('Enter a reader ID');
 fill();fireEvent.change(screen.getByLabelText('Daily attendance ends (Sri Lanka)'),{target:{value:'05:00'}});fireEvent.click(screen.getByRole('button',{name:'Register reader'}));
 const end=screen.getByLabelText('Daily attendance ends (Sri Lanka)');expect(end.getAttribute('aria-invalid')).toBe('true');expect(document.getElementById(end.getAttribute('aria-describedby')).textContent).toContain('End time must be later');expect(api).not.toHaveBeenCalled();
});
it('keeps the selected attendance times in the existing minutes-based API contract',async()=>{
 render(<ReaderManagement/>);fill();fireEvent.change(screen.getByLabelText('Daily attendance starts (Sri Lanka)'),{target:{value:'07:30'}});fireEvent.change(screen.getByLabelText('Daily attendance ends (Sri Lanka)'),{target:{value:'17:45'}});
 fireEvent.click(screen.getByRole('button',{name:'Register reader'}));await screen.findByLabelText('One-time reader credential');
 expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({hardwareId:'CG-SYNTHETIC-NEW',startMinute:450,endMinute:1065});
});
it('preserves one-time password masking, copy and clear without placing credentials in reader cards',async()=>{
 const copy=vi.fn().mockResolvedValue();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 render(<ReaderManagement/>);fill();fireEvent.click(screen.getByRole('button',{name:'Register reader'}));
 const credential=await screen.findByLabelText('One-time reader credential');expect(credential.type).toBe('password');expect(credential.readOnly).toBe(true);
 expect(screen.getByRole('article').textContent).not.toContain('SYNTHETIC-ONE-TIME-ONLY');fireEvent.click(screen.getByRole('button',{name:'Copy provisioning credential'}));
 await waitFor(()=>expect(copy).toHaveBeenCalledWith('SYNTHETIC-ONE-TIME-ONLY'));fireEvent.click(screen.getByRole('button',{name:/Provisioning complete/}));expect(screen.queryByLabelText('One-time reader credential')).toBeNull();
});
it('shows loading, empty, server error and unavailable-setup states without changing wearables',async()=>{
 state={...state,data:null,loading:true};const view=render(<ReaderManagement/>);expect(screen.getByText('Loading readers…')).toBeTruthy();
 state={...state,loading:false,data:[]};view.rerender(<ReaderManagement/>);expect(screen.getByText(/No RFID readers registered/)).toBeTruthy();
 api.mockRejectedValue(Error('Reader ID unavailable'));fill();fireEvent.click(screen.getByRole('button',{name:'Register reader'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Reader ID unavailable'));
 expect(screen.queryByLabelText('One-time reader credential')).toBeNull();
 state={...state,errorCode:'RFID_UNAVAILABLE'};view.rerender(<ReaderManagement/>);expect(screen.getByText(/Existing wearables are unchanged/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Register reader'})).toBeNull();
});
