import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import RfidCards from './RfidCards';
import {api} from '../lib/api';
const listeners=new Set();
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('../lib/monitoring-events',()=>({
 monitoringTopics:path=>path.startsWith('/api/v1/admin/rfid')?['devices','attendance']:[],
 monitoringEvents:{subscribe:fn=>{listeners.add(fn);fn({live:true});return()=>listeners.delete(fn);}},
}));
const child={id:'child-a',name:'Demo child'},other={id:'child-b',name:'Other child'};
const path='/api/v1/admin/rfid/children/child-a';
let data,changed;
const tick=ms=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
const event=()=>act(()=>{for(const fn of listeners)fn({live:true,topics:['devices']});});
const readCount=()=>api.mock.calls.filter(([p,o])=>p===path&&!o?.method).length;
const savedCard={id:'new-card',status:'ACTIVE',maskedUid:'masked-1234',issuedAt:'2026-10-29T03:01:00Z',reader:{hardwareId:'DEMO-READER'},issuedBy:{username:'Demo Admin'}};
function success(){data={cards:[savedCard],enrollment:{...data.enrollment,status:'SUCCESS'}};}
async function mount(){const view=render(<RfidCards child={child} onAssignmentChange={changed}/>);await tick(0);return view;}
async function start(){
 fireEvent.change(screen.getByLabelText('Enrollment reader'),{target:{value:'reader-a'}});
 fireEvent.click(screen.getByRole('button',{name:'Issue RFID Card'}));await tick(0);await tick(0);
 expect(screen.getByText(/Waiting for card scan/)).toBeTruthy();
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));api.mockReset();changed=vi.fn();data={cards:[],enrollment:null};
 vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.spyOn(navigator,'onLine','get').mockReturnValue(true);vi.spyOn(window,'confirm').mockReturnValue(true);
 api.mockImplementation(async(p,o)=>{
  if(p.endsWith('/readers'))return [{id:'reader-a',hardwareId:'DEMO-READER',active:true,online:true}];
  if(p===path)return structuredClone(data);
  if(p.endsWith('/child-b'))return {cards:[],enrollment:null};
  if(p.endsWith('/cancel')){data.enrollment.status='CANCELLED';return {cancelled:true};}
  if(p.endsWith('/enrollment')&&o?.method==='POST'){
   data.enrollment={id:'enrollment-a',readerId:'reader-a',status:'PENDING',expiresAt:new Date(Date.now()+60000).toISOString()};return {...data.enrollment};
  }
  throw Error('Unexpected fixture request');
 });
});
afterEach(()=>{cleanup();expect(listeners.size).toBe(0);vi.useRealTimers();vi.restoreAllMocks();});

