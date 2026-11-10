import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Alerts from '../pages/Alerts';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
const now=Date.parse('2026-10-25T10:00:00Z');
let row,result,visible,online;
const tick=async(ms=250)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
const mount=()=>render(<MemoryRouter><Alerts/></MemoryRouter>);
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);visible=true;online=true;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>!visible);vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
 row={id:'alert',kind:'DANGER_ZONE_NEAR',category:'BLE_DANGER',state:'RECORDED',severity:null,createdAt:new Date(now).toISOString(),assessment:{verification:'UNVERIFIED',note:'Recorded experimental BLE evidence does not confirm an incident.'},location:null,event:{id:'event',eventId:'firmware-event',eventType:'DANGER_ZONE_NEAR',recordedChild:{id:'historical-child',name:'Recorded child'},attribution:'STORED_CHILD',device:{id:'12345678-1234-4234-8234-123456789abc',hardwareId:'CG-BELT'},observedAt:new Date(now-120000).toISOString(),receivedAt:new Date(now).toISOString(),timingBasis:'STORED_OBSERVATION',payload:{rssi:-40,gpsStatus:'GPS_NO_FIX',proximity:'NEAR'},zone:{kind:'DANGER_ZONE',hardwareId:'ZONE-ONE',name:'Original label',location:'Recorded corner',labelsSource:'EVENT_SNAPSHOT',observedUuid:'previous-uuid',identityChanged:true}}};
 result={rows:[row],total:1,hasMore:false};api.mockReset().mockImplementation(async path=>path.startsWith('/api/v1/alerts?')?result:{events:[],hasMore:false,until:new Date(now).toISOString()});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('shows only the four requested filter fields, preserves recorded alerts and sends no status parameter',async()=>{
 mount();await tick();
 expect(screen.queryByLabelText('Status')).toBeNull();expect(screen.queryByRole('option',{name:'Recorded',exact:true})).toBeNull();expect(screen.queryByRole('option',{name:'All supported states'})).toBeNull();
 const tools=screen.getByLabelText('Search child or device').closest('.al-tools');
 expect([...tools.querySelectorAll('label')].map(label=>label.childNodes[0].textContent)).toEqual(['Search child or device','Alert Type','From Date','To Date']);expect(within(tools).getAllByRole('combobox')).toHaveLength(1);expect(within(tools).getByRole('button',{name:'Refresh alerts'})).toBeTruthy();
 expect(within(screen.getByRole('region',{name:'Safety alert count'})).getByText('Safety Alerts')).toBeTruthy();expect(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'})).toBeTruthy();
 for(const [path] of api.mock.calls){const q=new URLSearchParams(path.split('?')[1]);expect(q.has('state')).toBe(false);expect(q.has('status')).toBe(false);}
 fireEvent.click(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'}));expect(within(screen.getByRole('dialog')).getByText(/State: RECORDED/)).toBeTruthy();
});
it('shows recorded safety evidence and explicit unsupported capabilities without fabricated severity or open states',async()=>{
 mount();await tick();expect(screen.getByText('Danger-zone alert')).toBeTruthy();expect(screen.getByText('Geofence: blocked.')).toBeTruthy();expect(screen.getByText('Tamper: physical loop monitoring.')).toBeTruthy();expect(screen.getByText('Bluetooth alert checks are not confirmed.')).toBeTruthy();expect(screen.queryByRole('button',{name:/acknowledge/i})).toBeNull();expect(screen.queryByRole('option',{name:'OPEN'})).toBeNull();expect(screen.getByRole('link',{name:'Review actual activity and existing policy'}).getAttribute('href')).toBe('/activity');
 fireEvent.click(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'}));const d=screen.getByRole('dialog');expect(within(d).getByText(/Verification: UNVERIFIED. State: RECORDED. Severity: not classified/)).toBeTruthy();expect(within(d).getByText('Recorded child (historical-child)')).toBeTruthy();expect(within(d).getAllByText(/Original label \/ Recorded corner/)[0]).toBeTruthy();expect(within(d).getByText(/Beacon identity has changed/)).toBeTruthy();expect(within(d).getByText(/A last-known position is never substituted/)).toBeTruthy();expect(within(d).getByText(/Event observed/)).toBeTruthy();expect(within(d).getByText(/Event received/)).toBeTruthy();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('displays actual numeric zero GPS as historical event evidence and no invented boundary or accuracy',async()=>{
 row.location={latitude:0,longitude:0,observedAt:row.event.observedAt,receivedAt:row.event.receivedAt};mount();await tick();fireEvent.click(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'}));expect(screen.getByText('0, 0')).toBeTruthy();expect(screen.getByText(/Historical record evidence, not a live position or proof of a new geofence violation/)).toBeTruthy();expect(screen.queryByText(/Accuracy:/)).toBeNull();
});
it('shows a saved wearable connection warning in amber with real communication times and no invented Wi-Fi diagnosis',async()=>{
 row.kind='WEARABLE_CONNECTION_LOST';row.category='DEVICE_SIGNAL';row.event.zone=null;row.connection={lastCommunicationAt:new Date(now-120000).toISOString(),detectedAt:new Date(now).toISOString()};
 row.assessment={verification:'BACKEND_COMMUNICATION_TIMEOUT',note:'Cause unknown.'};
 mount();await tick();const button=screen.getByRole('button',{name:'View details: WEARABLE_CONNECTION_LOST'});
 expect(button.className).toContain('al-tone--medium');expect(screen.getByText('Wearable Connection Lost')).toBeTruthy();expect(screen.getByText(/Last communication:/)).toBeTruthy();
 fireEvent.click(button);const dialog=screen.getByRole('dialog');expect(within(dialog).getByText(/Connection warning recorded:/)).toBeTruthy();expect(within(dialog).getByText(/Wearable has stopped communicating with ChildGuard/)).toBeTruthy();expect(within(dialog).queryByText(/Wi-Fi disconnected/)).toBeNull();expect(api.mock.calls.every(([,options])=>!options.method)).toBe(true);
});
it('renders a genuine geofence boundary snapshot and filters its category without claiming GPS accuracy',async()=>{
 row.kind='GEOFENCE_OUTSIDE';row.category='GEOFENCE';row.geofence={name:'Recorded boundary',latitude:6.9,longitude:79.8,radiusM:100,revision:2,distanceM:140};row.assessment={verification:'CLASSROOM_PROTOTYPE',note:'Qualified device-reported GNSS, not guaranteed accuracy.'};
 mount();await tick();fireEvent.change(screen.getByLabelText('Alert Type'),{target:{value:'GEOFENCE'}});await tick();expect(api.mock.calls.at(-1)[0]).toContain('category=GEOFENCE');fireEvent.click(screen.getByRole('button',{name:'View details: GEOFENCE_OUTSIDE'}));expect(screen.getByText(/Recorded boundary \/ radius 100 meters \/ revision 2/)).toBeTruthy();expect(screen.getByText(/Recorded distance 140.00 meters/)).toBeTruthy();
});
it('renders partial stored activity details without converting missing metrics to zero or a medical interpretation',async()=>{
 row.kind='LOW_ACTIVITY';row.category='ACTIVITY';row.activity={currentScoreMg:12,baselineScoreMg:null,period:null};row.assessment={verification:'MOVEMENT_OBSERVATION',note:'Stored movement comparison, not a diagnosis.'};mount();await tick();fireEvent.click(screen.getByRole('button',{name:'View details: LOW_ACTIVITY'}));expect(screen.getByText(/Current: 12.00 mg MAD; personal baseline: Not recorded/)).toBeTruthy();expect(screen.getByText(/not a medical interpretation/)).toBeTruthy();expect(screen.getByText(/Timezone not recorded/)).toBeTruthy();
});
it('uses bounded search/category/date filters without a status restriction and server pagination',async()=>{
 result.hasMore=true;mount();await tick();fireEvent.change(screen.getByLabelText('Search child or device'),{target:{value:'Recorded child'}});fireEvent.change(screen.getByLabelText('Alert Type'),{target:{value:'BLE_DANGER'}});fireEvent.change(screen.getByLabelText('From Date'),{target:{value:'2026-10-24'}});fireEvent.change(screen.getByLabelText('To Date'),{target:{value:'2026-10-24'}});await tick();let q=new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]);expect(Object.fromEntries(q)).toMatchObject({management:'true',search:'Recorded child',category:'BLE_DANGER',from:'2026-10-24',to:'2026-10-24',limit:'25',offset:'0'});fireEvent.click(screen.getByRole('button',{name:'Next alerts'}));await tick();q=new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]);expect(q.get('offset')).toBe('25');expect(q.has('state')).toBe(false);expect(q.has('status')).toBe(false);expect(screen.getByText('Page 2')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Refresh alerts'}));await tick(0);expect(new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]).toString()).toBe(q.toString());fireEvent.click(screen.getByRole('button',{name:'Previous alerts'}));await tick();expect(screen.getByText('Page 1')).toBeTruthy();
});
it('polls only reads, pauses hidden/offline tabs and details, and never renews Admin inactivity',async()=>{
 mount();await tick();await tick(3000);expect(api).toHaveBeenCalledTimes(2);visible=false;act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(60000);expect(api).toHaveBeenCalledTimes(2);visible=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(0);expect(api).toHaveBeenCalledTimes(3);online=false;act(()=>window.dispatchEvent(new Event('offline')));await tick(60000);expect(api).toHaveBeenCalledTimes(3);online=true;act(()=>window.dispatchEvent(new Event('online')));await tick(0);fireEvent.click(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'}));const count=api.mock.calls.length;await tick(60000);expect(api).toHaveBeenCalledTimes(count);expect(api.mock.calls.every(([p,o])=>p.startsWith('/api/v1/alerts?')&&!o.method&&!p.includes('/auth/activity'))).toBe(true);
});
it('aborts obsolete search requests and ignores late results',async()=>{
 let finish;api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));mount();await tick();const signal=api.mock.calls[0][1].signal;fireEvent.change(screen.getByLabelText('Search child or device'),{target:{value:'new'}});await tick();expect(signal.aborted).toBe(true);await act(async()=>finish({rows:[{...row,kind:'OBSOLETE'}],total:1}));expect(screen.queryByText('OBSOLETE')).toBeNull();expect(screen.getByText('Danger-zone alert')).toBeTruthy();
});
it('opens the existing read-only event-history component instead of duplicating history',async()=>{
 mount();await tick();fireEvent.click(screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'}));screen.getByRole('button',{name:'View device update history'}).focus();fireEvent.click(screen.getByRole('button',{name:'View device update history'}));await tick(0);expect(api.mock.calls.at(-1)[0]).toContain('/api/v1/events?');expect(api.mock.calls.at(-1)[0]).toContain(row.event.device.id);expect(screen.getByRole('dialog')).toBeTruthy();expect(document.querySelector('[aria-labelledby="safety-details-title"]').getAttribute('aria-modal')).toBe('false');fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Close dialog'}));expect(screen.getByRole('dialog',{name:'Safety Alert Details'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('button',{name:'View device update history'}));expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);
});
it.each([401,403])('stops polling on authorization status %s',async status=>{
 api.mockRejectedValue(Object.assign(Error('Sign in required'),{status}));mount();await tick();expect(screen.getByRole('alert').textContent).toContain(status===401?'Your session has ended':'You do not have permission');const count=api.mock.calls.length;await tick(120000);expect(api).toHaveBeenCalledTimes(count);
});
it('shows empty and failed reads without declaring safety or displaying old observations as live',async()=>{
 result.rows=[];result.total=0;mount();await tick();expect(screen.getByText(/No recorded alerts match this view. This does not establish that children are safe/)).toBeTruthy();api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh alerts'}));await tick(0);expect(screen.getByRole('alert').textContent).toContain('Cannot reach ChildGuard API');expect(screen.queryByText('Danger-zone alert')).toBeNull();
});

