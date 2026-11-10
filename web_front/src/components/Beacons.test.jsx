import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Beacons from '../pages/Beacons';
import BeaconObservations from './BeaconObservations';
import Alerts from '../pages/Alerts';
import { api } from '../lib/api';
import { monitoringEvents } from '../lib/monitoring-events';
vi.mock('../lib/api',()=>({api:vi.fn()}));
const zone={id:'zone-db',hardwareId:'CG-DZ-01',name:'Pool beacon',location:'Pool fence',description:'Water boundary',kind:'DANGER_ZONE',serviceUuid:'7b700002-24a6-4a25-9d3b-21c547a10001',entryRssi:-63,exitRssi:-69,attendanceRssi:null,active:true,registrationStatus:'REGISTERED',observation:{proximity:'UNKNOWN',stale:true}};
let rows,role;
const mount=node=>render(<MemoryRouter>{node}</MemoryRouter>);
beforeEach(()=>{rows=[zone];role='ADMIN';vi.spyOn(window,'confirm').mockReturnValue(true);api.mockReset().mockImplementation(async(path,options)=>{
 if(path.includes('auth/me'))return {role,centerId:'center-one'};
 if(path.includes('gate-registration'))return {gate:rows.find(b=>b.kind==='GATE')||null};
 if(path.includes('pending-count'))return {count:0};
 if(options?.method==='PATCH'){const body=JSON.parse(options.body);rows=rows.map(r=>({...r,...body}));return rows[0];}
 if(options?.method==='POST'){const body=JSON.parse(options.body);const saved={...zone,...body,id:'new-db'};rows=[...rows,saved];return saved;}
 return rows;
});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('shows stored registration separately from radio and physical provisioning instructions',async()=>{
 mount(<Beacons />);expect(await screen.findByText('Pool beacon')).toBeTruthy();expect(screen.getByText('Registered')).toBeTruthy();expect(screen.getByText('Signal not available (UNKNOWN) - No recent update')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'View details'}));
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByText(zone.serviceUuid)).toBeTruthy();expect(dialog.textContent).toContain('BEACON_SERVICE_UUID');expect(dialog.textContent).toContain('Registration alone does not flash hardware');
});
it('keeps the registered-location chooser mounted when its nested beacon details close by backdrop or Escape',async()=>{
 mount(<Beacons/>);await screen.findByText('Pool beacon');fireEvent.click(screen.getByRole('button',{name:'View Registered Locations'}));
 const parent=screen.getByRole('dialog',{name:'All BLE Beacon Locations'}),trigger=within(parent).getByRole('button',{name:'View Pool beacon location'});
 parent.scrollTop=140;trigger.focus();fireEvent.click(trigger);
 let child=screen.getByRole('dialog',{name:'Beacon Location: Pool beacon'});
 expect(parent.isConnected).toBe(true);expect(parent.getAttribute('aria-modal')).toBe('false');expect(Number(child.parentElement.style.zIndex)).toBeGreaterThan(Number(parent.parentElement.style.zIndex));
 fireEvent.click(child.parentElement);expect(screen.getByRole('dialog',{name:'All BLE Beacon Locations'})).toBe(parent);expect(document.activeElement).toBe(trigger);expect(parent.scrollTop).toBe(140);
 fireEvent.click(trigger);child=screen.getByRole('dialog',{name:'Beacon Location: Pool beacon'});fireEvent.mouseDown(child);expect(child.isConnected).toBe(true);fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog',{name:'All BLE Beacon Locations'})).toBe(parent);
 expect(api.mock.calls.every(([,options])=>!options?.method)).toBe(true);
});
it('refreshes CG-DANGER-01 from a telemetry SSE invalidation and displays real measured RSSI',async()=>{
 const listeners=new Set();vi.spyOn(monitoringEvents,'subscribe').mockImplementation(fn=>{listeners.add(fn);fn({live:true});return()=>listeners.delete(fn);});
 rows=[{...zone,hardwareId:'CG-DANGER-01',serviceUuid:'6f50c597-34c5-4707-be46-a51ed3942468'}];
 mount(<Beacons/>);await screen.findByText('CG-DANGER-01');expect(screen.getByText('Unavailable')).toBeTruthy();
 rows=[{...rows[0],observation:{proximity:'NEAR',rssi:-45,stale:false,observedAt:new Date().toISOString(),wearableId:'CG-WEARABLE-001'}}];
 act(()=>{for(const notify of listeners)notify({id:'new-zone-observation',topics:['devices'],live:true});});
 expect(await screen.findByText('-45 dBm')).toBeTruthy();expect(screen.getByText('CG-WEARABLE-001')).toBeTruthy();
 expect(api.mock.calls.filter(([path])=>path.startsWith('/api/v1/beacons?')).length).toBe(2);
});
it('expires a received NEAR observation locally without waiting for another HTTP response',async()=>{
 vi.useFakeTimers();vi.spyOn(monitoringEvents,'subscribe').mockImplementation(fn=>{fn({live:true});return()=>{};});
 rows=[{...zone,observation:{proximity:'NEAR',rssi:-45,stale:false,staleAfterMs:45000,observedAt:new Date().toISOString()}}];
 mount(<Beacons/>);await act(async()=>{await vi.advanceTimersByTimeAsync(250);});expect(screen.getByText('Nearby (NEAR) - Recent')).toBeTruthy();
 await act(async()=>{await vi.advanceTimersByTimeAsync(46000);});expect(screen.getByText('Signal not available (UNKNOWN) - No recent update')).toBeTruthy();expect(screen.getByText('-45 dBm (historical)')).toBeTruthy();
 expect(api.mock.calls.filter(([path])=>path.startsWith('/api/v1/beacons?'))).toHaveLength(1);
});
it('registers a real beacon, prevents duplicate submissions and refreshes from API',async()=>{
 mount(<Beacons />);await screen.findByText('Pool beacon');fireEvent.click(screen.getByRole('button',{name:'Register Beacon'}));
 fireEvent.change(screen.getByLabelText('Beacon ID (required)'),{target:{value:'CG-DZ-02'}});fireEvent.change(screen.getByLabelText('Beacon name (required)'),{target:{value:'Stair beacon'}});fireEvent.change(screen.getByLabelText('Location / zone name (required)'),{target:{value:'Stairs'}});
 let finish;const original=api.getMockImplementation();api.mockImplementation((path,options)=>options?.method==='POST'?new Promise(resolve=>{finish=()=>{rows=[...rows,{...zone,...JSON.parse(options.body),id:'second'}];resolve(rows[1]);};}):original(path,options));
 fireEvent.click(screen.getByRole('button',{name:'Save Beacon'}));expect(screen.getByRole('button',{name:'Saving…'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Saving…'}));
 expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);const body=JSON.parse(api.mock.calls.find(([,o])=>o?.method==='POST')[1].body);expect(body.centerId).toBeUndefined();expect(body.kind).toBe('DANGER_ZONE');
 await act(async()=>finish());expect(await screen.findByText('Stair beacon')).toBeTruthy();
});
it('allows the first gate through the real form with the provisioned UUID and attendance threshold',async()=>{
 mount(<Beacons />);await screen.findByText('Pool beacon');fireEvent.click(screen.getByRole('button',{name:'Register Beacon'}));
 const select=screen.getByLabelText('Beacon Type');await waitFor(()=>expect(select.disabled).toBe(false));
 fireEvent.change(select,{target:{value:'GATE'}});
 expect(screen.getByLabelText('Beacon ID (required)').value).toBe('CG-GATE-01');expect(screen.getByLabelText('Beacon ID (required)').disabled).toBe(true);
 expect(screen.getByLabelText('Bluetooth service code (UUID, required)').value).toBe('7b700001-24a6-4a25-9d3b-21c547a10001');expect(screen.getByLabelText('Bluetooth service code (UUID, required)').disabled).toBe(true);
 expect(screen.getByLabelText('Gate check-in signal threshold (dBm)').value).toBe('-55');
 expect(screen.getByRole('dialog').textContent).toContain('Registration does not configure hardware');
 fireEvent.change(screen.getByLabelText('Beacon name (required)'),{target:{value:'Main gate'}});fireEvent.change(screen.getByLabelText('Location / zone name (required)'),{target:{value:'Entrance'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Beacon'}));await screen.findByText('Main gate');
 const body=JSON.parse(api.mock.calls.find(([,o])=>o?.method==='POST')[1].body);
 expect(body).toMatchObject({kind:'GATE',hardwareId:'CG-GATE-01',serviceUuid:'7b700001-24a6-4a25-9d3b-21c547a10001',attendanceRssi:-55,active:true});expect(body.centerId).toBeUndefined();
});
it.each([true,false])('shows existing gate even active=%s and prevents another gate or type conversion',async active=>{
 rows=[{...zone,id:'gate',hardwareId:'CG-GATE-01',kind:'GATE',name:'Main gate',active,attendanceRssi:-55}];mount(<Beacons />);
 await screen.findByText(/Existing GATE:/);expect(screen.getByText(/A second gate cannot be registered/).textContent).toContain(active?'Active':'Inactive');
 fireEvent.click(screen.getByRole('button',{name:'Register Beacon'}));expect(screen.getByRole('option',{name:'School Gate (already registered)'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Edit Main gate'}));expect(screen.getByLabelText('Beacon Type').disabled).toBe(true);
});
it('requires confirmation for deactivation, retains registration and displays API errors',async()=>{
 mount(<Beacons />);await screen.findByText('Pool beacon');window.confirm.mockReturnValueOnce(false);fireEvent.click(screen.getByRole('button',{name:'Deactivate'}));expect(api.mock.calls.some(([,o])=>o?.method==='PATCH')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate'}));expect(await screen.findByRole('button',{name:'Activate'})).toBeTruthy();expect(screen.getByText('Pool beacon')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Edit Pool beacon'}));api.mockRejectedValueOnce(new Error('Thresholds invalid'));fireEvent.click(screen.getByRole('button',{name:'Save Beacon'}));expect((await screen.findByRole('alert')).textContent).toContain('Thresholds invalid');
});
it('teachers cannot manage and gate activation stays protected',async()=>{
 role='TEACHER';rows=[{...zone,id:'gate',hardwareId:'CG-GATE-01',kind:'GATE',name:'Main gate'}];mount(<Beacons />);await screen.findByText('Main gate');expect(screen.getByRole('button',{name:'Register Beacon'}).disabled).toBe(true);expect(screen.queryByRole('button',{name:'Deactivate'})).toBeNull();expect(screen.queryByRole('button',{name:'Edit Main gate'})).toBeNull();
});
it('shows independent gate FAR, zone NEAR and stale UNKNOWN with their actual locations',()=>{
 const now=Date.parse('2026-10-22T00:00:00Z');const device={hardwareId:'CG-WEARABLE-001',active:true,beaconStates:[
 {beaconId:'CG-GATE-01',name:'Main gate',location:'Entrance',kind:'GATE',proximity:'FAR',rssi:-90,observedAt:new Date(now).toISOString()},
 {beaconId:'CG-DZ-01',name:'Pool',location:'Pool fence',kind:'DANGER_ZONE',proximity:'NEAR',rssi:-50,observedAt:new Date(now).toISOString()},
 {beaconId:'CG-DZ-02',name:'Stairs',location:'Stairwell',kind:'DANGER_ZONE',proximity:'FAR',rssi:-80,observedAt:new Date(now-60000).toISOString()},
 ]};render(<BeaconObservations device={device} now={now} />);fireEvent.click(screen.getByText(/Bluetooth beacon readings/));
 expect(screen.getByText('Far away (FAR)')).toBeTruthy();expect(screen.getByText('Nearby (NEAR)')).toBeTruthy();expect(screen.getByText('Signal not available (UNKNOWN)')).toBeTruthy();expect(screen.getByText('Stairwell')).toBeTruthy();expect(screen.getByText('-80.0 dBm (historical)')).toBeTruthy();
});
it('danger alert shows real danger beacon and stored location',async()=>{
 api.mockImplementation(async path=>path.includes('alerts')?{rows:[{id:'alert',kind:'DANGER_ZONE_NEAR',category:'BLE_DANGER',state:'RECORDED',assessment:{verification:'UNVERIFIED',note:'Recorded BLE evidence.'},event:{receivedAt:new Date().toISOString(),recordedChild:{id:'child',name:'Child'},device:{id:'device',hardwareId:'CG-WEARABLE-001'},zone:{hardwareId:zone.hardwareId,name:zone.name,location:zone.location,kind:zone.kind,labelsSource:'EVENT_SNAPSHOT'},payload:{rssi:-50}}}],total:1,hasMore:false}:{count:0});
 mount(<Alerts />);fireEvent.click(await screen.findByRole('button',{name:/View details: DANGER_ZONE_NEAR/}));const dialog=screen.getByRole('dialog');expect(dialog.textContent).toContain('DANGER_ZONE / CG-DZ-01');expect(dialog.textContent).toContain('Pool beacon');expect(dialog.textContent).toContain('Pool fence');expect(dialog.textContent).toContain('stored event snapshot');expect(dialog.textContent).toContain('Verification: UNVERIFIED');
});
