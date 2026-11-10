import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMonitoringPoller } from './monitoring-poller';
let driver,read,onData,onError,onState,visible,online;
beforeEach(()=>{vi.useFakeTimers();visible=true;online=true;read=vi.fn().mockResolvedValue({actual:'data'});onData=vi.fn();onError=vi.fn();onState=vi.fn();});
afterEach(()=>{driver?.dispose();vi.useRealTimers();vi.restoreAllMocks();});
const start=options=>{driver=createMonitoringPoller({read,onData,onError,onState,isVisible:()=>visible,isOnline:()=>online,...options});driver.start();return driver;};
it('polls only after completion, coalesces refreshes and never overlaps requests',async()=>{
 let finish;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));start();await vi.advanceTimersByTimeAsync(0);driver.refresh();driver.refresh();await vi.advanceTimersByTimeAsync(5000);expect(read).toHaveBeenCalledTimes(1);
 finish({actual:'first'});await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(14999);expect(read).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledTimes(3);
});
it('aborts and ignores obsolete hidden-tab responses, then resumes once visible',async()=>{
 let finish;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));start();await vi.advanceTimersByTimeAsync(0);const signal=read.mock.calls[0][0].signal;
 visible=false;driver.reconcile();expect(signal.aborted).toBe(true);visible=true;driver.reconcile();await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(1);
 finish({obsolete:true});await vi.advanceTimersByTimeAsync(0);expect(onData).not.toHaveBeenCalledWith({obsolete:true});expect(read).toHaveBeenCalledTimes(2);
});
it('pauses unnecessary offline/hidden polling and resumes without an activity request',async()=>{
 start();await vi.advanceTimersByTimeAsync(0);online=false;driver.reconcile();await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(1);expect(onState).toHaveBeenCalledWith(expect.objectContaining({pausedReason:'offline'}));
 online=true;visible=false;driver.reconcile();await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(1);visible=true;driver.reconcile();await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);
});
it('backs off network errors and respects rate limiting even on manual refresh',async()=>{
 read.mockRejectedValueOnce(Object.assign(Error('rate limited'),{status:429}));start();await vi.advanceTimersByTimeAsync(0);driver.refresh();await vi.advanceTimersByTimeAsync(59999);expect(read).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledTimes(2);
 read.mockRejectedValueOnce(Error('network'));driver.refresh();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(29999);expect(read).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledTimes(4);
});
it.each([401,403])('stops automatic retries after terminal authorization status %s',async status=>{
 read.mockRejectedValue(Object.assign(Error('sign in required'),{status}));start();await vi.advanceTimersByTimeAsync(300000);expect(read).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);
});
it('bounds request time using abort and does not display a late successful response',async()=>{
 let finish;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));start();await vi.advanceTimersByTimeAsync(10000);expect(read.mock.calls[0][0].signal.aborted).toBe(true);finish({late:true});await vi.advanceTimersByTimeAsync(0);expect(onData).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledWith(expect.objectContaining({code:'NETWORK_TIMEOUT'}));
});
it('disposes timers and ignores an unresolved obsolete request',async()=>{
 let finish;read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));start();await vi.advanceTimersByTimeAsync(0);driver.dispose();finish({old:true});await vi.advanceTimersByTimeAsync(60000);expect(onData).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(1);
});
it('fetches a frozen history page once when its automatic interval is zero',async()=>{start({intervalMs:0});await vi.advanceTimersByTimeAsync(120000);expect(read).toHaveBeenCalledTimes(1);driver.refresh();await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);});
it('discards a pre-notification in-flight response and coalesces the authoritative reread',async()=>{
 let finish;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));start();await vi.advanceTimersByTimeAsync(0);driver.invalidate();expect(read.mock.calls[0][0].signal.aborted).toBe(true);finish({stale:true});await vi.advanceTimersByTimeAsync(0);expect(onData).not.toHaveBeenCalledWith({stale:true});expect(read).toHaveBeenCalledTimes(2);
});
it('does not postpone reconciliation when repeated live status accompanies unrelated updates',async()=>{
 start();await vi.advanceTimersByTimeAsync(0);driver.setInterval(60000);
 for(let i=0;i<6;i++){await vi.advanceTimersByTimeAsync(10000);driver.setInterval(60000);}
 expect(read).toHaveBeenCalledTimes(2);
});
