import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CookieAdminSessionGate,CookieAdminSessionProvider } from './CookieAdminSession';
import { createAdminSessionController } from '../lib/admin-session-controller';
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
function mount(client){return render(<MemoryRouter initialEntries={['/private']}><CookieAdminSessionProvider client={client}><Routes><Route path="/private" element={<CookieAdminSessionGate><p>Private dashboard</p></CookieAdminSessionGate>}/><Route path="/login" element={<p>Sign in</p>}/></Routes></CookieAdminSessionProvider></MemoryRouter>);}
it('denies missing/expired sessions before private content',async()=>{
 const client=createAdminSessionController({fetchImpl:async()=>({ok:false,status:401,json:async()=>({})})});mount(client);expect(await screen.findByText('Sign in')).toBeTruthy();expect(screen.queryByText('Private dashboard')).toBeNull();
});
it('renders only verified ADMIN and cleans up trusted input listeners',async()=>{
 const unbind=vi.fn(),bind=vi.fn(()=>unbind);const state={status:'ready',user:{role:'ADMIN'}};
 const client={getSnapshot:()=>state,subscribe:()=>()=>{},restore:vi.fn(async()=>{}),bindTrustedActivity:bind,remainingMs:()=>300000};const view=mount(client);expect(await screen.findByText('Private dashboard')).toBeTruthy();view.unmount();expect(unbind).toHaveBeenCalledOnce();
});
it('transient restore failures hide private content and show retry',async()=>{
 const client=createAdminSessionController({fetchImpl:async()=>{throw Error('offline');}});mount(client);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();expect(screen.queryByText('Private dashboard')).toBeNull();
});
it('expiry timer only revalidates by GET, never sends activity',async()=>{
 let scheduled;
 vi.spyOn(globalThis,'setTimeout').mockImplementation(fn=>{scheduled=fn;return 123;});vi.spyOn(globalThis,'clearTimeout').mockImplementation(()=>{});
 const restore=vi.fn(async()=>{}),client={getSnapshot:()=>state,subscribe:()=>()=>{},restore,bindTrustedActivity:()=>()=>{},remainingMs:()=>300000};const state={status:'ready',user:{role:'ADMIN'}};
 mount(client);expect(restore).toHaveBeenCalledOnce();await scheduled();expect(restore).toHaveBeenCalledTimes(2);expect(client).not.toHaveProperty('recordInteraction');
});
