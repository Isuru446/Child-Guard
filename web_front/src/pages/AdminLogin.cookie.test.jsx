import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AdminLogin from './AdminLogin';
import AdminSessionGate from '../components/AdminSessionGate';
import AdminSidebar from '../components/AdminSidebar';
import { CookieAdminSessionProvider } from '../components/CookieAdminSession';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import { createAdminSessionController } from '../lib/admin-session-controller';
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();});
const at=Date.parse('2026-10-25T08:00:00.000Z');
const data={user:{id:'user-a',username:'admin',role:'ADMIN',centerId:'center-a'},session:{id:'session-a',createdAt:new Date(at).toISOString(),idleExpiresAt:new Date(at+300000).toISOString(),absoluteExpiresAt:new Date(at+28800000).toISOString()},serverTime:new Date(at).toISOString(),csrfToken:'A'.repeat(43)};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>({data})});
const mount=client=>render(<MemoryRouter initialEntries={['/login']}><CookieAdminSessionProvider client={client}><Routes><Route path="/login" element={<AdminLogin/>}/><Route path="/dashboard" element={<AdminSessionGate><p>Cookie-protected dashboard</p></AdminSessionGate>}/></Routes></CookieAdminSessionProvider></MemoryRouter>);
it('existing login UI submits once, shows loading and opens protected pages without storing a bearer',async()=>{
 let finish;const fetch=vi.fn(path=>path.endsWith('/me')?Promise.resolve(response(null,401)):new Promise(resolve=>{finish=resolve;}));
 const client=createAdminSessionController({fetchImpl:fetch,now:()=>at});mount(client);await waitFor(()=>expect(client.getSnapshot().status).toBe('signed-out'));
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'admin'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'synthetic-password'}});
 const form=screen.getByRole('button',{name:'Sign In'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);
 expect(screen.getByRole('button',{name:'Signing in…'}).disabled).toBe(true);expect(fetch.mock.calls.filter(([p])=>p.endsWith('/login'))).toHaveLength(1);
 await act(async()=>finish(response(data)));expect(await screen.findByText('Cookie-protected dashboard')).toBeTruthy();expect(sessionStorage.getItem('childguardToken')).toBeNull();expect(sessionStorage.getItem('childguardAdminName')).toBeNull();
 expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/login');expect(fetch.mock.calls[1][1].headers.has('Authorization')).toBe(false);
});
it('cookie login preserves invalid-credential messages and re-enables the current form',async()=>{
 const client=createAdminSessionController({fetchImpl:async()=>response(null,401),now:()=>at});mount(client);await waitFor(()=>expect(client.getSnapshot().status).toBe('signed-out'));
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'admin'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'wrong-synthetic'}});fireEvent.submit(screen.getByRole('button',{name:'Sign In'}).closest('form'));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Invalid username or password.');expect(screen.getByRole('button',{name:'Sign In'}).disabled).toBe(false);
});
function LogoutResult(){return <p>{useLocation().state?.sessionMessage||'Signed out'}</p>;}
it.each([false,true])('existing sidebar awaits cookie logout and reports revocation failure=%s',async failed=>{
 let finish;const logout=vi.fn(()=>new Promise((resolve,reject)=>{finish=()=>failed?reject(Error('offline')):resolve({revoked:true});}));
 const client={logout,getSnapshot:()=>({status:'ready',user:{username:'admin'}})};
 render(<MemoryRouter initialEntries={['/private']}><CookieAdminSessionContext.Provider value={client}><Routes><Route path="/private" element={<AdminSidebar isOpen/>}/><Route path="/login" element={<LogoutResult/>}/></Routes></CookieAdminSessionContext.Provider></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Logout'}));expect(logout).toHaveBeenCalledOnce();expect(screen.queryByText('Signed out')).toBeNull();await act(async()=>finish());
 expect(await screen.findByText(failed?'Signed out on this device. Server sign-out is not yet confirmed.':'Signed out')).toBeTruthy();
});
