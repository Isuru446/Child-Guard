import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import ChildLocation from './ChildLocation';
import ChildLocationControl from './ChildLocationControl';
import ChildLocationPicker from './ChildLocationPicker';
import RecordedLocationPreview from './RecordedLocationPreview';
import {api} from '../lib/api';
import {monitoringEvents,monitoringTopics} from '../lib/monitoring-events';
import {googleMapsUrl,validGps} from '../lib/gps-location';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./LocationMap',()=>({default:({locations,label,preserveView})=><output aria-label={label} data-preserve={String(preserveView)}>{JSON.stringify(locations)}</output>}));
let data,listener;
const now=Date.parse('2026-10-28T05:00:00Z');
const tick=async(ms=0)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);listener=null;
 data={child:{id:'child-a',name:'Authorized Child'},device:{id:'device-a',hardwareId:'CG-RECORDED',active:true,connectionState:'ONLINE',lastSeen:new Date(now).toISOString()},serverTime:new Date(now).toISOString(),gpsMonitoring:{latestStatus:'GPS_FIX',staleAfterMs:60000,lastValidLocation:{latitude:6.8085485,longitude:79.99083517,recordedChildId:'child-a',state:'RECENT',observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()}},geofence:{id:'zone',name:'Saved safe area',latitude:6.8,longitude:79.9,radiusM:50,active:true}};
 api.mockReset().mockImplementation(async()=>structuredClone({...data,serverTime:new Date(Date.now()).toISOString()}));
 vi.spyOn(monitoringEvents,'subscribe').mockImplementation(fn=>{listener=fn;return()=>{};});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