it('saved tamper danger uses red styling and friendly details without pretending reconnection dismisses it',async()=>{
 row.kind='TAMPER_LOOP_OPEN';row.category='TAMPER';row.severity='DANGER';row.event.zone=null;row.assessment={verification:'AUTHENTICATED_GPIO_LOOP',note:'Physical GPIO loop observation.'};
 mount();await tick();const button=screen.getByRole('button',{name:'View details: TAMPER_LOOP_OPEN'});expect(button.className).toContain('al-tone--high');
 fireEvent.click(button);expect(within(screen.getByRole('dialog')).getByText(/tamper loop was disconnected/)).toBeTruthy();expect(screen.getByText(/Reconnection does not dismiss this alert/)).toBeTruthy();
});

it('polling adds a separate non-Gate danger alert with its own zone label while retaining the Gate alert',async()=>{
 const gate={...row,id:'gate-alert',event:{...row.event,zone:{...row.event.zone,kind:'GATE',name:'Configured gate',hardwareId:'REGISTERED-GATE'}}};
 result.rows=[gate];mount();await tick();
 const original=screen.getByRole('button',{name:'View details: DANGER_ZONE_NEAR'});
 result.rows=[row,gate];result.total=2;
 await tick(3000);
 const alerts=screen.getAllByRole('button',{name:'View details: DANGER_ZONE_NEAR'});
 expect(alerts).toHaveLength(2);expect(alerts).toContain(original);
 fireEvent.click(alerts[0]);
 const dialog=screen.getByRole('dialog');
 expect(within(dialog).getAllByText(/Original label/).length).toBeGreaterThan(0);
 expect(within(dialog).queryByText(/Configured gate/)).toBeNull();
 expect(within(dialog).getByText('Recorded child (historical-child)')).toBeTruthy();
});
