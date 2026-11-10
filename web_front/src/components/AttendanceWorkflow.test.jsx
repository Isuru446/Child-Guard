import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PendingAttendance from './PendingAttendance';
import Topbar from './Topbar';
import Alerts from '../pages/Alerts';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
const arrival={id:'arrival',child:{id:'child',name:'Registered child'},day:'2026-10-25',status:'CHECKIN_PENDING',arrival:{receivedAt:'2026-10-25T05:00:00Z',wearable:'wearable-1',gate:'gate-1'},canConfirm:false};
let stored;
function Location(){const location=useLocation();return <output>{location.pathname}{location.hash}</output>;}
const mount=node=>render(<MemoryRouter>{node}<Location/></MemoryRouter>);
beforeEach(()=>{
 stored=[arrival];api.mockReset().mockImplementation(async path=>path.includes('pending-count')?{count:stored.length,day:'2026-10-25'}:path.includes('/alerts')?[]:{rows:stored,hasMore:false});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
it('shows genuine pending arrivals while offering no Admin Teacher-confirmation action',async()=>{
 mount(<PendingAttendance/>);await screen.findByText('Registered child');expect(screen.getByText('wearable-1')).toBeTruthy();expect(screen.getByText('gate-1')).toBeTruthy();expect(screen.getByText(/Teachers confirm attendance in the Teacher app/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Approve Attendance'})).toBeNull();expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);
});
it('refreshes persisted Teacher decisions and the real notification count without a browser write',async()=>{
 mount(<><Topbar/><PendingAttendance/></>);await screen.findByText('Registered child');await screen.findByRole('button',{name:'1 pending attendance approvals'});stored=[];window.dispatchEvent(new Event('childguard:attendance-updated'));fireEvent.click(screen.getByRole('button',{name:'Refresh pending'}));await screen.findByText('No pending teacher confirmations in this view.');await waitFor(()=>expect(screen.queryByRole('button',{name:'1 pending attendance approvals'})).toBeNull());expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true);
});
it('shows authorization/network errors without approval controls',async()=>{
 api.mockRejectedValue(Object.assign(Error('Sign in required'),{status:401}));mount(<PendingAttendance/>);expect((await screen.findByRole('alert')).textContent).toContain('Your session has ended');expect(screen.queryByRole('button',{name:'Approve Attendance'})).toBeNull();
});
it('polls pending records and routes the existing notification to attendance',async()=>{
 vi.useFakeTimers();stored=[];mount(<><Topbar/><PendingAttendance/></>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});stored=[arrival];await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByText('Registered child')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'1 pending attendance approvals'}));expect(screen.getByText('/attendance#pending-attendance')).toBeTruthy();expect(api.mock.calls.some(([p])=>p.includes('/auth/activity'))).toBe(false);
});
it('preserves actual stored danger-alert rendering without fabricating a confirmed incident',async()=>{
 api.mockResolvedValue({rows:[{id:'alert-1',kind:'DANGER_ZONE_NEAR',category:'BLE_DANGER',state:'RECORDED',severity:null,createdAt:'2026-10-25T05:00:00Z',assessment:{verification:'UNVERIFIED',note:'Recorded BLE evidence does not independently confirm an incident.'},event:{eventId:'event-1',eventType:'DANGER_ZONE_NEAR',timingBasis:'STORED_OBSERVATION',observedAt:'2026-10-25T05:00:00Z',receivedAt:'2026-10-25T05:00:00Z',payload:{rssi:-40},recordedChild:{id:'child-1',name:'Registered child'},device:{id:'device-1',hardwareId:'wearable-1'},zone:{kind:'GATE',hardwareId:'gate-1',name:'Gate',location:'Entrance',labelsSource:'EVENT_SNAPSHOT'}}}],total:1,hasMore:false});mount(<Alerts/>);fireEvent.click(await screen.findByRole('button',{name:/View details: DANGER_ZONE_NEAR/}));expect(screen.getByText(/Verification: UNVERIFIED. State: RECORDED. Severity: not classified/)).toBeTruthy();expect(screen.getByText('GATE / gate-1 / Gate / Entrance')).toBeTruthy();expect(screen.getByText(/RSSI: -40 dBm/)).toBeTruthy();
});
