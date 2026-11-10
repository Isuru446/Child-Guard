import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Teacher from '../pages/Teacher';
import Parents from '../pages/Parents';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
let account;
const child={id:'12345678-1234-4234-8234-123456789abc',name:'Verified existing child'};
beforeEach(()=>{
 account={id:'12345678-1234-4234-8234-123456789abd',username:'managed-person',role:'TEACHER',active:true,profile:{fullName:'Managed Person',email:'person@example.invalid',phone:'0771234567'},guardians:[{child}]};
 vi.spyOn(window,'confirm').mockReturnValue(true);
 api.mockImplementation(async(path,options)=>{
  if(path.startsWith('/api/v1/admin/users?'))return [structuredClone(account)];
  if(path.startsWith('/api/v1/mobile/children?'))return [child];
  if(path===`/api/v1/admin/users/${account.id}`)return account;
  if(path.endsWith('/profile')){account.profile=JSON.parse(options.body);return account.profile;}
  if(path.endsWith('/status')){account.active=JSON.parse(options.body).active;return {active:account.active};}
  if(path==='/api/v1/admin/users'&&options.method==='POST')return {id:'created'};
  throw Error('Unexpected synthetic request');
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
const mount=(parent=false)=>render(<MemoryRouter>{parent?<Parents/>:<Teacher/>}</MemoryRouter>);
const loaded=()=>screen.findByText('managed-person');
it.each([false,true])('keeps account, contact, status and both actions in matching columns for long content (parent=%s)',async parent=>{
 account.profile.fullName='A very long account holder name for table wrapping';account.profile.phone=null;account.profile.email='long-contact-address-for-account-table@example.invalid';
 mount(parent);await loaded();
 const table=screen.getByRole('table',{name:`${parent?'Parent':'Teacher'} accounts`}),headers=within(table).getAllByRole('columnheader');
 expect(headers.map(h=>h.textContent)).toEqual(parent?['Account','Contact','Children','Status','Actions']:['Account','Contact','Status','Actions']);
 const button=within(table).getByRole('button',{name:'View / edit managed-person'}),cell=button.closest('td');
 expect(cell.cellIndex).toBe(headers.at(-1).cellIndex);expect(cell.style.textAlign).toBe(headers.at(-1).style.textAlign);
 expect(cell.querySelector('.cg-table-actions')).toBeTruthy();expect(within(cell).getByRole('button',{name:'Deactivate managed-person'})).toBeTruthy();
 expect(within(table).getByText(account.profile.fullName)).toBeTruthy();expect(within(table).getByText(account.profile.email)).toBeTruthy();
 fireEvent.click(button);const dialog=await screen.findByRole('dialog');await within(dialog).findByDisplayValue(account.profile.fullName);
});
it.each([false,true])('loads the dedicated center account list and server-side filters (parent=%s)',async parent=>{
 mount(parent);await loaded();
 const first=api.mock.calls.find(([p])=>p.startsWith('/api/v1/admin/users?'))[0];
 expect(new URLSearchParams(first.split('?')[1]).get('role')).toBe(parent?'PARENT':'TEACHER');
 fireEvent.change(screen.getByLabelText(`Search ${parent?'parents':'teachers'}`),{target:{value:'Managed'}});
 fireEvent.change(screen.getByLabelText('Account status'),{target:{value:'INACTIVE'}});
 await waitFor(()=>expect(api).toHaveBeenCalledWith(expect.stringContaining('status=INACTIVE')));
 expect(api.mock.calls.some(([p])=>p.includes('search=Managed'))).toBe(true);
 expect(screen.getByRole('link',{name:'Review registration and relationship requests'}).getAttribute('href')).toBe('/registration-approval');
});
it.each([0,1,2])('shows all and only the supplied linked children for a Parent (%s links)',async count=>{
 const second={id:'second-child',name:'Second linked child with a long full name'};
 account.role='PARENT';account.guardians=[{child},{child:second}].slice(0,count);
 mount(true);await loaded();const table=screen.getByRole('table',{name:'Parent accounts'});
 expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Account','Contact','Children','Status','Actions']);
 if(!count)expect(within(table).getByText('No child linked')).toBeTruthy();
 else for(const link of account.guardians)expect(within(table).getByText(link.child.name).closest('td').cellIndex).toBe(2);
 expect(within(table).queryByText('Unrelated child')).toBeNull();
 expect(api.mock.calls.some(([p])=>p.startsWith('/api/v1/mobile/children'))).toBe(false);
 expect(table.style.minWidth).toBe('960px');expect(table.closest('.cg-data-table__scroll').tabIndex).toBe(0);
});
it('refreshes linked names in place and preserves the current search, status and page',async()=>{
 account.role='PARENT';const original=api.getMockImplementation();let finish;
 api.mockImplementation((path,options)=>{
  if(path.startsWith('/api/v1/admin/users?')){
   const q=new URLSearchParams(path.split('?')[1]);
   return Number(q.get('offset'))===0?Array.from({length:25},(_,i)=>({...structuredClone(account),id:`parent-${i}`,username:`parent-${i}`})):[structuredClone(account)];
  }
  return original(path,options);
 });
 mount(true);await screen.findByText('parent-0');
 fireEvent.change(screen.getByLabelText('Search parents'),{target:{value:'Managed'}});
 fireEvent.change(screen.getByLabelText('Account status'),{target:{value:'ACTIVE'}});
 await waitFor(()=>expect(api).toHaveBeenCalledWith(expect.stringContaining('status=ACTIVE')));
 fireEvent.click(screen.getByRole('button',{name:'Next'}));await loaded();expect(screen.getByText('Page 2')).toBeTruthy();
 const paged=api.getMockImplementation();api.mockImplementation((path,options)=>path.startsWith('/api/v1/admin/users?')?new Promise(resolve=>{finish=resolve;}):paged(path,options));
 const table=screen.getByRole('table',{name:'Parent accounts'});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(within(table).getByText(child.name)).toBeTruthy();expect(screen.queryByText('Loading…')).toBeNull();
 finish([{...structuredClone(account),guardians:[{child:{id:'replacement-link',name:'New linked child'}}]}]);
 await within(table).findByText('New linked child');expect(within(table).queryByText(child.name)).toBeNull();
 expect(screen.getByRole('table',{name:'Parent accounts'})).toBe(table);expect(screen.getByText('Page 2')).toBeTruthy();
 expect(screen.getByLabelText('Search parents').value).toBe('Managed');expect(screen.getByLabelText('Account status').value).toBe('ACTIVE');
 const query=new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]);expect(query.get('offset')).toBe('25');expect(query.get('search')).toBe('Managed');
});
it('shows details, existing child links and edits only allowed contact information',async()=>{
 account.role='PARENT';mount(true);await loaded();fireEvent.click(screen.getByRole('button',{name:'View / edit managed-person'}));
 const dialog=await screen.findByRole('dialog');await within(dialog).findByDisplayValue('Managed Person');
 expect(within(dialog).getByText(/Verified existing child/)).toBeTruthy();
 expect(within(dialog).queryByLabelText('Role')).toBeNull();expect(within(dialog).queryByLabelText('Password')).toBeNull();
 fireEvent.change(within(dialog).getByLabelText('Full name'),{target:{value:'Updated Person'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Save information'}));
 await screen.findByText('Account information updated.');
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/users/${account.id}/profile`,{method:'PATCH',body:JSON.stringify({fullName:'Updated Person',email:'person@example.invalid',phone:'0771234567'})});
});
it('confirms deactivation, allows cancellation and refreshes the persisted status',async()=>{
 mount();await loaded();window.confirm.mockReturnValueOnce(false);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate managed-person'}));expect(api.mock.calls.some(([p])=>p.endsWith('/status'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate managed-person'}));
 await screen.findByRole('button',{name:'Activate managed-person'});
 expect(api).toHaveBeenCalledWith(`/api/v1/admin/users/${account.id}/status`,{method:'PATCH',body:'{"active":false}'});
 fireEvent.click(screen.getByRole('button',{name:'Activate managed-person'}));await screen.findByRole('button',{name:'Deactivate managed-person'});
});
it('keeps failed updates visible and allows retry without claiming success',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'View / edit managed-person'}));
 const dialog=await screen.findByRole('dialog');await within(dialog).findByDisplayValue('Managed Person');
 const original=api.getMockImplementation();api.mockImplementation((p,o)=>p.endsWith('/profile')?Promise.reject(Object.assign(Error('generic'),{status:409,code:'PROFILE_CONFLICT'})):original(p,o));
 fireEvent.click(within(dialog).getByRole('button',{name:'Save information'}));
 expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('email address is unavailable'));
 expect(screen.queryByText('Account information updated.')).toBeNull();expect(within(dialog).getByRole('button',{name:'Save information'}).disabled).toBe(false);
});
it('onboards a Teacher through the existing endpoint and prevents duplicate submits',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Add Teacher'}));
 const dialog=screen.getByRole('dialog');
 fireEvent.change(within(dialog).getByLabelText('Username'),{target:{value:'verified-teacher'}});
 for(const label of ['Initial password','Confirm password'])fireEvent.change(within(dialog).getByLabelText(label),{target:{value:'Synthetic-password-123'}});
 let finish;const original=api.getMockImplementation();api.mockImplementation((p,o)=>p==='/api/v1/admin/users'?new Promise(resolve=>{finish=resolve;}):original(p,o));
 const button=within(dialog).getByRole('button',{name:'Create account'});fireEvent.click(button);fireEvent.click(button);
 expect(api.mock.calls.filter(([p])=>p==='/api/v1/admin/users')).toHaveLength(1);
 expect(api).toHaveBeenCalledWith('/api/v1/admin/users',{method:'POST',body:JSON.stringify({username:'verified-teacher',password:'Synthetic-password-123',role:'TEACHER',childIds:[]})});
 finish({id:'created'});await screen.findByText(/Account created/);expect(screen.queryByRole('dialog')).toBeNull();
});
it('requires matching passwords and explicit existing-child selection before Parent provisioning',async()=>{
 mount(true);await loaded();fireEvent.click(screen.getByRole('button',{name:'Add Parent'}));
 const dialog=screen.getByRole('dialog');await within(dialog).findByRole('checkbox');
 fireEvent.change(within(dialog).getByLabelText('Username'),{target:{value:'verified-parent'}});
 fireEvent.change(within(dialog).getByLabelText('Initial password'),{target:{value:'Synthetic-password-123'}});
 fireEvent.change(within(dialog).getByLabelText('Confirm password'),{target:{value:'Different-password-123'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Create account'}));expect(within(dialog).getByRole('alert').textContent).toContain('Passwords do not match');
 fireEvent.change(within(dialog).getByLabelText('Confirm password'),{target:{value:'Synthetic-password-123'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Create account'}));expect(within(dialog).getByRole('alert').textContent).toContain('Select at least one verified existing child');
 expect(api.mock.calls.some(([p])=>p==='/api/v1/admin/users')).toBe(false);
 fireEvent.click(within(dialog).getByRole('checkbox'));fireEvent.click(within(dialog).getByRole('button',{name:'Create account'}));
 await screen.findByText(/Account created/);
 const body=JSON.parse(api.mock.calls.find(([p])=>p==='/api/v1/admin/users')[1].body);
 expect(body.role).toBe('PARENT');expect(body.childIds).toEqual([child.id]);expect(body).not.toHaveProperty('centerId');
});
it('shows empty lists, empty filtered results and network failures without stale records',async()=>{
 api.mockResolvedValue([]);mount();await screen.findByText('No teacher accounts in your center yet.');
 fireEvent.change(screen.getByLabelText('Search teachers'),{target:{value:'nobody'}});await screen.findByText('No accounts match these filters.');
 api.mockRejectedValue(Error('Cannot reach ChildGuard API. Check your connection and try again.'));
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach ChildGuard API');
});
it('cancels onboarding without persisting or retaining password fields',async()=>{
 mount();await loaded();fireEvent.click(screen.getByRole('button',{name:'Add Teacher'}));
 fireEvent.change(screen.getByLabelText('Initial password'),{target:{value:'Synthetic-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fireEvent.click(screen.getByRole('button',{name:'Add Teacher'}));
 expect(screen.getByLabelText('Initial password').value).toBe('');expect(api.mock.calls.some(([p])=>p==='/api/v1/admin/users')).toBe(false);
});
