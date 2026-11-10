import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResetAttendance from './ResetAttendance';
import LiveDevices from './LiveDevices';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const row={id:'attendance-1',canReset:true,child:{name:'Child'},confirmations:[{confirmedAt:'2026-10-21T05:00:00.000Z'}]};
it('hides reset unless backend grants eligibility',()=>{render(<ResetAttendance row={{...row,canReset:false}} />);expect(screen.queryByRole('button')).toBeNull();});
it('requires confirmation, prevents duplicates and refreshes actual data',async()=>{
 let finish;api.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValue(true);
 const refreshed=vi.fn();window.addEventListener('childguard:attendance-updated',refreshed);
 render(<ResetAttendance row={row} />);
 fireEvent.click(screen.getByRole('button'));expect(api).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button'));expect(screen.getByRole('button').disabled).toBe(true);
 fireEvent.click(screen.getByRole('button'));expect(api).toHaveBeenCalledTimes(1);
 expect(JSON.parse(api.mock.calls[0][1].body).confirmedAt).toBe(row.confirmations[0].confirmedAt);
 await act(async()=>finish({status:'NOT_CHECKED_IN'}));expect(refreshed).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('status').textContent).toContain('completed');window.removeEventListener('childguard:attendance-updated',refreshed);
});
it('shows errors and permits retry',async()=>{
 api.mockRejectedValue(new Error('Development attendance reset is disabled'));vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<ResetAttendance row={row} />);fireEvent.click(screen.getByRole('button'));
 expect((await screen.findByRole('alert')).textContent).toContain('disabled');expect(screen.getByRole('button').disabled).toBe(false);
});
it('identifies CG-GATE-01 and keeps stale/UNKNOWN separate from communication',async()=>{
 api.mockImplementation(async path=>path.includes('/devices')?[{id:'wearable',hardwareId:'CG-WEARABLE-001',active:true,lastSeen:new Date().toISOString(),bleState:{gateId:'CG-GATE-01',beaconType:'Gate / Attendance + Danger Zone',proximity:'FAR',rssi:-90,observedAt:new Date(Date.now()-60000).toISOString(),staleAfterMs:45000}}]:{count:0});
 render(<MemoryRouter><LiveDevices /></MemoryRouter>);
 expect(await screen.findByText('CG-GATE-01')).toBeTruthy();expect(screen.getByText('Gate / Attendance + Danger Zone')).toBeTruthy();expect(screen.getByText('Signal not available (UNKNOWN)')).toBeTruthy();expect(screen.queryByText('FAR')).toBeNull();expect(screen.getByRole('cell',{name:'Online'})).toBeTruthy();expect(screen.getByText('Stale')).toBeTruthy();
});
