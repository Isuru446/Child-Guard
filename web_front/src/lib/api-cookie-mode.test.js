import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(()=>vi.resetModules());
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();sessionStorage.clear();});
it('cookie mode ignores the old direct API base and legacy bearer storage for JSON and photos',async()=>{
 vi.stubEnv('VITE_API_BASE_URL','http://unused-direct.invalid:3100');sessionStorage.setItem('childguardToken','synthetic-old-token');
 const fetch=vi.spyOn(globalThis,'fetch');const api=await import('./api');const client={request:vi.fn(async()=>({ok:true})),privatePhoto:vi.fn(async()=> 'blob:synthetic'),getSnapshot:()=>({status:'ready'})};
 api.configureAdminCookieClient(client);expect(await api.api('/api/v1/auth/me')).toEqual({ok:true});expect(await api.privatePhoto('synthetic-id')).toBe('blob:synthetic');expect(client.request).toHaveBeenCalledWith('/api/v1/auth/me',{});expect(fetch).not.toHaveBeenCalled();
 expect(()=>api.setToken('synthetic-new-token')).toThrow('Bearer storage disabled');expect(()=>api.clearSession()).toThrow('asynchronous server logout');
});
it('cookie-client configuration cannot silently switch to a different transport',async()=>{
 const api=await import('./api'),client={request:vi.fn()};api.configureAdminCookieClient(client);expect(()=>api.configureAdminCookieClient({request:vi.fn()})).toThrow('configuration refused');
});
