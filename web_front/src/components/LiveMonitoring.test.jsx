import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveDevices from './LiveDevices';
import DeviceGps from './DeviceGps';
import DeviceEventHistory from './DeviceEventHistory';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
let device,visible,online,recorded;
const now=Date.parse('2026-10-25T10:00:00Z');
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);visible=true;online=true;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>!visible);vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
 device={id:'12345678-1234-4234-8234-123456789abc',hardwareId:'CG-LIVE',active:true,lastSeen:new Date(now).toISOString(),currentAssignment:{child:{id:'new-child',name:'Current child'}},beaconStates:[],monitoring:{serverTime:new Date(now).toISOString()},gpsMonitoring:{latestStatus:'GPS_NO_FIX',staleAfterMs:60000,lastValidLocation:{latitude:6.9,longitude:79.8,state:'HISTORICAL',receivedAt:new Date(now-120000).toISOString(),observedAt:new Date(now-120000).toISOString(),timingBasis:'STORED_OBSERVATION',recordedChild:{id:'old-child',name:'Previous child'},recordedChildId:'old-child',attribution:'STORED_CHILD'}}};
 recorded={id:'stored-event',eventType:'BLE_PROXIMITY',receivedAt:new Date(now-1000).toISOString(),observedAt:new Date(now-1000).toISOString(),timingBasis:'STORED_OBSERVATION',recordedChild:{id:'old-child',name:'Previous child'},attribution:'STORED_CHILD',payload:{proximity:'FAR',rssi:-90},alerts:[]};
 api.mockImplementation(async path=>path.startsWith('/api/v1/devices?')?[device]:{deviceId:device.id,hardwareId:device.hardwareId,events:[recorded],hasMore:true,until:new Date(now).toISOString(),serverTime:new Date(now).toISOString(),windowStart:new Date(now-86400000).toISOString()});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
const tick=async ms=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
const mount=()=>render(<MemoryRouter><LiveDevices/></MemoryRouter>);
it('renders genuine historical GPS separately from the current child and never fabricates a new position',async()=>{
 mount();await tick(250);expect(screen.getByText('Current child')).toBeTruthy();expect(screen.getByText(/Historical \/ last valid position: 6.9, 79.8/)).toBeTruthy();expect(screen.getByText(/Recorded child: Previous child/)).toBeTruthy();expect(screen.getByText('GPS status in recent events: GPS_NO_FIX')).toBeTruthy();expect(screen.queryByText(/Recent reported fix:/)).toBeNull();
});
it('ages recent GPS fixes into historical observations without refreshing or changing coordinates',async()=>{
 device.connectionState='ONLINE';device.gpsMonitoring.lastValidLocation.recordedChildId=device.currentAssignment.child.id;device.gpsMonitoring.lastValidLocation.recordedChild=device.currentAssignment.child; device.gpsMonitoring.latestStatus='GPS_FIX';device.gpsMonitoring.lastValidLocation.state='RECENT';device.gpsMonitoring.lastValidLocation.observedAt=new Date(now).toISOString();
 render(<DeviceGps device={device} now={now}/>);expect(screen.getByText(/Recent reported fix/)).toBeTruthy();cleanup();render(<DeviceGps device={device} now={now+61000}/>);expect(screen.getByText(/Historical \/ last valid position/)).toBeTruthy();
});
it.each([null,{latitude:null,longitude:null},{latitude:6.9},{latitude:'0',longitude:79},{latitude:91,longitude:79}])('does not replace unavailable/invalid GPS with zero coordinates: %j',location=>{
 device.gpsMonitoring.lastValidLocation=location;render(<DeviceGps device={device} now={now}/>);expect(screen.getByText('No valid location found in the 24-hour monitoring window.')).toBeTruthy();expect(screen.queryByText(/0, 0/)).toBeNull();
});
it('displays numeric zero coordinates only when actually provided as a valid pair',()=>{
 device.gpsMonitoring.lastValidLocation={...device.gpsMonitoring.lastValidLocation,latitude:0,longitude:0};render(<DeviceGps device={device} now={now}/>);expect(screen.getByText(/position: 0, 0/)).toBeTruthy();
});
it('polls only read endpoints, pauses hidden/offline tabs and never calls session activity',async()=>{
 mount();await tick(250);expect(api).toHaveBeenCalledTimes(1);await tick(3000);expect(api).toHaveBeenCalledTimes(2);
 visible=false;act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(60000);expect(api).toHaveBeenCalledTimes(2);
 visible=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(0);expect(api).toHaveBeenCalledTimes(3);
 online=false;act(()=>window.dispatchEvent(new Event('offline')));await tick(60000);expect(api).toHaveBeenCalledTimes(3);
 expect(api.mock.calls.every(([p,o])=>p.startsWith('/api/v1/devices?')&&!o.method)).toBe(true);expect(api.mock.calls.some(([p])=>p.includes('/auth/activity'))).toBe(false);
});
it('aborts obsolete filter requests and ignores a late response with old devices',async()=>{
 let finish;api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));mount();await tick(250);const signal=api.mock.calls[0][1].signal;
 fireEvent.change(screen.getByLabelText('Search devices'),{target:{value:'current'}});await tick(250);expect(signal.aborted).toBe(true);expect(screen.getByText('CG-LIVE')).toBeTruthy();
 await act(async()=>{finish([{...device,hardwareId:'obsolete-device'}]);});expect(screen.queryByText('obsolete-device')).toBeNull();
});
it('shows network errors without displaying old readings as live data',async()=>{
 mount();await tick(250);api.mockRejectedValue(Error('Cannot reach ChildGuard API.'));fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await tick(0);expect(screen.getByRole('alert').textContent).toContain('Cannot reach ChildGuard API');expect(screen.getByRole('cell',{name:'CG-LIVE'})).toBeTruthy();expect(screen.getByText('Updates unavailable')).toBeTruthy();
});
it('shows recorded ownership, types and timestamps in history without implying an emergency',async()=>{
 render(<DeviceEventHistory device={device} onClose={vi.fn()}/>);await tick(0);expect(screen.getByText('Previous child (old-child)')).toBeTruthy();expect(screen.queryByText('Current child')).toBeNull();expect(screen.getByRole('cell',{name:'Bluetooth proximity update'})).toBeTruthy();expect(screen.getByText(/An update is not confirmation of an emergency/)).toBeTruthy();expect(screen.getByText(/FAR · -90 dBm/)).toBeTruthy();
});
it('freezes older history pages, respects pagination and preserves read-only requests',async()=>{
 render(<DeviceEventHistory device={device} onClose={vi.fn()}/>);await tick(0);fireEvent.click(screen.getByRole('button',{name:'Next events'}));await tick(0);
 const query=new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]);expect(query.get('offset')).toBe('25');expect(query.get('until')).toBe(new Date(now).toISOString());const count=api.mock.calls.length;await tick(60000);expect(api).toHaveBeenCalledTimes(count);
 fireEvent.click(screen.getByRole('button',{name:'Newest events'}));await tick(0);expect(new URLSearchParams(api.mock.calls.at(-1)[0].split('?')[1]).get('offset')).toBe('0');expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);
});
it('opens monitoring history from the existing inventory and pauses list polling behind the dialog',async()=>{
 mount();await tick(250);fireEvent.click(screen.getByRole('button',{name:'Recent events CG-LIVE'}));await tick(0);const d=screen.getByRole('dialog');expect(within(d).getByText('Previous child (old-child)')).toBeTruthy();const listCount=api.mock.calls.filter(([p])=>p.startsWith('/api/v1/devices?')).length;await tick(15000);expect(api.mock.calls.filter(([p])=>p.startsWith('/api/v1/devices?'))).toHaveLength(listCount);
 fireEvent.click(within(d).getByRole('button',{name:'Close dialog'}));await tick(250);expect(api.mock.calls.filter(([p])=>p.startsWith('/api/v1/devices?'))).toHaveLength(listCount+1);
});

