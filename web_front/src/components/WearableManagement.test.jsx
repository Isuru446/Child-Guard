import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveDevices from './LiveDevices';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
let belt,child;
const deviceId='12345678-1234-4234-8234-123456789abc',childId='12345678-1234-4234-8234-123456789abd',assignmentId='12345678-1234-4234-8234-123456789abe';
beforeEach(()=>{
 belt={id:deviceId,hardwareId:'CG-BELT-A',centerId:'center-a',active:true,lastSeen:null,currentAssignment:null,assignmentHistory:[],beaconStates:[]};
 child={id:childId,name:'Verified child',assignments:[]};
 vi.spyOn(window,'confirm').mockReturnValue(true);
 api.mockImplementation(async(path,options)=>{
  if(path.startsWith('/api/v1/devices?'))return [structuredClone(belt)];
  if(path===`/api/v1/devices/${deviceId}?management=true`)return structuredClone(belt);
  if(path.startsWith('/api/v1/admin/children?'))return [child];
  if(path==='/api/v1/admin/devices'&&options.method==='POST')return {id:'87654321-4321-4321-8321-cba987654321',hardwareId:'CG-NEW',centerId:'center-a',active:true,lastSeen:null};
  if(path.endsWith('/assignment')||path.endsWith('/transfer')){belt.currentAssignment={id:assignmentId,childId,child:{id:childId,name:child.name},startedAt:'2026-10-25T00:00:00Z',endedAt:null};return {id:assignmentId};}
  if(path.endsWith('/unassign')){belt.currentAssignment=null;return {endedAt:'2026-10-25T00:01:00Z'};}
  if(path.endsWith('/status')){belt.active=JSON.parse(options.body).active;return {active:belt.active};}
  throw Error('Unexpected synthetic request');
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
const mount=()=>render(<MemoryRouter><LiveDevices/></MemoryRouter>);
const loaded=()=>screen.findByRole('button',{name:'Manage CG-BELT-A'});
async function details(){fireEvent.click(await loaded());const d=await screen.findByRole('dialog');await within(d).findByRole('button',{name:'Deactivate belt'});fireEvent.click(within(d).getByText(/^(Assign to Child|Move to Another Child)$/));fireEvent.click(within(d).getByText('Technical details'));await within(d).findByLabelText('Choose child');return d;}
it('extends the existing inventory and uses authenticated same-origin management filters',async()=>{
 mount();await loaded();expect(api.mock.calls[0][0]).toContain('management=true');expect(screen.getByText('Active / awaiting first event')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Search devices'),{target:{value:'belt'}});fireEvent.change(screen.getByLabelText('Device status'),{target:{value:'ACTIVE'}});fireEvent.change(screen.getByLabelText('Assignment status'),{target:{value:'UNASSIGNED'}});
 await waitFor(()=>expect(api.mock.calls.some(([p])=>p.includes('search=belt')&&p.includes('state=ACTIVE')&&p.includes('assignment=UNASSIGNED'))).toBe(true));
 expect(api.mock.calls.some(([p])=>p.includes('/auth/activity'))).toBe(false);
});
it('registers only an exact hardware ID and privately confirmed token through the existing cookie API',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Register wearable'}));const d=screen.getByRole('dialog');
 const token='synthetic-test-private-token-with-32-characters';
 fireEvent.change(within(d).getByLabelText('Device ID (required)'),{target:{value:'CG-NEW'}});
 for(const label of ['Private device access key (required)','Confirm private access key (required)']){expect(within(d).getByLabelText(label).type).toBe('password');fireEvent.change(within(d).getByLabelText(label),{target:{value:token}});}
 fireEvent.click(within(d).getByRole('button',{name:'Register wearable'}));await screen.findByText('Device operation saved.');
 expect(api).toHaveBeenCalledWith('/api/v1/admin/devices',{method:'POST',body:JSON.stringify({hardwareId:'CG-NEW',deviceToken:token})});
 expect(within(d).getByLabelText('Database Device UUID').value).toBe('87654321-4321-4321-8321-cba987654321');
 expect(within(d).queryByLabelText('Private device access key (required)')).toBeNull();expect(within(d).getByRole('button',{name:'Copy UUID'})).toBeTruthy();
 expect(document.body.textContent).not.toContain(token);fireEvent.click(within(d).getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();
 expect(Object.values({...localStorage,...sessionStorage}).some(v=>String(v).includes(token))).toBe(false);
});
it('shows returned database UUID separately from public firmware identity and current center in Manage',async()=>{
 mount();const d=await details();
 expect(within(d).getByLabelText('Database Device UUID').value).toBe(deviceId);
 expect(within(d).getByLabelText('Database Device UUID').readOnly).toBe(true);
 expect(within(d).getAllByText('CG-BELT-A')[0]).toBeTruthy();expect(within(d).getByText('center-a')).toBeTruthy();
 expect(within(d).getByText(/The belt uses the Device ID above/)).toBeTruthy();
 expect(api.mock.calls.some(([,options])=>options?.method)).toBe(false);
});
it('rejects invalid IDs and mismatched token confirmation before writing',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Register wearable'}));const d=screen.getByRole('dialog');
 fireEvent.change(within(d).getByLabelText('Device ID (required)'),{target:{value:'AA:BB'}});for(const label of ['Private device access key (required)','Confirm private access key (required)'])fireEvent.change(within(d).getByLabelText(label),{target:{value:'synthetic-private-device-token-over-32'}});
 fireEvent.click(within(d).getByRole('button',{name:'Register wearable'}));expect(within(d).getByRole('alert').textContent).toContain('exact hardware ID');
 fireEvent.change(within(d).getByLabelText('Device ID (required)'),{target:{value:'CG-NEW'}});fireEvent.change(within(d).getByLabelText('Confirm private access key (required)'),{target:{value:'different-private-device-token-over-32'}});
 fireEvent.click(within(d).getByRole('button',{name:'Register wearable'}));expect(within(d).getByRole('alert').textContent).toContain('Enter and confirm');expect(api.mock.calls.some(([p])=>p==='/api/v1/admin/devices')).toBe(false);
});
it('clears private registration fields on cancellation and rejects duplicate submit clicks',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Register wearable'}));let d=screen.getByRole('dialog');
 fireEvent.change(within(d).getByLabelText('Private device access key (required)'),{target:{value:'synthetic-private-token-over-32-characters'}});fireEvent.click(within(d).getByRole('button',{name:'Close dialog'}));fireEvent.click(screen.getByRole('button',{name:'Register wearable'}));d=screen.getByRole('dialog');expect(within(d).getByLabelText('Private device access key (required)').value).toBe('');
 fireEvent.change(within(d).getByLabelText('Device ID (required)'),{target:{value:'CG-NEW'}});for(const label of ['Private device access key (required)','Confirm private access key (required)'])fireEvent.change(within(d).getByLabelText(label),{target:{value:'synthetic-private-token-over-32-characters'}});
 let finish;const original=api.getMockImplementation();api.mockImplementation((p,o)=>p==='/api/v1/admin/devices'?new Promise(resolve=>{finish=resolve;}):original(p,o));const submit=within(d).getByRole('button',{name:'Register wearable'});fireEvent.click(submit);fireEvent.click(submit);expect(api.mock.calls.filter(([p])=>p==='/api/v1/admin/devices')).toHaveLength(1);finish({id:'created'});await screen.findByText(/Device operation saved/);
});
it('requires confirmation for assignment and never infers a child',async()=>{
 mount();const d=await details();expect(within(d).getByRole('button',{name:'Confirm assignment / transfer'}).disabled).toBe(true);fireEvent.change(within(d).getByLabelText('Choose child'),{target:{value:childId}});
 window.confirm.mockReturnValueOnce(false);fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));expect(api.mock.calls.some(([p])=>p.endsWith('/assignment'))).toBe(false);
 fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));await screen.findByText(/Device operation saved/);
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/devices/${deviceId}/assignment`,{method:'POST',body:JSON.stringify({childId,assignmentAcknowledged:true})});
});
it('uses the established transfer contract for a currently assigned belt',async()=>{
 belt.currentAssignment={id:assignmentId,childId:'old-child',child:{id:'old-child',name:'Previous child'}};
 mount();const d=await details();expect(within(d).getByRole('button',{name:'Deactivate belt'}).disabled).toBe(true);fireEvent.change(within(d).getByLabelText('Choose child'),{target:{value:childId}});fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));await screen.findByText(/Device operation saved/);
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/devices/${deviceId}/transfer`,{method:'POST',body:JSON.stringify({expectedAssignmentId:assignmentId,childId,transferAcknowledged:true})});
});
it('replaces a child’s current belt using its explicit assignment ID, without automatic swapping',async()=>{
 child.assignments=[{id:assignmentId,device:{hardwareId:'previous'}}];mount();const d=await details();fireEvent.change(within(d).getByLabelText('Choose child'),{target:{value:childId}});fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));await screen.findByText(/Device operation saved/);
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/devices/${deviceId}/transfer`,{method:'POST',body:JSON.stringify({expectedAssignmentId:assignmentId,childId,transferAcknowledged:true})});
});
it('stops a conflicting two-belt swap before writing',async()=>{
 belt.currentAssignment={id:assignmentId,childId:'old',child:{name:'Old child'}};child.assignments=[{id:'different-assignment'}];mount();const d=await details();fireEvent.change(within(d).getByLabelText('Choose child'),{target:{value:childId}});fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));expect(within(d).getByRole('alert').textContent).toContain('Both the belt and child are assigned');expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});
it('unassigns only after confirmation using the exact current assignment',async()=>{
 belt.currentAssignment={id:assignmentId,childId,child:{id:childId,name:'Verified child'}};mount();const d=await details();window.confirm.mockReturnValueOnce(false);fireEvent.click(within(d).getByRole('button',{name:'Remove assignment'}));expect(api.mock.calls.some(([p])=>p.endsWith('/unassign'))).toBe(false);fireEvent.click(within(d).getByRole('button',{name:'Remove assignment'}));await screen.findByText(/Device operation saved/);
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/devices/${deviceId}/unassign`,{method:'POST',body:JSON.stringify({expectedAssignmentId:assignmentId,unassignAcknowledged:true})});
});
it('changes only supported active metadata with a stale-state guard',async()=>{
 mount();const d=await details();fireEvent.click(within(d).getByRole('button',{name:'Deactivate belt'}));await screen.findByText(/Device operation saved/);expect(api).toHaveBeenCalledWith(`/api/v1/admin/devices/${deviceId}/status`,{method:'PATCH',body:JSON.stringify({active:false,expectedActive:true})});
});
it('shows useful backend conflicts and keeps the dialog open for review',async()=>{
 mount();const d=await details();fireEvent.change(within(d).getByLabelText('Choose child'),{target:{value:childId}});const original=api.getMockImplementation();api.mockImplementation((p,o)=>p.endsWith('/assignment')?Promise.reject(Object.assign(Error('generic'),{code:'ASSIGNMENT_CONFLICT',status:409})):original(p,o));fireEvent.click(within(d).getByRole('button',{name:'Confirm assignment / transfer'}));expect((await within(d).findByRole('alert')).textContent).toContain('Assignments changed or conflict');expect(screen.queryByText(/Device operation saved/)).toBeNull();
});
it('does not invent battery, communication or GPS data and handles an empty inventory',async()=>{
 mount();await loaded();expect(screen.getAllByText('Not reported').length).toBeGreaterThan(0);expect(screen.queryByRole('cell',{name:'Online'})).toBeNull();expect(screen.getAllByText('Signal not available (UNKNOWN)').length).toBeGreaterThan(0);
 api.mockResolvedValue([]);fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByText('No wearable devices have been registered yet.');
});
it('distinguishes empty filtered results and network failure from a saved operation',async()=>{
 mount();await loaded();api.mockResolvedValue([]);fireEvent.change(screen.getByLabelText('Search devices'),{target:{value:'absent-belt'}});await screen.findByText('No devices match these filters.');
 api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach ChildGuard API');expect(screen.queryByText('Device operation saved.')).toBeNull();
});

it('groups everyday details separately from collapsed technical values and assignment controls',async()=>{
 mount();fireEvent.click(await loaded());const dialog=screen.getByRole('dialog');
 await within(dialog).findByRole('heading',{name:'Device Information'});
 expect(within(dialog).getByRole('heading',{name:'Assigned Child'})).toBeTruthy();expect(within(dialog).getByRole('heading',{name:'Manage Wearable'})).toBeTruthy();
 expect(within(dialog).getByText('Technical details').closest('details').open).toBe(false);
 expect(within(dialog).getByText('Assign to Child').closest('details').open).toBe(false);
 fireEvent.click(within(dialog).getByText('Technical details'));
 expect(within(dialog).getByRole('button',{name:'Copy UUID'})).toBeTruthy();expect(within(dialog).getByLabelText('Database Device UUID').value).toBe(deviceId);
 expect(api.mock.calls.some(([,o])=>o?.method)).toBe(false);
});
