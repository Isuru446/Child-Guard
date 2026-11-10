import { afterEach, expect, it, vi } from 'vitest';
import { createAdminSessionAdapter } from './admin-session-adapter';
const start=Date.parse('2026-10-25T08:00:00.000Z');
function fixture(){
 let clock=start;
 const data=()=>({user:{id:'user-a',username:'admin',role:'ADMIN',centerId:'center-a'},session:{id:'session-a',createdAt:new Date(start).toISOString(),idleExpiresAt:new Date(clock+300000).toISOString(),absoluteExpiresAt:new Date(start+28800000).toISOString()},serverTime:new Date(clock).toISOString(),csrfToken:'A'.repeat(43)});
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>({data:body})});
 const fetch=vi.fn(async path=>response(path.endsWith('/activity')?{idleExpiresAt:new Date(clock+300000).toISOString(),serverTime:new Date(clock).toISOString()}:path.endsWith('/logout')?{revoked:true}:data()));
 const onEnded=vi.fn();const client=createAdminSessionAdapter({fetchImpl:fetch,now:()=>clock,newId:()=> '12345678-1234-4234-8234-123456789abc',onEnded});
 return {client,fetch,response,data,onEnded,tick:ms=>{clock+=ms;}};
}
afterEach(()=>vi.restoreAllMocks());
it('uses relative same-origin cookies and memory-only CSRF; never writes browser storage or a bearer',async()=>{
 const get=vi.spyOn(Storage.prototype,'getItem'),set=vi.spyOn(Storage.prototype,'setItem'),remove=vi.spyOn(Storage.prototype,'removeItem');
 const f=fixture();const result=await f.client.login('admin','synthetic-password');
 expect(result).not.toHaveProperty('csrfToken');expect(result).not.toHaveProperty('token');
 await f.client.request('/api/v1/admin/users',{method:'POST',body:'{}'});
 const [path,options]=f.fetch.mock.calls[1];expect(path).toBe('/api/v1/admin/users');expect(options.credentials).toBe('same-origin');expect(options.headers.get('X-CSRF-Token')).toBe('A'.repeat(43));expect(options.headers.has('Authorization')).toBe(false);
 expect(get).not.toHaveBeenCalled();expect(set).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('normal reads, restore, polling and timers never send activity',async()=>{
 const f=fixture();await f.client.restore();
 for(let i=0;i<20;i++){f.tick(15000);await f.client.request('/api/v1/admin/overview');}
 expect(f.fetch.mock.calls.some(([path])=>path.endsWith('/activity'))).toBe(false);
 expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(false);
});
it.each(['focus','visibilitychange','mousemove','timer','pointerdown'])('rejects untrusted or non-input %s events',async type=>{
 const f=fixture();await f.client.restore();expect(await f.client.recordInteraction({isTrusted:type!=='pointerdown',type})).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('genuine input alone sends activity, with 15-second throttling and no client timestamp',async()=>{
 const f=fixture();await f.client.restore();f.tick(1000);expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(true);
 expect(await f.client.recordInteraction({isTrusted:true,type:'pointerdown'})).toBe(false);f.tick(15000);expect(await f.client.recordInteraction({isTrusted:true,type:'input'})).toBe(true);
 expect(f.fetch).toHaveBeenCalledTimes(3);expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toEqual({interactionId:'12345678-1234-4234-8234-123456789abc'});
});
it('network failure cannot extend idle; a genuine event near expiry retries immediately',async()=>{
 const f=fixture();await f.client.restore();f.tick(290000);f.fetch.mockRejectedValueOnce(Error('offline'));
 await expect(f.client.recordInteraction({isTrusted:true,type:'keydown'})).rejects.toThrow('Cannot reach');
 f.tick(1000);expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(3);
});
it('failed activity with no later genuine input never refreshes itself',async()=>{
 const f=fixture();await f.client.restore();f.tick(290000);f.fetch.mockRejectedValueOnce(Error('offline'));
 await expect(f.client.recordInteraction({isTrusted:true,type:'keydown'})).rejects.toThrow();f.tick(10000);
 expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(2);
});
it('serializes concurrent activity sends without manufacturing a timer retry',async()=>{
 const f=fixture();await f.client.restore();let finish;
 f.fetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=f.client.recordInteraction({isTrusted:true,type:'keydown'});expect(await f.client.recordInteraction({isTrusted:true,type:'input'})).toBe(false);
 finish(f.response({serverTime:new Date(start).toISOString(),idleExpiresAt:new Date(start+300000).toISOString()}));expect(await first).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(2);
});
it('binds only trusted-input events and removes all listeners on cleanup',async()=>{
 const f=fixture();await f.client.restore();const target=new EventTarget(),add=vi.spyOn(target,'addEventListener'),remove=vi.spyOn(target,'removeEventListener');
 const unbind=f.client.bindTrustedActivity(target);expect(add.mock.calls.map(([type])=>type)).toEqual(['pointerdown','keydown','touchstart','input']);
 target.dispatchEvent(new Event('keydown'));await Promise.resolve();expect(f.fetch).toHaveBeenCalledTimes(1);unbind();expect(remove).toHaveBeenCalledTimes(4);
});
it('logout uses CSRF and asks the server to revoke; failure is not reported as revocation success',async()=>{
 const f=fixture();await f.client.restore();expect(await f.client.logout()).toEqual({revoked:true});expect(f.onEnded).toHaveBeenCalledOnce();expect(f.fetch.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('A'.repeat(43));
 await f.client.restore();f.fetch.mockRejectedValueOnce(Error('offline'));await expect(f.client.logout()).rejects.toThrow('Cannot reach');expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(false);
});
it('expired sessions end locally; transient 503 leaves the current session available for retry',async()=>{
 const f=fixture();await f.client.restore();f.fetch.mockResolvedValueOnce(f.response(null,503));await expect(f.client.request('/api/v1/private')).rejects.toMatchObject({status:503});expect(f.onEnded).not.toHaveBeenCalled();
 f.fetch.mockResolvedValueOnce(f.response(null,401));await expect(f.client.request('/api/v1/private')).rejects.toMatchObject({status:401});expect(f.onEnded).toHaveBeenCalledOnce();expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(false);
});
it('late restore cannot re-establish a logged-out session',async()=>{
 const f=fixture();await f.client.restore();let finish;
 f.fetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const restoring=f.client.restore();await f.client.logout();finish(f.response(f.data()));await expect(restoring).rejects.toMatchObject({code:'STALE_RESPONSE'});expect(await f.client.recordInteraction({isTrusted:true,type:'keydown'})).toBe(false);
});
it('refuses unexpected role and any JWT response rather than silently mixing protocols',async()=>{
 const f=fixture();f.fetch.mockResolvedValueOnce(f.response({...f.data(),user:{role:'TEACHER'}}));await expect(f.client.restore()).rejects.toThrow('administrator');
 f.fetch.mockResolvedValueOnce(f.response({...f.data(),token:'synthetic-bearer'}));await expect(f.client.restore()).rejects.toThrow('Unexpected session response');
});
it('refuses alternate origins and caller-supplied bearer headers before fetch',async()=>{
 const f=fixture();await expect(f.client.request('https://evil.invalid/api/v1/auth/me')).rejects.toThrow('Invalid API path');
 await expect(f.client.request('/api/v1/auth/me',{headers:{Authorization:'Bearer synthetic'}})).rejects.toThrow('Alternate credentials');expect(f.fetch).not.toHaveBeenCalled();
});
