import { expect, it, vi } from 'vitest';
import { monitoringRequest } from './monitoring-request';
import { api } from './api';
vi.mock('./api',()=>({api:vi.fn()}));
it('coalesces identical in-flight reads but rereads after settlement',async()=>{
 let finish;api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const a=monitoringRequest('/api/v1/alerts?shared'),b=monitoringRequest('/api/v1/alerts?shared');await Promise.resolve();expect(api).toHaveBeenCalledTimes(1);
 finish({total:1});expect(await a).toEqual(await b);
 api.mockResolvedValueOnce({total:2});expect(await monitoringRequest('/api/v1/alerts?shared')).toEqual({total:2});expect(api).toHaveBeenCalledTimes(2);
});
it('does not let a hidden component abort another component’s shared read',async()=>{
 let finish;api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const one=new AbortController(),two=new AbortController();
 const a=monitoringRequest('/api/v1/devices?shared',{signal:one.signal}),b=monitoringRequest('/api/v1/devices?shared',{signal:two.signal});await Promise.resolve();const signal=api.mock.calls.at(-1)[1].signal;
 one.abort();await expect(a).rejects.toMatchObject({name:'AbortError'});expect(signal.aborted).toBe(false);finish({actual:'data'});expect(await b).toEqual({actual:'data'});
});
