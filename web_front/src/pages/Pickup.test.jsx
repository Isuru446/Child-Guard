import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pickup from './Pickup';
import { api } from '../lib/api';

vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../components/Topbar',()=>({default:()=>null}));
vi.mock('../components/Footer',()=>({default:()=>null}));
let row,visible,online;
const tick=async(ms=200)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
const mount=()=>render(<MemoryRouter><Pickup/></MemoryRouter>);
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));visible=true;online=true;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>!visible);vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
 row={id:'12345678-1234-4234-8234-123456789abc',child:{id:'child',name:'Actual Child'},personId:'person',person:{fullName:'Authorized Grandparent',address:'Saved residential address',phone:'077 123 4567',relationship:'Grandparent'},photoAvailable:true,status:'PENDING',day:'2026-10-25',windowStart:'2026-10-25T08:00:00Z',windowEnd:'2026-10-25T09:00:00Z',expiresAt:'2026-10-25T09:00:00Z',createdAt:'2026-10-25T08:00:00Z',requestedBy:{username:'actual-parent'},reviewedBy:null};
 api.mockReset().mockImplementation(async path=>{
  if(path.includes('?')){const q=new URLSearchParams(path.split('?')[1]);return {rows:(!q.get('status')||q.get('status')===row.status)&&q.get('offset')!=='25'?[structuredClone(row)]:[],summary:{total:1,PENDING:row.status==='PENDING'?1:0,COMPLETED:row.status==='COMPLETED'?1:0,CANCELLED:0,EXPIRED:0,REJECTED:0},hasMore:q.get('offset')!=='25'};}
  return structuredClone(row);
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});

it('loads authenticated backend records/counts and never presents mock pickup codes or demo records',async()=>{
 mount();await tick();expect(screen.getByText('Actual Child')).toBeTruthy();expect(screen.getByText('Authorized Grandparent')).toBeTruthy();expect(screen.getByText('actual-parent')).toBeTruthy();
 expect(screen.queryByText(/Demonstration only/)).toBeNull();expect(screen.queryByText('Pickup Code')).toBeNull();
 expect(screen.getByRole('img').getAttribute('src')).toBe(`/api/v1/admin/pickups/${row.id}/photo`);
 expect(api.mock.calls.every(([path,options])=>path.startsWith('/api/v1/admin/pickups?')&&!options.method)).toBe(true);
});
it('filters loaded real records without searching for or exposing verification codes',async()=>{
 mount();await tick();fireEvent.change(screen.getByLabelText('Search pickup records'),{target:{value:'unmatched'}});expect(screen.queryByText('Actual Child')).toBeNull();
 fireEvent.change(screen.getByLabelText('Search pickup records'),{target:{value:'grandparent'}});expect(screen.getByText('Actual Child')).toBeTruthy();expect(api).toHaveBeenCalledTimes(1);
});
it('requests day/status/history/page filters from the existing scoped read API',async()=>{
 mount();await tick();fireEvent.change(screen.getByLabelText('Pickup status'),{target:{value:'EXPIRED'}});await tick();expect(api.mock.calls.at(-1)[0]).toContain('status=EXPIRED');
 fireEvent.change(screen.getByLabelText('Pickup date'),{target:{value:'2026-10-24'}});await tick();expect(api.mock.calls.at(-1)[0]).toContain('day=2026-10-24');
 fireEvent.click(screen.getByRole('button',{name:'All dates'}));await tick();expect(api.mock.calls.at(-1)[0]).not.toContain('day=');
 fireEvent.change(screen.getByLabelText('Pickup status'),{target:{value:''}});await tick();fireEvent.click(screen.getByRole('button',{name:'Next pickups'}));await tick();expect(api.mock.calls.at(-1)[0]).toContain('offset=25');
});
it('reads real details, saved address/phone and completion actor without any Admin handover action',async()=>{
 row.status='COMPLETED';row.reviewedBy={username:'actual-teacher'};row.completedAt='2026-10-25T08:10:00Z';mount();await tick();
 fireEvent.click(screen.getByRole('button',{name:'View Actual Child information'}));await tick();
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByText('Saved residential address')).toBeTruthy();expect(within(dialog).getByText('actual-teacher')).toBeTruthy();expect(within(dialog).getByText('Completed')).toBeTruthy();
 expect(within(dialog).queryByRole('button',{name:/approve|verify|complete pickup/i})).toBeNull();
 expect(api.mock.calls.some(([path])=>path===`/api/v1/admin/pickups/${row.id}`)).toBe(true);
 fireEvent.keyDown(document,{key:'Escape'});await tick();expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows storage-unavailable errors instead of counts or fabricated success data',async()=>{
 api.mockRejectedValue(Object.assign(Error('Approved pickup setup is pending'),{status:503,code:'PICKUP_NOT_INSTALLED'}));mount();await tick();
 expect(screen.getByRole('alert').textContent).toContain('Pickup records unavailable');expect(screen.getByText('Unavailable')).toBeTruthy();expect(screen.queryByText('Actual Child')).toBeNull();
 expect(screen.queryByText(/Demonstration only/)).toBeNull();
});
it('polls status changes only while visible/online without renewing Admin inactivity',async()=>{
 mount();await tick();row.status='CANCELLED';await tick(15000);expect(screen.getByText('Cancelled')).toBeTruthy();
 visible=false;act(()=>document.dispatchEvent(new Event('visibilitychange')));const before=api.mock.calls.length;await tick(30000);expect(api).toHaveBeenCalledTimes(before);
 visible=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick();expect(api.mock.calls.length).toBeGreaterThan(before);
 online=false;act(()=>window.dispatchEvent(new Event('offline')));const paused=api.mock.calls.length;await tick(30000);expect(api).toHaveBeenCalledTimes(paused);
 expect(api.mock.calls.every(([path,options])=>!path.includes('/auth/activity')&&!options.method)).toBe(true);
});
it('does not render a detail response that arrives after its dialog was closed',async()=>{
 const initial=api.getMockImplementation();let finish;api.mockImplementation((path,options)=>path.includes('?')?initial(path,options):new Promise(resolve=>{finish=resolve;}));
 mount();await tick();fireEvent.click(screen.getByRole('button',{name:'View Actual Child information'}));await tick();fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));
 await act(async()=>finish({...row,person:{...row.person,address:'Late secret address'}}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('Late secret address')).toBeNull();
});
it('retains an honest empty state when no requests exist',async()=>{
 api.mockResolvedValue({rows:[],summary:{total:0,PENDING:0,COMPLETED:0,CANCELLED:0,EXPIRED:0,REJECTED:0},hasMore:false});mount();await tick();
 expect(screen.getByText('No matching pickup records in this view.')).toBeTruthy();expect(screen.getByRole('button',{name:'Next pickups'}).disabled).toBe(true);
});
