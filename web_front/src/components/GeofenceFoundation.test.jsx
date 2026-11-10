import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Geofence from '../pages/Geofence';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
vi.mock('./LocationMap',()=>({default:({locations,label})=><output aria-label={label}>{JSON.stringify(locations)}</output>}));
const mount=()=>render(<MemoryRouter><Geofence/></MemoryRouter>);
const tick=async(ms=0)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
beforeEach(()=>{vi.useFakeTimers();api.mockReset().mockResolvedValue({configurationAvailable:false,monitoringAvailable:false,zones:null,limits:{minRadiusM:50,maxRadiusM:5000,maxNameLength:100}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
const fill=()=>{for(const [label,value] of [['Zone name','Owner review'],['Latitude','0'],['Longitude','0'],['Radius (meters)','100']])fireEvent.change(screen.getByLabelText(label),{target:{value}});};
it('shows unavailable persistence and monitoring with blank coordinates, never demonstration records',async()=>{
 mount();await tick();expect(screen.getByLabelText('Latitude').value).toBe('');expect(screen.getByLabelText('Longitude').value).toBe('');expect(screen.getByText(/This page is not enforcing a boundary/)).toBeTruthy();expect(screen.getByText(/Saved safe areas are currently unavailable/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Save Geofence'})).toBeNull();expect(screen.getByRole('link',{name:'Review recorded safety alerts'}).getAttribute('href')).toBe('/alerts');
});
it('reviews valid zero coordinates only in memory and labels active as unenforced',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem');mount();await tick();fill();fireEvent.click(screen.getByLabelText('Enable after saving (reviewing alone does not start monitoring)'));fireEvent.click(screen.getByRole('button',{name:'Review safe area'}));const draft=screen.getByRole('region',{name:'Unsaved zone draft'});expect(within(draft).getByText(/Coordinates: 0, 0. Radius: 100 meters/)).toBeTruthy();expect(within(draft).getByText('After saving: active. Not saved. Not used for monitoring yet.')).toBeTruthy();expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);expect(storage).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Discard draft'}));expect(screen.queryByRole('region',{name:'Unsaved zone draft'})).toBeNull();expect(screen.getByLabelText('Latitude').value).toBe('');
});
it('rejects invalid inputs and never converts missing coordinates to zero',async()=>{
 mount();await tick();fill();fireEvent.change(screen.getByLabelText('Latitude'),{target:{value:''}});fireEvent.submit(screen.getByRole('button',{name:'Review safe area'}).closest('form'));expect(screen.getByRole('alert').textContent).toContain('valid coordinate pair');expect(screen.queryByRole('region',{name:'Unsaved zone draft'})).toBeNull();fill();fireEvent.change(screen.getByLabelText('Radius (meters)'),{target:{value:'49'}});fireEvent.submit(screen.getByRole('button',{name:'Review safe area'}).closest('form'));expect(screen.getByRole('alert')).toBeTruthy();
});
it('clears reviewed output after edits and loses local drafts on unmount',async()=>{
 const view=mount();await tick();fill();fireEvent.click(screen.getByRole('button',{name:'Review safe area'}));expect(screen.getByRole('region',{name:'Unsaved zone draft'})).toBeTruthy();fireEvent.change(screen.getByLabelText('Zone name'),{target:{value:'Changed'}});expect(screen.queryByRole('region',{name:'Unsaved zone draft'})).toBeNull();view.unmount();mount();await tick();expect(screen.getByLabelText('Zone name').value).toBe('');
});
it('handles authorization/network failure with the draft form disabled',async()=>{
 api.mockRejectedValue(Object.assign(Error('Sign in required'),{status:401}));mount();await tick();expect(screen.getByRole('alert').textContent).toContain('Your session has ended');expect(screen.getByRole('group',{name:'Safe area details'}).disabled).toBe(true);const count=api.mock.calls.length;await tick(120000);expect(api).toHaveBeenCalledTimes(count);
});
it('checks availability using GET only without renewing session activity',async()=>{
 mount();await tick();await tick(15000);expect(api).toHaveBeenCalledTimes(2);expect(api.mock.calls.every(([path,o])=>path==='/api/v1/safe-zones'&&!o.method&&!path.includes('/auth/activity'))).toBe(true);
});
it('loads a persisted center zone, confirms and saves its reviewed revision once with visible errors',async()=>{
 const zone={id:'zone',name:'Actual configured zone',latitude:6.9,longitude:79.8,radiusM:100,active:true,revision:2};
 let finish;api.mockImplementation(async(path,options)=>options.method==='PUT'?new Promise(resolve=>{finish=resolve;}):{configurationAvailable:true,zones:[zone],limits:{minRadiusM:50,maxRadiusM:5000,maxNameLength:100},readings:[]});
 vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValue(true);mount();await tick();expect(screen.getByText('Actual configured zone')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Edit Safe Area'}));expect(screen.getByLabelText('Latitude').value).toBe('6.9');fireEvent.click(screen.getByRole('button',{name:'Review safe area'}));
 fireEvent.click(screen.getByRole('button',{name:'Save center zone'}));expect(api.mock.calls.filter(([,o])=>o.method==='PUT')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Save center zone'}));fireEvent.click(screen.getByRole('button',{name:'Saving zone…'}));expect(api.mock.calls.filter(([,o])=>o.method==='PUT')).toHaveLength(1);
 expect(JSON.parse(api.mock.calls.find(([,o])=>o.method==='PUT')[1].body)).toMatchObject({revision:2,latitude:6.9,longitude:79.8});await act(async()=>finish(zone));expect(screen.getByText(/Safe area saved/)).toBeTruthy();
});
it('shows server-classified UNKNOWN evidence and expired save errors without inventing enforcement',async()=>{
 api.mockImplementation(async(path,o)=>{if(o.method==='PUT')throw Error('Session expired. Sign in again.');return {configurationAvailable:true,zones:[],limits:{minRadiusM:50,maxRadiusM:5000,maxNameLength:100},readings:[{eventId:'event',state:'OUTSIDE',currentState:'UNKNOWN',reason:'STALE_OR_UNCERTAIN_GPS',hardwareId:'Real recorded belt',observedAt:null}]};});
 vi.spyOn(window,'confirm').mockReturnValue(true);mount();await tick();expect(screen.getByRole('cell',{name:'No recent valid location'})).toBeTruthy();expect(screen.getByText('STALE_OR_UNCERTAIN_GPS')).toBeTruthy();fill();fireEvent.click(screen.getByRole('button',{name:'Review safe area'}));fireEvent.click(screen.getByRole('button',{name:'Save center zone'}));await tick();expect(screen.getByRole('alert').textContent).toContain('Session expired');
});
it.each([true,false])('organizes the saved configuration with one precise coordinate display and accurate enabled=%s badge',async active=>{
 const zone={id:'zone',name:'A long saved center boundary name',latitude:6.900000123456789,longitude:79.8000009876543,radiusM:50,active,revision:7};
 api.mockResolvedValue({configurationAvailable:true,zones:[zone],limits:{minRadiusM:20,maxRadiusM:10000,maxNameLength:100},readings:[]});
 mount();await tick();const card=screen.getByRole('region',{name:'Saved GPS Safe Area'});
 expect(within(card).getByRole('heading',{name:zone.name})).toBeTruthy();expect(within(card).getByRole('heading',{name:'Center Location'})).toBeTruthy();expect(within(card).getAllByText(`${zone.latitude}, ${zone.longitude}`)).toHaveLength(1);expect(within(card).getByText('50 meters')).toBeTruthy();
 expect(within(card).getByText(active?'Enabled':'Disabled').className).toContain(active?'cg-status--success':'cg-status--muted');
 const revision=within(card).getByText('Revision: 7');expect(revision.closest('details').open).toBe(false);fireEvent.click(within(card).getByText('Safe area technical details'));expect(revision.closest('details').open).toBe(true);
 expect(within(card).queryByText(/Child Safe|Currently Protected/)).toBeNull();expect(api.mock.calls.every(([,options])=>!options.method)).toBe(true);
});
it('previews the exact saved boundary and fills the existing editor without rounding or saving',async()=>{
 const zone={id:'zone',name:'Precise saved boundary',latitude:6.900000123456789,longitude:79.8000009876543,radiusM:50,active:true,revision:7};
 api.mockResolvedValue({configurationAvailable:true,zones:[zone],limits:{minRadiusM:20,maxRadiusM:10000,maxNameLength:100},readings:[]});
 mount();await tick();const card=screen.getByRole('region',{name:'Saved GPS Safe Area'});
 expect(screen.queryByLabelText('Persisted center safe-zone boundary')).toBeNull();fireEvent.click(within(card).getByRole('button',{name:'Preview Location'}));
 expect(JSON.parse(screen.getByLabelText('Persisted center safe-zone boundary').textContent)[0]).toMatchObject({name:zone.name,lat:zone.latitude,lng:zone.longitude,radius:50,type:'geofence'});
 fireEvent.click(within(card).getByRole('button',{name:'Hide map'}));expect(screen.queryByLabelText('Persisted center safe-zone boundary')).toBeNull();
 fireEvent.click(within(card).getByRole('button',{name:'Edit Safe Area'}));
 for(const [label,value] of [['Zone name',zone.name],['Latitude',String(zone.latitude)],['Longitude',String(zone.longitude)],['Radius (meters)','50']])expect(screen.getByLabelText(label).value).toBe(value);
 expect(screen.getByLabelText('Enable after saving (reviewing alone does not start monitoring)').checked).toBe(true);expect(api.mock.calls.every(([,options])=>!options.method)).toBe(true);
});
it('refreshes setup and configuration using the existing GET with loading feedback and no live-safety claim',async()=>{
 const zone={id:'zone',name:'Saved boundary',latitude:0,longitude:0,radiusM:50,active:true,revision:2};
 api.mockResolvedValue({configurationAvailable:true,zones:[zone],limits:{minRadiusM:20,maxRadiusM:10000,maxNameLength:100},readings:[]});mount();await tick();
 let finish;api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByRole('button',{name:'Refresh Safe Area'}));await tick();expect(screen.getByRole('button',{name:'Refreshing...'}).disabled).toBe(true);
 await act(async()=>finish({configurationAvailable:true,zones:[{...zone,active:false,revision:3}],limits:{minRadiusM:20,maxRadiusM:10000,maxNameLength:100},readings:[]}));
 const card=screen.getByRole('region',{name:'Saved GPS Safe Area'});expect(within(card).getByText('Disabled')).toBeTruthy();expect(within(card).getByText('Revision: 3')).toBeTruthy();expect(within(card).getAllByText('0, 0')).toHaveLength(1);expect(api.mock.calls).toHaveLength(2);expect(api.mock.calls.every(([path,options])=>path==='/api/v1/safe-zones'&&!options.method)).toBe(true);
});