it('starts waiting, then SSE refetches committed success without a user refresh or a second success effect',async()=>{
 await mount();await start();const count=readCount();success();event();event();await tick(101);await tick(0);
 expect(readCount()).toBeGreaterThan(count);expect(screen.queryByText(/Waiting for card scan/)).toBeNull();
 expect(screen.getAllByText('Card successfully enrolled.')).toHaveLength(1);expect(screen.getAllByText(/masked-1234.*Issued/)).toHaveLength(2);
 expect(screen.getByRole('button',{name:'Replace RFID Card'})).toBeTruthy();expect(screen.getByRole('button',{name:'Revoke RFID Card'})).toBeTruthy();
 await tick(2100);event();await tick(101);
 expect(changed.mock.calls.filter(([,status])=>status==='ASSIGNED')).toHaveLength(1);
 expect(screen.getAllByText('Card successfully enrolled.')).toHaveLength(1);
});
it('keeps a one-second child-only fallback even with live SSE, and stops fast polling on success',async()=>{
 await mount();await start();const count=readCount(),readerCount=api.mock.calls.filter(([p])=>p.endsWith('/readers')).length;
 success();await tick(1001);await tick(0);
 expect(screen.getByText('Card successfully enrolled.')).toBeTruthy();expect(readCount()).toBeGreaterThan(count);
 const completed=readCount();await tick(5000);expect(readCount()).toBe(completed);
 expect(api.mock.calls.filter(([p])=>p.endsWith('/readers'))).toHaveLength(readerCount);
});
it('does not show expiry from a local deadline and accepts server success near sixty seconds',async()=>{
 await mount();await start();await tick(59500);
 expect(screen.getByText(/Waiting for card scan/)).toBeTruthy();success();await tick(1001);await tick(0);
 expect(screen.getByText('Card successfully enrolled.')).toBeTruthy();expect(screen.queryByText(/Enrollment expired/)).toBeNull();
});
it.each(['EXPIRED','REJECTED'])('ends fast polling on the server %s state',async status=>{
 await mount();await start();data.enrollment.status=status;await tick(1001);await tick(0);
 expect(screen.getByText(new RegExp(`Enrollment ${status.toLowerCase()}`))).toBeTruthy();expect(screen.queryByText(/Waiting for card scan/)).toBeNull();
 const count=readCount();await tick(5000);expect(readCount()).toBe(count);
});
it('cancels through the server, without overwriting a success that won the cancel race',async()=>{
 await mount();await start();fireEvent.click(screen.getByRole('button',{name:'Cancel enrollment'}));await tick(0);await tick(0);
 expect(screen.getByText(/Enrollment cancelled/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Retry enrollment'}));await tick(0);await tick(0);success();
 api.mockImplementationOnce(async()=>({cancelled:false}));fireEvent.click(screen.getByRole('button',{name:'Cancel enrollment'}));await tick(0);await tick(0);
 expect(screen.getByText('Card successfully enrolled.')).toBeTruthy();
});
it('ignores an old child response and cleans timers/listeners on unmount',async()=>{
 const view=await mount();await start();let finish;
 api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await tick(1000);
 view.rerender(<RfidCards child={other} onAssignmentChange={changed}/>);await tick(0);
 await act(async()=>finish({cards:[savedCard],enrollment:{status:'SUCCESS'}}));
 expect(screen.queryByText('Card successfully enrolled.')).toBeNull();expect(screen.queryByText(/masked-1234/)).toBeNull();
 view.unmount();const count=api.mock.calls.length;await tick(61000);expect(api).toHaveBeenCalledTimes(count);expect(listeners.size).toBe(0);
});
it('retains waiting data during failed reads, backs off and recovers without false success',async()=>{
 await mount();await start();const original=api.getMockImplementation();api.mockImplementation(async(p,o)=>{if(p===path)throw Error('Network unavailable');return original(p,o);});
 const count=readCount();await tick(15000);
 expect(readCount()-count).toBeLessThanOrEqual(5);expect(screen.queryByText('Card successfully enrolled.')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();
 expect(screen.getByText(/Waiting for card scan/)).toBeTruthy();api.mockImplementation(original);success();await tick(8100);await tick(0);
 expect(screen.getByText('Card successfully enrolled.')).toBeTruthy();
});
it('updates a replacement immediately while retaining the old card history',async()=>{
 data.cards=[{...savedCard,id:'old-card',maskedUid:'masked-old'}];await mount();
 fireEvent.change(screen.getByLabelText('Enrollment reader'),{target:{value:'reader-a'}});fireEvent.click(screen.getByRole('button',{name:'Replace RFID Card'}));await tick(0);await tick(0);
 success();data.cards.push({...savedCard,id:'old-card',maskedUid:'masked-old',status:'REPLACED'});event();await tick(101);await tick(0);
 expect(screen.getByText('Card successfully enrolled.')).toBeTruthy();expect(screen.getByText(/masked-old.*replaced/)).toBeTruthy();
 expect(JSON.parse(api.mock.calls.find(([p])=>p.endsWith('/enrollment'))[1].body).mode).toBe('REPLACE');
});
