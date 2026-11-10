import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMonitoringRead } from './use-monitoring-read';
import { api } from './api';
let notify;
vi.mock('./api', () => ({ api: vi.fn() }));
vi.mock('./monitoring-events', () => ({ monitoringTopics: () => ['devices'], monitoringEvents: { subscribe: fn => { notify = fn; return () => {}; } } }));
const tick = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => { vi.useFakeTimers(); api.mockReset(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps the last same-path data during pending reads and errors, with an honest stale flag', async () => {
 let complete, fail;
 const data = { rows: [{ id: 'saved' }] };
 api.mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
 const { result } = renderHook(() => useMonitoringRead('/api/v1/devices'));
 await tick(0);
 expect(result.current.data).toBe(data);
 const updatedAt = result.current.updatedAt;
 await tick(15000);
 expect(result.current.loading).toBe(false);
 expect(result.current.refreshing).toBe(true);
 expect(result.current.manualRefreshing).toBe(false);
 expect(result.current.data).toBe(data);
 await act(async () => fail(Error('Connection unavailable')));
 expect(result.current.data).toBe(data);
 expect(result.current.updatedAt).toBe(updatedAt);
 expect(result.current.stale).toBe(true);
 api.mockResolvedValue({ rows: [{ id: 'fresh' }] });
 act(() => result.current.refresh());
 await tick(0);
 expect(result.current.stale).toBe(false);
 expect(result.current.data.rows[0].id).toBe('fresh');
 expect(complete).toBeTypeOf('function');
});

it.each([401, 403, 404])('clears protected data on status %s instead of retaining it', async status => {
 api.mockResolvedValueOnce({ private: 'authorized child' }).mockRejectedValueOnce(Object.assign(Error('No access'), { status }));
 const { result } = renderHook(() => useMonitoringRead('/api/v1/mobile/children/one/activity'));
 await tick(0); expect(result.current.data).not.toBeNull();
 await tick(15000); expect(result.current.data).toBeNull();
});

it('masks an old scope immediately and ignores late responses after changing children', async () => {
 let oldResponse;
 api.mockResolvedValueOnce({ child: 'one' }).mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; })).mockResolvedValue({ child: 'two' });
 const { result, rerender } = renderHook(({ path }) => useMonitoringRead(path), { initialProps: { path: '/api/v1/child/one' } });
 await tick(0); await tick(15000);
 rerender({ path: '/api/v1/child/two' });
 expect(result.current.data).toBeNull();
 await tick(0);
 await act(async () => oldResponse({ child: 'obsolete one' }));
 expect(result.current.data.child).toBe('two');
});

it('does not restart polling for changing callbacks and coalesces SSE invalidations', async () => {
 api.mockResolvedValue({ rows: [] });
 const { result, rerender } = renderHook(() => useMonitoringRead('/api/v1/devices', { onData: () => {} }));
 await tick(0);
 rerender(); rerender(); await tick(14999);
 expect(api).toHaveBeenCalledTimes(1);
 await tick(1); expect(api).toHaveBeenCalledTimes(2);
 act(() => { notify({ topics: ['devices'] }); notify({ topics: ['devices'] }); });
 await tick(101); expect(api).toHaveBeenCalledTimes(3);
 expect(result.current.loading).toBe(false);
});

it('marks cached data stale immediately when the browser goes offline', async () => {
 api.mockResolvedValue({ rows: ['saved'] });
 const { result } = renderHook(() => useMonitoringRead('/api/v1/devices'));
 await tick(0);
 vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
 act(() => window.dispatchEvent(new Event('offline')));
 expect(result.current.stale).toBe(true);
 expect(result.current.data.rows).toEqual(['saved']);
 let finish;
 api.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
 vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
 act(() => window.dispatchEvent(new Event('online')));
 await tick(0);
 expect(result.current.stale).toBe(true);
 await act(async () => finish({ rows: ['fresh after reconnect'] }));
 expect(result.current.stale).toBe(false);
});
it('preserves a workflow fallback interval across live/disconnected SSE signals',async()=>{
 api.mockResolvedValue({enrollment:{status:'PENDING'}});
 renderHook(()=>useMonitoringRead('/api/v1/admin/rfid/children/one',{intervalMs:1000,adaptiveInterval:false}));
 await tick(0);act(()=>notify({live:true}));await tick(1000);expect(api).toHaveBeenCalledTimes(2);
 act(()=>notify({live:false}));await tick(1000);expect(api).toHaveBeenCalledTimes(3);
});
