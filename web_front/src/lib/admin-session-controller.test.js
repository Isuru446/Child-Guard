import { afterEach, expect, it, vi } from 'vitest';
import { createAdminSessionController } from './admin-session-controller';
import { createAdminSessionAdapter } from './admin-session-adapter';
const start=Date.parse('2026-10-25T08:00:00.000Z');
const response=(data,status=200)=>({ok:status<300,status,json:async()=>({data})});
const data=()=>({user:{id:'admin-id',username:'admin',role:'ADMIN',centerId:'center-a'},session:{id:'session-a',idleExpiresAt:new Date(start+300000).toISOString()},csrfToken:'A'.repeat(43),serverTime:new Date(start).toISOString()});
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
afterEach(()=>vi.unstubAllGlobals());
it('scrubs legacy credentials only when constructed for cutover; exposes no cookie/CSRF in UI snapshot',async()=>{
 const s=storage();s.setItem('childguardToken','synthetic-legacy');s.setItem('childguardAdminName','old');const fetch=vi.fn(async()=>response(data()));
 const c=createAdminSessionController({storage:s,fetchImpl:fetch,now:()=>start});expect(s.map.size).toBe(0);await c.restore();expect(c.getSnapshot()).toMatchObject({status:'ready',user:{role:'ADMIN'}});expect(c.getSnapshot()).not.toHaveProperty('csrfToken');
});
it('offline logout records only a non-secret intent, blocks requests and prevents refresh restoring old cookie authority',async()=>{
 const s=storage(),fetch=vi.fn(async()=>response(data()));const c=createAdminSessionController({storage:s,fetchImpl:fetch,now:()=>start});await c.restore();fetch.mockRejectedValueOnce(Error('offline'));await expect(c.logout()).rejects.toThrow();
 expect(s.map).toEqual(new Map([['childguardAdminLogoutPending','1']]));await expect(c.request('/api/v1/private',{method:'POST'})).rejects.toMatchObject({status:401});
 const nextFetch=vi.fn();const reloaded=createAdminSessionController({storage:s,fetchImpl:nextFetch});await reloaded.restore();expect(nextFetch).not.toHaveBeenCalled();expect(reloaded.getSnapshot().status).toBe('signed-out');
});
it('pending logout recovers CSRF read-only and revokes without ever rendering private content',async()=>{
 const s=storage();s.setItem('childguardAdminLogoutPending','1');const seen=[];const fetch=vi.fn(async path=>response(path.endsWith('/logout')?{revoked:true}:data()));
 const c=createAdminSessionController({storage:s,fetchImpl:fetch,now:()=>start});c.subscribe(()=>seen.push(c.getSnapshot().status));await c.retryLogout();
 expect(seen).not.toContain('ready');expect(s.map.size).toBe(0);expect(fetch.mock.calls.map(([p])=>p)).toEqual(['/api/v1/auth/me','/api/v1/auth/logout']);expect(fetch.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('A'.repeat(43));
});
it('authoritatively expired pending logout is cleared without manufacturing a renewed session',async()=>{
 const s=storage();s.setItem('childguardAdminLogoutPending','1');const c=createAdminSessionController({storage:s,fetchImpl:async()=>response(null,401)});await c.retryLogout();expect(s.map.size).toBe(0);expect(c.getSnapshot().status).toBe('signed-out');
});
it('successful logout clears local state and pending intent; failed restore shows retry state',async()=>{
 const s=storage(),fetch=vi.fn(async path=>response(path.endsWith('/logout')?{revoked:true}:data()));const c=createAdminSessionController({storage:s,fetchImpl:fetch,now:()=>start});await c.restore();await c.logout();expect(c.getSnapshot().status).toBe('signed-out');expect(s.map.size).toBe(0);
 fetch.mockRejectedValueOnce(Error('offline'));await expect(c.restore()).rejects.toThrow();expect(c.getSnapshot().status).toBe('error');
});
it('private photos use same-origin cookies, return a blob URL and contain no bearer header',async()=>{
 const make=vi.fn(()=> 'blob:synthetic-private');vi.stubGlobal('URL',{createObjectURL:make});const fetch=vi.fn(async()=>({ok:true,status:200,blob:async()=>new Blob(['synthetic-image'])}));
 const a=createAdminSessionAdapter({fetchImpl:fetch});expect(await a.privatePhoto('12345678-1234-4234-8234-123456789abc')).toBe('blob:synthetic-private');expect(fetch.mock.calls[0][1].credentials).toBe('same-origin');expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);expect(make).toHaveBeenCalledOnce();
});
it('photo uploads retain their explicit MIME type and synchronizer CSRF',async()=>{
 const fetch=vi.fn(async()=>response(data()));const a=createAdminSessionAdapter({fetchImpl:fetch,now:()=>start});await a.restore();await a.request('/api/v1/account/photo',{method:'PUT',headers:{'Content-Type':'image/png'},body:new Uint8Array([1,2,3])});
 const opts=fetch.mock.calls[1][1];expect(opts.headers.get('Content-Type')).toBe('image/png');expect(opts.headers.get('X-CSRF-Token')).toBe('A'.repeat(43));
});

it('multipart FormData keeps browser-managed boundaries while retaining CSRF and same-origin cookies',async()=>{
 const fetch=vi.fn(async()=>response(data()));const adapter=createAdminSessionAdapter({fetchImpl:fetch,now:()=>start});await adapter.restore();
 const form=new FormData();form.append('photo',new Blob(['synthetic'],{type:'image/png'}),'synthetic.png');
 await adapter.request('/api/v1/account/photo',{method:'PUT',body:form,headers:{'Content-Type':'multipart/form-data'}});
 const opts=fetch.mock.calls[1][1];expect(opts.headers.has('Content-Type')).toBe(false);expect(opts.headers.get('X-CSRF-Token')).toBe('A'.repeat(43));expect(opts.credentials).toBe('same-origin');expect(opts.body).toBe(form);
});

it('polling expiry carries the existing clear sign-in message into the route gate',async()=>{
 const s=storage(),fetch=vi.fn(async()=>response(data()));const client=createAdminSessionController({storage:s,fetchImpl:fetch,now:()=>start});await client.restore();fetch.mockResolvedValueOnce(response(null,401));
 await expect(client.request('/api/v1/auth/me')).rejects.toMatchObject({status:401});expect(client.getSnapshot()).toMatchObject({status:'signed-out',message:'Your session has expired. Please sign in again.'});
});

it.each(['PARENT','TEACHER'])('cookie-mode web login rejects a %s bearer response with the existing Admin-only message',async role=>{
 const fetch=vi.fn(async()=>response({...data(),user:{role},token:'synthetic-mobile-token'}));const adapter=createAdminSessionAdapter({fetchImpl:fetch});
 await expect(adapter.login('synthetic-user','synthetic-password')).rejects.toMatchObject({status:403,code:'ADMIN_REQUIRED',message:'An administrator account is required for this dashboard.'});
 expect(sessionStorage.getItem('childguardToken')).toBeNull();
});