it('uses the backend offline classification instead of the old hardcoded five-minute timeout',async()=>{
 device.connectionState='OFFLINE';device.lastSeen=new Date(now-130000).toISOString();mount();await tick(250);
 expect(screen.getByText('Offline')).toBeTruthy();expect(screen.queryByText('No recent update')).toBeNull();
});

it('keeps card, row, details and scroll nodes stable through more than 60 seconds of refresh',async()=>{
 mount();await tick(250);
 const row=screen.getByRole('cell',{name:'CG-LIVE'}).closest('tr');
 const cards=document.querySelector('.dv-stats-grid');
 const details=document.querySelector('.dv-telemetry-details');details.open=true;
 const scroll=document.querySelector('.cg-data-table__scroll');scroll.scrollLeft=120;
 for(let i=0;i<25;i++){
  let finish;
  api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await tick(3000);
  expect(row.isConnected).toBe(true);
  expect(screen.getByRole('cell',{name:'CG-LIVE'}).closest('tr')).toBe(row);
  expect(document.querySelector('.dv-stats-grid')).toBe(cards);
  expect(details.open).toBe(true);expect(scroll.scrollLeft).toBe(120);
  expect(screen.queryByText('Refreshing monitoring?')).toBeNull();
  await act(async()=>finish([{...device,currentAssignment:{child:{id:'new-child',name:`Updated child ${i}`}}}]));
  expect(screen.getByRole('cell',{name:`Updated child ${i}`})).toBeTruthy();
 }
 expect(api).toHaveBeenCalledTimes(26);
});
it('preserves rows while manually refreshing and clears them on authorization loss',async()=>{
 mount();await tick(250);const row=screen.getByRole('cell',{name:'CG-LIVE'}).closest('tr');let fail;
 api.mockImplementationOnce(()=>new Promise((resolve,reject)=>{fail=reject;}));
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await tick(0);
 expect(screen.getByText('Refreshing...')).toBeTruthy();expect(row.isConnected).toBe(true);
 await act(async()=>fail(Object.assign(Error('Forbidden'),{status:403})));
 expect(screen.queryByRole('cell',{name:'CG-LIVE'})).toBeNull();
});
