import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import RfidCards from './RfidCards';
import {ReaderManagement} from './RfidReaders';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {api} from '../lib/api';
import {confirmationLabel,attendanceCsvRows} from '../lib/attendance-report';
vi.mock('../lib/use-monitoring-read',()=>({useMonitoringRead:vi.fn()}));
vi.mock('../lib/api',()=>({api:vi.fn()}));
let cards,session,refresh,readers;
const child={id:'child-a',name:'Synthetic child'};
beforeEach(()=>{
 cards=[];session=null;refresh=vi.fn();readers=[{id:'reader-a',hardwareId:'SYNTHETIC-RFID',active:true,online:true,startMinute:360,endMinute:1080}];
 useMonitoringRead.mockImplementation(path=>({data:path.endsWith('/readers')?readers:{cards,enrollment:session},refresh,loading:false,stale:false}));
 api.mockReset().mockResolvedValue({});vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'prompt').mockReturnValue('Synthetic lost card');
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows missing card with supervised issue flow and no manual UID entry',async()=>{
 render(<RfidCards child={child}/>);expect(screen.getByText('Card not assigned')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Enrollment reader'),{target:{value:'reader-a'}});fireEvent.click(screen.getByRole('button',{name:'Issue RFID Card'}));
 await waitFor(()=>expect(api).toHaveBeenCalled());expect(api.mock.calls[0][0]).toBe('/api/v1/admin/rfid/children/child-a/enrollment');expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({readerId:'reader-a',mode:'ISSUE'});
 expect(screen.queryByLabelText(/UID/i)).toBeNull();
});
it('waiting enrollment has a separate cancel control and no attendance mutation',async()=>{
 session={id:'session-a',status:'PENDING',expiresAt:'2026-10-28T10:00:00Z'};render(<RfidCards child={child}/>);
 expect(screen.getByText(/Waiting for card scan/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Cancel enrollment'}));
 await waitFor(()=>expect(api).toHaveBeenCalled());expect(api.mock.calls[0][0]).toBe('/api/v1/admin/rfid/enrollments/session-a/cancel');expect(api.mock.calls.some(([p])=>p.includes('/attendance'))).toBe(false);
});
it('replace uses active card context and revoke requires the saved card plus a reason',async()=>{
 cards=[{id:'card-a',status:'ACTIVE',maskedUid:'••••1234',issuedAt:'2026-10-28T08:00:00Z',issuedBy:{username:'Synthetic Admin'},reader:{hardwareId:'SYNTHETIC-RFID'}}];
 render(<RfidCards child={child}/>);fireEvent.change(screen.getByLabelText('Enrollment reader'),{target:{value:'reader-a'}});fireEvent.click(screen.getByRole('button',{name:'Replace RFID Card'}));
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(1));expect(JSON.parse(api.mock.calls[0][1].body).mode).toBe('REPLACE');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Revoke RFID Card'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Revoke RFID Card'}));
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({cardId:'card-a',reason:'Synthetic lost card'});
});
it('new child identity clears old enrollment selection and does not expose another child card',()=>{
 cards=[{id:'card-a',status:'ACTIVE',maskedUid:'••••1234'}];const view=render(<RfidCards child={child}/>);fireEvent.change(screen.getByLabelText('Enrollment reader'),{target:{value:'reader-a'}});
 cards=[];view.rerender(<RfidCards child={{id:'child-b',name:'Other child'}}/>);expect(screen.queryByText(/••••1234/)).toBeNull();expect(screen.getByLabelText('Enrollment reader').value).toBe('');
});
it('reader provisioning credential is shown once and cleared without affecting wearables',async()=>{
 api.mockResolvedValue({provisioningToken:'SYNTHETIC-ONE-TIME-READER-CREDENTIAL'});
 render(<ReaderManagement/>);fireEvent.change(screen.getByLabelText('Reader public ID'),{target:{value:'SYNTHETIC-NEW'}});fireEvent.click(screen.getByRole('button',{name:'Register reader'}));
 await screen.findByLabelText('One-time reader credential');expect(api.mock.calls[0][0]).toBe('/api/v1/admin/rfid/readers');
 fireEvent.click(screen.getByRole('button',{name:/Provisioning complete/}));expect(screen.queryByLabelText('One-time reader credential')).toBeNull();
});
it('read-only UI explains missing migration/configuration and normal attendance stays available',()=>{
 useMonitoringRead.mockReturnValue({data:null,loading:false,errorCode:'RFID_UNAVAILABLE',error:'Setup pending',refresh});render(<RfidCards child={child}/>);
 expect(screen.getByText(/Normal attendance remains available/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Issue RFID Card'})).toBeNull();
});
it('RFID confirmation and CSV identify the reader without a Teacher signature',()=>{
 const confirmation={method:'RFID_CARD',reader:{hardwareId:'SYNTHETIC-RFID'},userId:null,confirmedAt:'2026-10-28T03:00:00Z'};
 expect(confirmationLabel(confirmation)).toBe('RFID Card / SYNTHETIC-RFID');
 const rows=attendanceCsvRows([{status:'PRESENT',day:'2026-10-28',child,confirmation}]);expect(rows[1][6]).toBe('RFID Card / SYNTHETIC-RFID');expect(rows[1][7]).toBeUndefined();
});
