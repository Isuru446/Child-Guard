import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
afterEach(()=>{vi.restoreAllMocks();sessionStorage.clear();});
it('clears expired credentials even if a proxy returns non-JSON',async()=>{
 sessionStorage.setItem('childguardToken','synthetic-expired');
 const ended=vi.fn();window.addEventListener('childguard:session-ended',ended);
 try {
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status:401,json:async()=>{throw new Error('HTML response');}});
  await expect(api('/api/v1/auth/me')).rejects.toMatchObject({status:401,code:'UNAUTHENTICATED',message:'Your session has expired. Please sign in again.'});
  expect(sessionStorage.getItem('childguardToken')).toBeNull();expect(ended).toHaveBeenCalledOnce();
 } finally {window.removeEventListener('childguard:session-ended',ended);}
});
it.each([
 [401,'/api/v1/auth/login','Invalid username or password.'],
 [429,'/api/v1/auth/login','Too many attempts. Please wait a minute before trying again.'],
 [503,'/api/v1/auth/me','ChildGuard is temporarily unavailable. Please try again.'],
])('maps HTTP %s to a clear safe message',async(status,path,message)=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status,json:async()=>{throw Error('private proxy details');}});
 await expect(api(path)).rejects.toMatchObject({status,message});
});
it('maps network failures without exposing fetch internals',async()=>{
 vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('private internals'));
 await expect(api('/api/v1/auth/login')).rejects.toMatchObject({status:0,code:'NETWORK_ERROR',message:'Cannot reach ChildGuard API. Check your connection and try again.'});
});
it('does not clear a newer browser session for a late old-token 401',async()=>{
 sessionStorage.setItem('childguardToken','old-token');
 let finish;
 vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=api('/api/v1/auth/me');
 sessionStorage.setItem('childguardToken','new-token');
 finish({ok:false,status:401,json:async()=>({})});
 await expect(pending).rejects.toMatchObject({status:401});
 expect(sessionStorage.getItem('childguardToken')).toBe('new-token');
});
it('rejects a missing data envelope instead of displaying undefined as success',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({status:'ok'})});
 await expect(api('/api/v1/admin/overview')).rejects.toThrow('Unexpected response');
});
