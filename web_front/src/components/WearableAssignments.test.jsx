import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import WearableAssignments from './WearableAssignments';
import {api} from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
let devices,children,changed,history;
const parent={user:{role:'PARENT',active:true}};
beforeEach(()=>{
 children=[{id:'child-a',name:'Current Child',guardians:[parent],assignments:[]},{id:'child-b',name:'New Child',guardians:[parent],assignments:[]},{id:'ineligible',name:'Inactive Parent Child',guardians:[{user:{role:'PARENT',active:false}}],assignments:[]},{id:'teacher-only',name:'Teacher Link Only',guardians:[{user:{role:'TEACHER',active:true}}],assignments:[]}];
 const assignment={id:'old-assignment',childId:'child-a',child:{id:'child-a',name:'Current Child'},startedAt:'2026-10-25T08:00:00Z'};
 devices=[{id:'free',hardwareId:'CG-FREE',active:true,currentAssignment:null},{id:'assigned',hardwareId:'CG-ASSIGNED',active:true,currentAssignment:assignment,communicationState:'OFFLINE'},{id:'inactive',hardwareId:'CG-INACTIVE',active:false,currentAssignment:null}];
 children[0].assignments=[{...assignment,device:{id:'assigned',hardwareId:'CG-ASSIGNED',active:true}}];
 history=[{...assignment,endedAt:null},{id:'historical',childId:'historical-child-reference',child:{name:'Previous Child'},startedAt:'2026-10-01',endedAt:'2026-10-20'},{id:'unresolved',childId:'unresolved-reference',child:null,startedAt:'2026-09-01',endedAt:'2026-09-20'}];changed=vi.fn();
 api.mockImplementation(async(path,options={})=>{
  const url=new URL(path,'http://fixture');
  if(url.pathname==='/api/v1/devices')return structuredClone(devices.slice(+url.searchParams.get('offset'),+url.searchParams.get('offset') + +url.searchParams.get('limit')));
  if(url.pathname==='/api/v1/admin/children')return structuredClone(children.slice(+url.searchParams.get('offset'),+url.searchParams.get('offset') + +url.searchParams.get('limit')));
  if(url.pathname.startsWith('/api/v1/devices/'))return structuredClone({...devices.find(d=>d.id===url.pathname.split('/').at(-1)),assignmentHistory:history});
  if(url.pathname.startsWith('/api/v1/admin/children/'))return structuredClone(children.find(c=>c.id===url.pathname.split('/').at(-1)));
  if(options.method==='POST'){
   const body=JSON.parse(options.body),device=devices.find(d=>d.id===url.pathname.split('/').at(-2)),child=children.find(c=>c.id===body.childId);
   for(const d of devices)if(d.currentAssignment?.id===body.expectedAssignmentId)d.currentAssignment=null;
   for(const c of children)c.assignments=c.assignments.filter(a=>a.id!==body.expectedAssignmentId);
   device.currentAssignment={id:'saved',childId:child.id,child:{id:child.id,name:child.name},startedAt:'2026-10-27'};
   child.assignments=[{...device.currentAssignment,device:{id:device.id,hardwareId:device.hardwareId,active:true}}];
   return structuredClone(device.currentAssignment);
  }
  throw Error('Unexpected isolated request');
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
async function mount(){render(<MemoryRouter><WearableAssignments onChanged={changed}/></MemoryRouter>);fireEvent.click(screen.getByText('Wearable Assignments'));await within(await screen.findByRole('table',{name:'Wearable assignments'})).findByText('CG-FREE');}
async function manage(operation='assign'){await mount();fireEvent.click(screen.getByRole('button',{name:'Manage Assignments'}));await waitFor(()=>expect(screen.getByLabelText('Action').disabled).toBe(false));fireEvent.change(screen.getByLabelText('Action'),{target:{value:operation}});}
function choose(label,value){fireEvent.change(screen.getByLabelText(label),{target:{value}});}
const writes=()=>api.mock.calls.filter(([,o])=>o?.method==='POST');
it('shows actual current child names, availability separately from connection, and named history with honest missing-child fallback',async()=>{
 await mount();const table=screen.getByRole('table',{name:'Wearable assignments'});expect(within(table).getByText('Current Child')).toBeTruthy();expect(within(table).getByText('Available')).toBeTruthy();expect(within(table).getByText('Assigned')).toBeTruthy();expect(within(table).getByText('Inactive')).toBeTruthy();
 fireEvent.click(within(table).getAllByRole('button',{name:'View History'})[1]);const dialog=await screen.findByRole('dialog');await within(dialog).findByText('Previous Child');expect(within(dialog).getByText('Child not available')).toBeTruthy();expect(within(dialog).getByText('Current')).toBeTruthy();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('table',{name:'Wearable assignments'})).toBeTruthy();
});
it('offers only active free wearables and eligible unassigned children for Assign, then saves the existing authorized API contract',async()=>{
 await manage();expect(within(screen.getByLabelText('Available wearable')).getAllByRole('option').map(o=>o.textContent)).toEqual(['Select wearable','CG-FREE']);expect(within(screen.getByLabelText('Child')).getAllByRole('option').map(o=>o.textContent)).toEqual(['Select child','New Child']);
 choose('Available wearable','free');choose('Child','child-b');fireEvent.click(screen.getByRole('button',{name:'Review Assignment'}));const d=await screen.findByRole('dialog',{name:'Assign Wearable'});expect(within(d).getByText('CG-FREE will be assigned to New Child.')).toBeTruthy();expect(writes()).toHaveLength(0);
 fireEvent.click(within(d).getByRole('button',{name:'Assign Wearable'}));await screen.findByText('CG-FREE is now assigned to New Child.');expect(writes()[0]).toEqual(['/api/v1/admin/devices/free/assignment',{method:'POST',body:JSON.stringify({childId:'child-b',assignmentAcknowledged:true})}]);expect(changed).toHaveBeenCalledTimes(1);expect(devices[0].currentAssignment.childId).toBe('child-b');
});
it.each(['Cancel','Close dialog'])('cancels confirmation with %s without closing the assignment form or saving',async action=>{
 await manage();choose('Available wearable','free');choose('Child','child-b');fireEvent.click(screen.getByRole('button',{name:'Review Assignment'}));const d=await screen.findByRole('dialog');fireEvent.click(within(d).getByRole('button',{name:action}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByLabelText('Available wearable').value).toBe('free');expect(writes()).toHaveLength(0);
});
it('moves an assigned offline wearable, derives its source assignment and excludes already-equipped targets',async()=>{
 await manage('move');expect(within(screen.getByLabelText('Wearable to move')).getAllByRole('option').map(o=>o.value)).toEqual(['','assigned']);choose('Wearable to move','assigned');choose('Move to child','child-b');expect(screen.getByText('Currently assigned to:')).toBeTruthy();expect(screen.queryByLabelText('Current assignment to end')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Review Move'}));const d=await screen.findByRole('dialog');expect(within(d).getByText('CG-ASSIGNED will be removed from Current Child and assigned to New Child.')).toBeTruthy();fireEvent.click(within(d).getByRole('button',{name:'Confirm Move'}));await screen.findByText('CG-ASSIGNED is now assigned to New Child.');expect(JSON.parse(writes()[0][1].body)).toEqual({expectedAssignmentId:'old-assignment',childId:'child-b',transferAcknowledged:true});
});
it('replaces only the selected child existing wearable using a free replacement and preserves reviewed IDs',async()=>{
 await manage('replace');expect(within(screen.getByLabelText('Child')).getAllByRole('option').map(o=>o.value)).toEqual(['','child-a']);expect(within(screen.getByLabelText('Replacement wearable')).getAllByRole('option').map(o=>o.value)).toEqual(['','free']);choose('Child','child-a');choose('Replacement wearable','free');fireEvent.click(screen.getByRole('button',{name:'Review Replacement'}));const d=await screen.findByRole('dialog');expect(within(d).getByText("Current Child's wearable will change from CG-ASSIGNED to CG-FREE.")).toBeTruthy();fireEvent.click(within(d).getByRole('button',{name:'Confirm Replacement'}));await screen.findByText('CG-FREE is now assigned to Current Child.');expect(writes()[0][0]).toBe('/api/v1/admin/devices/free/transfer');expect(JSON.parse(writes()[0][1].body).expectedAssignmentId).toBe('old-assignment');
});
it('rechecks the current assignment before review and refuses stale selected records',async()=>{
 await manage('move');choose('Wearable to move','assigned');choose('Move to child','child-b');devices[1].currentAssignment.id='changed-assignment';fireEvent.click(screen.getByRole('button',{name:'Review Move'}));await screen.findByText('This assignment has changed. Refresh and try again.');expect(screen.queryByRole('dialog')).toBeNull();expect(writes()).toHaveLength(0);expect(screen.getByRole('button',{name:'Review Move'}).disabled).toBe(true);
});
it('keeps rejected confirmation visible, requires refresh after a conflict and never claims success',async()=>{
 await manage();choose('Available wearable','free');choose('Child','child-b');fireEvent.click(screen.getByRole('button',{name:'Review Assignment'}));const d=await screen.findByRole('dialog');const original=api.getMockImplementation();api.mockImplementation((p,o)=>o?.method==='POST'?Promise.reject(Object.assign(Error('internal'),{code:'ASSIGNMENT_CONFLICT'})):original(p,o));fireEvent.click(within(d).getByRole('button',{name:'Assign Wearable'}));await within(d).findByText('This assignment has changed. Refresh and try again.');expect(within(d).getByRole('button',{name:'Assign Wearable'}).disabled).toBe(true);expect(screen.queryByText('CG-FREE is now assigned to New Child.')).toBeNull();expect(changed).not.toHaveBeenCalled();
});
it('prevents duplicate writes while waiting for the backend commit',async()=>{
 await manage();choose('Available wearable','free');choose('Child','child-b');fireEvent.click(screen.getByRole('button',{name:'Review Assignment'}));const d=await screen.findByRole('dialog');let finish;const original=api.getMockImplementation();api.mockImplementation((p,o)=>o?.method==='POST'?new Promise(resolve=>{finish=resolve;}):original(p,o));const b=within(d).getByRole('button',{name:'Assign Wearable'});fireEvent.click(b);fireEvent.click(b);expect(writes()).toHaveLength(1);expect(within(d).getByRole('button',{name:'Saving...'}).disabled).toBe(true);finish({id:'saved',childId:'child-b'});await screen.findByText('CG-FREE is now assigned to New Child.');
});
it('loads every inventory and child page before offering choices, including records beyond the initial limits',async()=>{
 devices.push(...Array.from({length:26},(_,i)=>({id:`extra-${i}`,hardwareId:`EXTRA-${i}`,active:true,currentAssignment:null})));children.push(...Array.from({length:101},(_,i)=>({id:`later-${i}`,name:`Later Child ${i}`,guardians:[parent],assignments:[]})));
 await manage();expect(within(screen.getByLabelText('Available wearable')).getByRole('option',{name:'EXTRA-25'})).toBeTruthy();expect(within(screen.getByLabelText('Child')).getByRole('option',{name:'Later Child 100'})).toBeTruthy();expect(api.mock.calls.some(([p])=>p.includes('offset=100'))).toBe(true);
});
it('does not represent unavailable data as an empty eligible inventory',async()=>{
 api.mockRejectedValue(Error('offline'));render(<MemoryRouter><WearableAssignments/></MemoryRouter>);fireEvent.click(screen.getByText('Wearable Assignments'));await screen.findByText('Unable to load wearable assignments. Please try again.');expect(screen.queryByText('No wearables have been registered yet.')).toBeNull();expect(writes()).toHaveLength(0);
});
it('removes the entire request-code section and footer while retaining inventory and assignment management',async()=>{
 await mount();
 expect(screen.queryByText('Parent request codes')).toBeNull();
 expect(screen.queryByText(/A request code lets a verified Parent/)).toBeNull();
 expect(screen.queryByText('Assigned; no new request code')).toBeNull();
 expect(screen.queryByRole('button',{name:'Generate Parent request code'})).toBeNull();
 expect(screen.queryByText(/Available means active and unassigned/)).toBeNull();
 expect(screen.queryByRole('link',{name:'Open Wearable Devices'})).toBeNull();
 expect(document.querySelector('.wa-claims,.wa-claim-list')).toBeNull();
 expect(screen.getByRole('table',{name:'Wearable assignments'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Manage Assignments'})).toBeTruthy();
 expect(api.mock.calls.some(([path])=>path.endsWith('/claim-code'))).toBe(false);
});
