import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChildManagementPanel from './ChildManagementPanel';
import Children from '../pages/Children';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn(),privatePhoto:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
vi.mock('./RfidCards',()=>({default:({child,onAssignmentChange})=><button onClick={()=>onAssignmentChange?.(child.id,'ASSIGNED')}>Synthetic committed RFID state</button>}));
let children,parent,changed;
beforeEach(()=>{
 children=[{id:'12345678-1234-4234-8234-123456789abc',name:'Existing child',dateOfBirth:'2021-02-03T00:00:00.000Z',groupName:'Blue',guardians:[],assignments:[{id:'assignment',device:{id:'device',hardwareId:'Preserved wearable',active:true}}],enrollmentRequests:[]}];
 parent={id:'12345678-1234-4234-8234-123456789abd',username:'verified-parent',role:'PARENT',active:true,profile:{fullName:'Verified Parent'}};
 changed=vi.fn();vi.spyOn(window,'confirm').mockReturnValue(true);
 api.mockImplementation(async(path,options)=>{
  if(path.startsWith('/api/v1/admin/children?')){
   const q=new URLSearchParams(path.split('?')[1]);return structuredClone(children.filter(c=>(!q.get('search')||c.name.toLowerCase().includes(q.get('search').toLowerCase()))&&(!q.get('group')||c.groupName===q.get('group'))&&(!q.get('guardian')||(q.get('guardian')==='LINKED'?c.guardians.length>0:c.guardians.length===0))));
  }
  if(path.startsWith('/api/v1/admin/users?'))return [parent];
  if(path===`/api/v1/admin/children/${children[0]?.id}`){
   if(options?.method==='PATCH'){const {expected,...data}=JSON.parse(options.body);expect(expected).toBeTruthy();Object.assign(children[0],data);}
   return structuredClone(children[0]);
  }
  if(path==='/api/v1/admin/children'&&options?.method==='POST'){const c={id:'new-child',...JSON.parse(options.body),guardians:[],assignments:[],enrollmentRequests:[]};children.push(c);return structuredClone(c);}
  if(path===`/api/v1/admin/users/${parent.id}/guardians`){
   if(options.method==='POST'){if(!children[0].guardians.length)children[0].guardians.push({user:parent});return {linked:1};}
   children[0].guardians=[];return {removed:1};
  }
  if(path.startsWith('/api/v1/devices?management=true'))return [{id:'inventory-device',hardwareId:'Retained inventory',active:true,currentAssignment:null}];
  if(path==='/api/v1/admin/management')return {users:[],children:[],devices:[{id:'inventory-device',hardwareId:'Retained inventory',assignments:[]}],audits:[]};
  throw Error('Unexpected synthetic request');
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
const mount=()=>render(<MemoryRouter><ChildManagementPanel onChanged={changed}/></MemoryRouter>);
const loaded=()=>screen.findByText('Existing child');
async function detail(){fireEvent.click(screen.getByRole('button',{name:'View / edit Existing child'}));const d=await screen.findByRole('dialog');await within(d).findByRole('button',{name:'Edit child information'});return d;}
it('patches the selected child RFID badge without reloading its list or replacing the open dialog',async()=>{
 mount();await loaded();const dialog=await detail();
 const reads=()=>api.mock.calls.filter(([p])=>p.startsWith('/api/v1/admin/children?')).length;
 const before=reads();fireEvent.click(within(dialog).getByRole('button',{name:'Synthetic committed RFID state'}));
 expect(within(screen.getByText('Enrolled children',{selector:'caption'}).closest('table')).getByText('Assigned')).toBeTruthy();
 expect(screen.getByRole('dialog')).toBe(dialog);expect(reads()).toBe(before);expect(changed).not.toHaveBeenCalled();
});
it('integrates into the existing Children page and retains device inventory/navigation',async()=>{
 render(<MemoryRouter><Children/></MemoryRouter>);await loaded();fireEvent.click(screen.getByText('Wearable Assignments'));await within(await screen.findByRole('table',{name:'Wearable assignments'})).findByText('Retained inventory');
 expect(screen.getByRole('link',{name:'Review new child and Parent access requests'}).getAttribute('href')).toBe('/registration-approval');
});
it('searches and filters real lists, with loading and empty-result feedback',async()=>{
 mount();await loaded();expect(screen.getByText('Preserved wearable')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Filter by Group'),{target:{value:'Blue'}});fireEvent.change(screen.getByLabelText('Guardian links'),{target:{value:'LINKED'}});
 await screen.findByText('No children match these filters.');
 expect(api.mock.calls.some(([p])=>p.includes('group=Blue')&&p.includes('guardian=LINKED'))).toBe(true);
 fireEvent.change(screen.getByLabelText('Search children'),{target:{value:'nobody'}});await waitFor(()=>expect(api).toHaveBeenCalledWith(expect.stringContaining('search=nobody')));
});
it('enrolls only the supported child fields after confirmation, without inferred guardians',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Add child'}));const d=screen.getByRole('dialog');
 fireEvent.change(within(d).getByLabelText('Child name'),{target:{value:'Reviewed new child'}});
 fireEvent.change(within(d).getByLabelText('Birth date'),{target:{value:'2022-03-04'}});
 fireEvent.change(within(d).getByLabelText('Child group'),{target:{value:'Green'}});
 window.confirm.mockReturnValueOnce(false);fireEvent.click(within(d).getByRole('button',{name:'Add child'}));expect(api.mock.calls.some(([p])=>p==='/api/v1/admin/children')).toBe(false);
 fireEvent.click(within(d).getByRole('button',{name:'Add child'}));await screen.findByText(/Child enrolled/);
 expect(api).toHaveBeenCalledWith('/api/v1/admin/children',{method:'POST',body:JSON.stringify({name:'Reviewed new child',dateOfBirth:'2022-03-04',groupName:'Green'})});
 expect(children[1].guardians).toEqual([]);expect(changed).toHaveBeenCalled();
});
it('sends the read snapshot with edits and supports clearing optional values',async()=>{
 mount();await loaded();const d=await detail();expect(within(d).getByText('2021-02-03')).toBeTruthy();
 fireEvent.click(within(d).getByRole('button',{name:'Edit child information'}));const edit=screen.getByRole('dialog',{name:'Edit child information'});
 fireEvent.change(within(edit).getByLabelText('Child name'),{target:{value:'Updated child'}});fireEvent.change(within(edit).getByLabelText('Birth date'),{target:{value:''}});fireEvent.change(within(edit).getByLabelText('Child group'),{target:{value:''}});
 fireEvent.click(within(edit).getByRole('button',{name:'Save child information'}));await screen.findByText('Child information updated.');
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/children/${children[0].id}`,{method:'PATCH',body:JSON.stringify({name:'Updated child',dateOfBirth:null,groupName:null,expected:{name:'Existing child',dateOfBirth:'2021-02-03',groupName:'Blue'}})});
 expect(children[0].assignments[0].device.hardwareId).toBe('Preserved wearable');
});
it('requires explicit verified Parent selection/confirmation and refreshes guardian details',async()=>{
 mount();await loaded();const d=await detail();const select=await within(d).findByLabelText('Verified Parent');
 expect(within(d).getByRole('button',{name:'Link selected Parent'}).disabled).toBe(true);
 fireEvent.change(select,{target:{value:parent.id}});window.confirm.mockReturnValueOnce(false);fireEvent.click(within(d).getByRole('button',{name:'Link selected Parent'}));
 expect(api.mock.calls.some(([p])=>p.endsWith('/guardians'))).toBe(false);
 fireEvent.click(within(d).getByRole('button',{name:'Link selected Parent'}));
 await screen.findByRole('button',{name:'Remove verified-parent'});
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/users/${parent.id}/guardians`,{method:'POST',body:JSON.stringify({childIds:[children[0].id]})});
 expect(children[0].guardians).toHaveLength(1);
});
it('confirms unlinking and preserves the child and wearable while showing the unlinked state',async()=>{
 children[0].guardians=[{user:parent}];mount();await loaded();const d=await detail();
 window.confirm.mockReturnValueOnce(false);fireEvent.click(within(d).getByRole('button',{name:'Remove verified-parent'}));expect(api.mock.calls.some(([,o])=>o?.method==='DELETE')).toBe(false);
 fireEvent.click(within(d).getByRole('button',{name:'Remove verified-parent'}));await screen.findByText('No linked guardians. Add a Parent only after checking their authority.');
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/users/${parent.id}/guardians`,{method:'DELETE',body:JSON.stringify({childId:children[0].id,removalAcknowledged:true})});
 expect(children).toHaveLength(1);expect(children[0].assignments).toHaveLength(1);
});
it.each(['DUPLICATE_REVIEW','CHILD_CHANGED'])('displays safe %s feedback without claiming success',async code=>{
 mount();await loaded();const d=await detail();fireEvent.click(within(d).getByRole('button',{name:'Edit child information'}));const edit=screen.getByRole('dialog',{name:'Edit child information'});
 const original=api.getMockImplementation();api.mockImplementation((p,o)=>o?.method==='PATCH'?Promise.reject(Object.assign(Error('generic'),{code,status:409})):original(p,o));
 fireEvent.click(within(edit).getByRole('button',{name:'Save child information'}));const alert=await within(edit).findByRole('alert');
 expect(alert.textContent).toContain(code==='DUPLICATE_REVIEW'?'matching child needs review':'Another update changed this child');expect(screen.queryByText('Child information updated.')).toBeNull();
});
it('prevents duplicate enrollment submissions while saving',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Add child'}));const d=screen.getByRole('dialog');fireEvent.change(within(d).getByLabelText('Child name'),{target:{value:'One new child'}});
 let finish;const original=api.getMockImplementation();api.mockImplementation((p,o)=>p==='/api/v1/admin/children'?new Promise(resolve=>{finish=resolve;}):original(p,o));
 const button=within(d).getByRole('button',{name:'Add child'});fireEvent.click(button);fireEvent.click(button);expect(api.mock.calls.filter(([p])=>p==='/api/v1/admin/children')).toHaveLength(1);
 finish({id:'new'});await screen.findByText(/Child enrolled/);
});
it('shows empty and unavailable lists and never retains stale child rows after a failed load',async()=>{
 children=[];mount();await screen.findByText('No enrolled children in your center.');
 api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach ChildGuard API');
});
it.each(['Cancel','Close dialog','Escape'])('dismisses only the nested child editor with %s and preserves child and Parent selections, scroll and focus',async action=>{
 mount();await loaded();const parent=await detail(),trigger=within(parent).getByRole('button',{name:'Edit child information'});
 const parentSelect=await within(parent).findByLabelText('Verified Parent'),selectedParent=parentSelect.options[1].value;fireEvent.change(parentSelect,{target:{value:selectedParent}});
 parent.scrollTop=460;trigger.focus();fireEvent.click(trigger);
 const edit=screen.getByRole('dialog',{name:'Edit child information'});
 expect(within(edit).queryByLabelText('Search active Parents')).toBeNull();
 expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);expect(parent.getAttribute('aria-modal')).toBe('false');expect(parent.closest('[inert]')).toBeTruthy();
 expect(edit.getAttribute('data-dialog-size')).toBe('medium');expect(document.activeElement).toBe(edit);
 if(action==='Escape')fireEvent.keyDown(document,{key:'Escape'});else fireEvent.click(within(edit).getByRole('button',{name:action}));
 expect(screen.getByRole('dialog',{name:'Child details'})).toBe(parent);expect(parent.scrollTop).toBe(460);expect(within(parent).getByLabelText('Verified Parent').value).toBe(selectedParent);expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).toBe('hidden');
 expect(within(parent).getAllByText(children[0].id).length).toBeGreaterThan(0);
 fireEvent.click(within(parent).getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();expect(document.body.style.overflow).toBe('');
});
it('merges the authoritative saved fields into the still-mounted parent and retains unrelated loaded context',async()=>{
 mount();await loaded();const parent=await detail();parent.scrollTop=385;
 const parentSelect=await within(parent).findByLabelText('Verified Parent'),selectedParent=parentSelect.options[1].value;fireEvent.change(parentSelect,{target:{value:selectedParent}});
 const original=api.getMockImplementation();api.mockImplementation(async(path,options)=>{const result=await original(path,options);return options?.method==='PATCH'?{id:result.id,name:result.name,dateOfBirth:result.dateOfBirth,groupName:result.groupName}:result;});
 fireEvent.click(within(parent).getByRole('button',{name:'Edit child information'}));const edit=screen.getByRole('dialog',{name:'Edit child information'});
 fireEvent.change(within(edit).getByLabelText('Child name'),{target:{value:'Saved child name'}});fireEvent.click(within(edit).getByRole('button',{name:'Save child information'}));
 await screen.findByText('Child information updated.');expect(screen.getByRole('dialog',{name:'Child details'})).toBe(parent);expect(within(parent).getAllByText('Saved child name').length).toBeGreaterThan(0);expect(parent.scrollTop).toBe(385);expect(within(parent).getByLabelText('Verified Parent').value).toBe(selectedParent);expect(within(parent).getAllByText(/Preserved wearable/).length).toBeGreaterThan(0);
 expect(api.mock.calls.filter(([,options])=>options?.method==='PATCH')).toHaveLength(1);
});
it('keeps invalid input and backend errors in the editor with the parent retained underneath',async()=>{
 mount();await loaded();const parent=await detail();fireEvent.click(within(parent).getByRole('button',{name:'Edit child information'}));const edit=screen.getByRole('dialog',{name:'Edit child information'});
 fireEvent.change(within(edit).getByLabelText('Child name'),{target:{value:'   '}});fireEvent.submit(within(edit).getByLabelText('Child name').closest('form'));
 expect(within(edit).getByRole('alert').textContent).toContain('Check the name');expect(within(edit).getByLabelText('Child name').value).toBe('   ');expect(api.mock.calls.some(([,options])=>options?.method==='PATCH')).toBe(false);
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>options?.method==='PATCH'?Promise.reject(Error('Unable to save this child.')):original(path,options));
 fireEvent.change(within(edit).getByLabelText('Child name'),{target:{value:'Keep these edits'}});fireEvent.click(within(edit).getByRole('button',{name:'Save child information'}));
 expect((await within(edit).findByRole('alert')).textContent).toContain('Unable to save this child.');expect(within(edit).getByLabelText('Child name').value).toBe('Keep these edits');expect(parent.isConnected).toBe(true);expect(parent.getAttribute('aria-modal')).toBe('false');expect(screen.queryByText('Child information updated.')).toBeNull();
});
it('blocks dismissal and duplicate saves while the nested save is pending',async()=>{
 mount();await loaded();const parent=await detail();fireEvent.click(within(parent).getByRole('button',{name:'Edit child information'}));const edit=screen.getByRole('dialog',{name:'Edit child information'});
 let finish;const original=api.getMockImplementation();api.mockImplementation((path,options)=>options?.method==='PATCH'?new Promise(resolve=>{finish=resolve;}):original(path,options));
 fireEvent.click(within(edit).getByRole('button',{name:'Save child information'}));fireEvent.submit(within(edit).getByLabelText('Child name').closest('form'));fireEvent.keyDown(document,{key:'Escape'});
 expect(within(edit).getByRole('button',{name:'Cancel'}).disabled).toBe(true);expect(within(edit).getByRole('button',{name:'Close dialog'}).disabled).toBe(true);expect(edit.isConnected&&parent.isConnected).toBe(true);expect(api.mock.calls.filter(([,options])=>options?.method==='PATCH')).toHaveLength(1);
 finish({id:children[0].id,name:children[0].name,dateOfBirth:children[0].dateOfBirth,groupName:children[0].groupName});await screen.findByText('Child information updated.');expect(screen.getByRole('dialog',{name:'Child details'})).toBe(parent);
});
it('retains guardian context after a committed link whose refresh fails, blocking stale writes until a read succeeds',async()=>{
 mount();await loaded();const parentDialog=await detail();const select=await within(parentDialog).findByLabelText('Verified Parent');
 fireEvent.change(select,{target:{value:parent.id}});let failRefresh=false;
 const original=api.getMockImplementation();api.mockImplementation(async(path,options)=>{
  if(failRefresh&&path===`/api/v1/admin/children/${children[0].id}`){failRefresh=false;throw Error('Refresh unavailable');}
  const result=await original(path,options);if(options?.method==='POST'&&path.endsWith('/guardians'))failRefresh=true;return result;
 });
 fireEvent.click(within(parentDialog).getByRole('button',{name:'Link selected Parent'}));
 await within(parentDialog).findByRole('button',{name:'Refresh child details'});
 expect(screen.getByRole('dialog')).toBe(parentDialog);expect(within(parentDialog).getByRole('button',{name:'Link selected Parent'}).disabled).toBe(true);
 fireEvent.click(within(parentDialog).getByRole('button',{name:'Refresh child details'}));
 await within(parentDialog).findByRole('button',{name:'Remove verified-parent'});
 expect(screen.getByRole('dialog')).toBe(parentDialog);expect(api.mock.calls.filter(([path,options])=>path.endsWith('/guardians')&&options?.method==='POST')).toHaveLength(1);
});
it('keeps child editing separate from the search-free guardian selector and retains its selection after Save',async()=>{
 mount();await loaded();const parentDialog=await detail();
 expect(within(parentDialog).queryByLabelText('Search active Parents')).toBeNull();
 const selector=await within(parentDialog).findByLabelText('Verified Parent');fireEvent.change(selector,{target:{value:parent.id}});
 fireEvent.click(within(parentDialog).getByRole('button',{name:'Edit child information'}));
 const editor=screen.getByRole('dialog',{name:'Edit child information'});
 expect(within(editor).queryByLabelText('Search active Parents')).toBeNull();
 expect([...editor.querySelectorAll('label')].map(label=>label.textContent)).toEqual(['Child name','Birth date','Child group']);
 expect(editor.querySelectorAll('input')).toHaveLength(3);
 expect(editor.getAttribute('data-dialog-size')).toBe('medium');
 fireEvent.change(within(editor).getByLabelText('Child name'),{target:{value:'Updated child details'}});
 fireEvent.change(within(editor).getByLabelText('Birth date'),{target:{value:'2022-04-05'}});
 fireEvent.change(within(editor).getByLabelText('Child group'),{target:{value:'Green'}});
 fireEvent.click(within(editor).getByRole('button',{name:'Save child information'}));
 await screen.findByText('Child information updated.');
 expect(screen.getByRole('dialog',{name:'Child details'})).toBe(parentDialog);
 expect(within(parentDialog).getByLabelText('Verified Parent')).toBe(selector);
 expect(selector.value).toBe(parent.id);
 expect(within(parentDialog).getAllByText('Updated child details').length).toBeGreaterThan(0);
 expect(within(parentDialog).getByText('2022-04-05')).toBeTruthy();
 expect(within(parentDialog).getAllByText('Green').length).toBeGreaterThan(0);
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/children/${children[0].id}`,{method:'PATCH',body:JSON.stringify({name:'Updated child details',dateOfBirth:'2022-04-05',groupName:'Green',expected:{name:'Existing child',dateOfBirth:'2021-02-03',groupName:'Blue'}})});
 expect(api.mock.calls.some(([path,options])=>path.endsWith('/guardians')&&options?.method)).toBe(false);
});
it('loads and paginates eligible active Parents without a search field while preserving existing guardian links',async()=>{
 children[0].guardians=[{user:parent}];
 const pageOne=[parent,...Array.from({length:24},(_,i)=>({...parent,id:`parent-page-one-${i}`,username:`active-parent-${i}`}))];
 const pageTwo=[{...parent,id:'parent-page-two',username:'another-active-parent'}];
 const original=api.getMockImplementation();api.mockImplementation((path,options)=>{
  if(path.startsWith('/api/v1/admin/users?')){
   const q=new URLSearchParams(path.split('?')[1]);
   expect(q.get('role')).toBe('PARENT');expect(q.get('status')).toBe('ACTIVE');expect(q.get('limit')).toBe('25');expect(q.has('search')).toBe(false);
   return Promise.resolve(structuredClone(q.get('offset')==='25'?pageTwo:pageOne));
  }
  return original(path,options);
 });
 mount();await loaded();const dialog=await detail();
 expect(within(dialog).getByRole('heading',{name:'Give a Verified Parent Access'})).toBeTruthy();
 expect(within(dialog).queryByLabelText('Search active Parents')).toBeNull();
 let select=await within(dialog).findByLabelText('Verified Parent');
 expect(select.closest('label').previousElementSibling.textContent).toContain('Check that the Parent is authorized');
 expect(within(select).queryByRole('option',{name:'verified-parent / Verified Parent'})).toBeNull();
 expect(select.options).toHaveLength(25); // placeholder + 24 not already linked
 expect(within(dialog).getByRole('button',{name:'Previous Parents'}).disabled).toBe(true);
 fireEvent.change(select,{target:{value:pageOne[1].id}});expect(within(dialog).getByRole('button',{name:'Link selected Parent'}).disabled).toBe(false);
 fireEvent.click(within(dialog).getByRole('button',{name:'Next Parents'}));
 select=await within(dialog).findByLabelText('Verified Parent');
 expect(select.value).toBe('');expect(within(select).getByRole('option',{name:'another-active-parent / Verified Parent'})).toBeTruthy();
 expect(within(dialog).getByRole('button',{name:'Next Parents'}).disabled).toBe(true);
 fireEvent.click(within(dialog).getByRole('button',{name:'Previous Parents'}));
 select=await within(dialog).findByLabelText('Verified Parent');expect(select.options).toHaveLength(25);
 expect(children[0].guardians).toEqual([{user:parent}]);
 expect(api.mock.calls.every(([,options])=>!options?.method)).toBe(true);
});
