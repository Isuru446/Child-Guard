import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegistrationApproval from './RegistrationApproval';
import ManagementPage from '../components/ManagementPage';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn(),privatePhoto:vi.fn()}));
let application;
beforeEach(()=>{
 application={id:'synthetic-application',fullName:'Synthetic Applicant',username:'synthetic-parent',role:'PARENT',status:'PENDING',createdAt:'2026-10-23T00:00:00Z',children:[],decisions:[]};
 vi.spyOn(window,'confirm').mockReturnValue(true);
 api.mockImplementation(async(path,options)=>{
  if(path==='/api/v1/attendance/pending-count')return {count:0};
  if(path.startsWith('/api/v1/admin/registrations?'))return application?[application]:[];
  if(path==='/api/v1/admin/enrollments'||path==='/api/v1/admin/wearable-requests')return [];
  if(path.endsWith('/decision')&&options?.method==='POST'){application=null;return {status:'APPROVED'};}
  if(path==='/api/v1/admin/management')return {users:[{id:'synthetic-user',username:'Persisted Parent',role:'PARENT',active:true,guardians:[]}],children:[],devices:[],audits:[]};
  if(path.endsWith('/status'))return {active:false};
  throw new Error('Unexpected synthetic request');
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
const mount=component=>render(<MemoryRouter>{component}</MemoryRouter>);
it('keeps Review beneath Actions in every actual approval table and opens the correct request',async()=>{
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>{
  if(path==='/api/v1/admin/enrollments')return Promise.resolve([{id:'child-request',fullName:'Long Child Request Name',relationship:'Parent',status:'PENDING'}]);
  if(path==='/api/v1/admin/wearable-requests')return Promise.resolve([{id:'wearable-request',hardwareId:'CG-REQUEST-WEARABLE',status:'PENDING',claimVerified:true}]);
  return original(path,options);
 });
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');
 for(const [caption,title] of [['Registration requests','Review Account Registration'],['Child registration and Parent access requests','Review Child and Parent Access'],['Wearable assignment requests','Review Wearable Request']]){
  const table=screen.getByRole('table',{name:caption}),header=within(table).getByRole('columnheader',{name:'Actions'}),button=within(table).getByRole('button',{name:'Review'}),cell=button.closest('td');
  expect(cell.cellIndex).toBe(header.cellIndex);expect(cell.style.textAlign).toBe(header.style.textAlign);expect(cell.querySelector('.cg-table-actions')).toBeTruthy();
  fireEvent.click(button);const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('heading',{name:title})).toBeTruthy();fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));
 }
 expect(api.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
});
it('uses contextual empty states without losing the approval table columns',async()=>{
 application=null;mount(<RegistrationApproval/>);await screen.findByText('No registration requests match these filters.');
 for(const [caption,message] of [['Child registration and Parent access requests','No child registration or Parent access requests.'],['Wearable assignment requests','No wearable assignment requests.']]){
  const table=screen.getByRole('table',{name:caption});expect(within(table).getByText(message).colSpan).toBe(within(table).getAllByRole('columnheader').length);
 }
});
it('loads persisted applications and sends confirmed approval before reporting success',async()=>{
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');
 fireEvent.click(screen.getByText('Review'));fireEvent.click(screen.getByRole('button',{name:'Approve',exact:true}));
 await screen.findByText('Decision saved. The applicant can see the updated status.');
 expect(api).toHaveBeenCalledWith('/api/v1/admin/registrations/synthetic-application/decision',{method:'POST',body:JSON.stringify({status:'APPROVED'})});
});
it('requires rejection reason and sends it to the backend',async()=>{
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');fireEvent.click(screen.getByText('Review'));fireEvent.click(screen.getByRole('button',{name:'Reject',exact:true}));
 expect(screen.getByRole('alert').textContent).toContain('Enter a reason of at least 3 characters');
 expect(api.mock.calls.filter(([p])=>p.endsWith('/decision'))).toHaveLength(0);
 fireEvent.change(screen.getByLabelText('Reason shown to the applicant (required to reject)'),{target:{value:'Please correct contact details'}});fireEvent.click(screen.getByRole('button',{name:'Reject',exact:true}));
 await screen.findByText('Decision saved. The applicant can see the updated status.');
 expect(api).toHaveBeenCalledWith('/api/v1/admin/registrations/synthetic-application/decision',{method:'POST',body:JSON.stringify({status:'REJECTED',reason:'Please correct contact details'})});
});
it('shows persisted applicant center/contact and decision history without offering a second decision',async()=>{
 application={...application,email:'applicant@example.invalid',phone:'0700000000',centerName:'Synthetic Center',status:'REJECTED',decisions:[{status:'REJECTED',reason:'Correct contact information',createdAt:'2026-10-23T01:00:00Z'}]};
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');fireEvent.click(screen.getByText('Review'));
 expect(await screen.findByText('Synthetic Center')).toBeTruthy();expect(screen.getByText('applicant@example.invalid')).toBeTruthy();expect(screen.getByText('0700000000')).toBeTruthy();
 expect(screen.getByText(/Correct contact information/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Approve',exact:true})).toBeNull();expect(screen.queryByRole('button',{name:'Reject',exact:true})).toBeNull();
 expect(api.mock.calls.filter(([path])=>path.endsWith('/decision'))).toHaveLength(0);
});
it('does not claim success when backend reads fail',async()=>{
 api.mockRejectedValue(new Error('Registration unavailable'));
 mount(<RegistrationApproval/>);await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Registration unavailable'));
 expect(screen.queryByText('Decision saved. The applicant can see the updated status.')).toBeNull();expect(screen.queryByText('Synthetic Applicant')).toBeNull();
});
it('explains a configuration-disabled request workflow and disables issuing unavailable invitations',async()=>{
 api.mockRejectedValue(Object.assign(Error('Service temporarily unavailable'),{status:503,code:'REGISTRATION_UNAVAILABLE'}));
 mount(<RegistrationApproval/>);
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('currently turned off'));
 expect(screen.getByRole('button',{name:'Create center invitation'}).disabled).toBe(true);
 expect(screen.queryByText('Synthetic Applicant')).toBeNull();
});
it('keeps a rejected decision visible as an error and never reports a persisted success',async()=>{
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>path.endsWith('/decision')?Promise.reject(Object.assign(Error('Already reviewed'),{status:409,code:'INVALID_STATE'})):original(path,options));
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');fireEvent.click(screen.getByText('Review'));fireEvent.click(screen.getByRole('button',{name:'Approve',exact:true}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Already reviewed'));expect(screen.queryByText('Decision saved. The applicant can see the updated status.')).toBeNull();
});
it('does not issue duplicate private invitation codes while the first write is pending',async()=>{
 const original=api.getMockImplementation();let finish;
 api.mockImplementation((path,options)=>path.endsWith('/center-invitations')?new Promise(resolve=>{finish=resolve;}):original(path,options));
 mount(<RegistrationApproval/>);await screen.findByText('Synthetic Applicant');
 const button=screen.getByRole('button',{name:'Create center invitation'});fireEvent.click(button);fireEvent.click(button);
 expect(api.mock.calls.filter(([path])=>path.endsWith('/center-invitations'))).toHaveLength(1);
 finish({code:'synthetic-issued-code',expiresAt:'2026-10-27T08:00:00Z'});await screen.findByText(/Center invitation \(share privately/);
});
it('management displays real users and requires confirmation for status changes',async()=>{
 mount(<ManagementPage kind="users"/>);await screen.findByText('Persisted Parent');
 fireEvent.click(screen.getByRole('button',{name:'Suspend'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/v1/admin/users/synthetic-user/status',{method:'PATCH',body:'{"active":false}'}));
 expect(window.confirm).toHaveBeenCalled();
});
it('management retains wearable inventory without request-code controls or requests',async()=>{
 api.mockImplementation(async path=>{
  if(path==='/api/v1/attendance/pending-count')return {count:0};
  if(path.startsWith('/api/v1/admin/children?'))return [];
  if(path==='/api/v1/admin/management')return {users:[],children:[],devices:[],audits:[]};
  if(path.startsWith('/api/v1/devices?management=true'))return [{id:'synthetic-device',hardwareId:'Synthetic belt',active:true,currentAssignment:null}];
  throw Error('Unexpected synthetic request');
 });
 mount(<ManagementPage kind="children"/>);
 fireEvent.click(screen.getByText('Wearable Assignments'));await screen.findByText('Synthetic belt');
 expect(screen.queryByText('Parent request codes')).toBeNull();
 expect(screen.queryByRole('button',{name:'Generate Parent request code'})).toBeNull();
 expect(api.mock.calls.some(([path])=>path.endsWith('/claim-code'))).toBe(false);
});