const view=()=>render(<ChildLocation childId="child-a" childName="Authorized Child"/>);
it('uses the Admin read and exact map/Google coordinates with a metric saved boundary',async()=>{
 view();await tick();expect(api.mock.calls[0][0]).toBe('/api/v1/admin/children/child-a/location');
 const locations=JSON.parse(screen.getByLabelText('Recorded GPS map for Authorized Child').textContent);
 expect(locations[0]).toMatchObject({id:'child-a',lat:6.8085485,lng:79.99083517});
});
it('provides a safe new-tab Google link containing coordinates only',async()=>{
 view();await tick();
 expect(screen.getByText('Recent GPS location')).toBeTruthy();
 const map=screen.getByLabelText('Recorded GPS map for Authorized Child');
 expect(JSON.parse(map.textContent)).toEqual(expect.arrayContaining([expect.objectContaining({lat:6.8085485,lng:79.99083517,type:'child'}),expect.objectContaining({lat:6.8,lng:79.9,radius:50,type:'geofence'})]));
 expect(map.dataset.preserve).toBe('true');
 const link=screen.getByRole('link',{name:'Open in Google Maps'}),url=new URL(link.href);
 expect(url.searchParams.get('query')).toBe('6.8085485,79.99083517');expect([...url.searchParams.keys()]).toEqual(['api','query']);
 expect(link.target).toBe('_blank');expect(link.rel).toBe('noopener noreferrer');expect(url.href).not.toContain('Authorized');
});
it.each(['GPS_NO_FIX','GPS_NO_SERIAL'])('retains a real last-known fix as historical for %s',async status=>{
 data.gpsMonitoring.latestStatus=status;view();await tick();expect(screen.getByText(/Historical \/ last recorded location/,{selector:'p'})).toBeTruthy();expect(screen.queryByText('Recent GPS location')).toBeNull();expect(screen.getByRole('link',{name:'Open historical location in Google Maps'})).toBeTruthy();
});
it('ages GPS without a refresh and never equates an offline device with a fresh position',async()=>{
 data.device.connectionState='OFFLINE';view();await tick();expect(screen.queryByText('Recent GPS location')).toBeNull();cleanup();
 data.device.connectionState='ONLINE';view();await tick();expect(screen.getByText('Recent GPS location')).toBeTruthy();await tick(60000);await tick(2000);expect(screen.queryByText('Recent GPS location')).toBeNull();
});
it.each([null,{latitude:null,longitude:79},{latitude:91,longitude:79},{latitude:'6',longitude:79},{latitude:6,longitude:Infinity}])('rejects missing/invalid GPS without creating links: %j',async point=>{
 data.gpsMonitoring.lastValidLocation=point;data.geofence=null;view();await tick();expect(screen.getByText('No valid GPS location recorded yet.')).toBeTruthy();expect(screen.queryByRole('link')).toBeNull();expect(screen.queryByLabelText(/Recorded GPS map/)).toBeNull();
});
it('distinguishes no assignment, zero coordinates and unsupported child attribution',async()=>{
 data.device=null;view();await tick();expect(screen.getByText('No wearable assigned to this child.')).toBeTruthy();expect(screen.queryByRole('link')).toBeNull();cleanup();
 data.device={active:true,connectionState:'ONLINE',lastSeen:new Date(now).toISOString()};data.gpsMonitoring.lastValidLocation.latitude=0;data.gpsMonitoring.lastValidLocation.longitude=0;view();await tick();expect(new URL(screen.getByRole('link').href).searchParams.get('query')).toBe('0,0');cleanup();
 data.gpsMonitoring.lastValidLocation.recordedChildId='previous-child';view();await tick();expect(screen.queryByRole('link')).toBeNull();
});
it('does not display an old response after the child changes',async()=>{
 let resolve;api.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const rendered=view();await tick();const first=structuredClone(data);
 data.child={id:'child-b',name:'Second Child'};data.gpsMonitoring.lastValidLocation.recordedChildId='child-b';
 rendered.rerender(<ChildLocation childId="child-b" childName="Second Child"/>);await tick();expect(screen.getByText('Child: Second Child')).toBeTruthy();
 await act(async()=>resolve(first));expect(screen.queryByText('Child: Authorized Child')).toBeNull();
});
it('reconciles devices SSE invalidation and distinguishes API errors from empty success',async()=>{
 view();await tick();expect(monitoringTopics('/api/v1/admin/children/child-a/location')).toEqual(['devices']);
 data.gpsMonitoring.lastValidLocation.latitude=7.5;act(()=>listener({topics:['devices']}));await tick(150);expect(new URL(screen.getByRole('link').href).searchParams.get('query')).toBe('7.5,79.99083517');
 api.mockRejectedValue(new Error('Temporarily unavailable'));fireEvent.click(screen.getByRole('button',{name:'Refresh location'}));await tick();expect(screen.getByRole('alert').textContent).toContain('Unable to load');expect(screen.queryByRole('link')).toBeNull();
});
it('does not read location until the existing Child Details control is opened',async()=>{
 render(<ChildLocationControl child={{id:'child-a',name:'Authorized Child'}}/>);await tick();expect(api).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'View Location'}));await tick();expect(screen.getByText('Wearable: CG-RECORDED')).toBeTruthy();
});
it('offers paginated center child selection on GPS Safe Area without truncating the roster',async()=>{
 api.mockImplementation(async path=>path.endsWith('/location')?structuredClone(data):Array.from({length:25},(_,i)=>({id:`child-${i}`,name:`Child ${i}`})));
 render(<ChildLocationPicker/>);await tick();expect(api).not.toHaveBeenCalled();fireEvent.click(screen.getByText('View child locations'));await tick();expect(screen.getByRole('option',{name:'Child 24'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Next children'}));await tick();expect(api.mock.calls.some(([path])=>path.includes('offset=25'))).toBe(true);
});
it('links an event/configuration preview using only its own saved coordinate pair',()=>{
 render(<RecordedLocationPreview latitude={6.4} longitude={79.4} name="Recorded event"/>);expect(new URL(screen.getByRole('link').href).searchParams.get('query')).toBe('6.4,79.4');expect(validGps(0,0)).toBe(true);expect(googleMapsUrl(null,79)).toBeNull();expect(googleMapsUrl(NaN,79)).toBeNull();
});
