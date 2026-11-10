import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminSessionGate from './AdminSessionGate';
import { clearSession } from '../lib/api';
import AdminLogin from '../pages/AdminLogin';

beforeEach(()=>{sessionStorage.clear();sessionStorage.setItem('childguardToken','synthetic-token');});
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();});
const mount=()=>render(<MemoryRouter initialEntries={['/private']}><Routes>
 <Route path="/private" element={<AdminSessionGate><p>Protected dashboard</p></AdminSessionGate>}/>
 <Route path="/login" element={<p>Login required</p>}/>
</Routes></MemoryRouter>);
it.each(['PARENT','TEACHER'])('rejects a restored %s session from Admin routes',async role=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({data:{role}})});
 mount();expect(await screen.findByText('Login required')).toBeTruthy();
 expect(screen.queryByText('Protected dashboard')).toBeNull();expect(sessionStorage.getItem('childguardToken')).toBeNull();
});
it('verifies the real Admin identity before rendering and handles session expiration',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({data:{role:'ADMIN',username:'synthetic-admin'}})});
 mount();expect(await screen.findByText('Protected dashboard')).toBeTruthy();
 expect(sessionStorage.getItem('childguardAdminName')).toBe('synthetic-admin');
 clearSession();expect(await screen.findByText('Login required')).toBeTruthy();
});
it('offers retry on a network failure without granting access',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('offline'));
 mount();expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Protected dashboard')).toBeNull();
 fetch.mockResolvedValue({ok:true,json:async()=>({data:{role:'ADMIN'}})});
 fireEvent.click(screen.getByText('Retry'));expect(await screen.findByText('Protected dashboard')).toBeTruthy();
});
it('redirects visitors with no token without fetching or rendering private content',async()=>{
 sessionStorage.clear();const fetch=vi.spyOn(globalThis,'fetch');
 mount();expect(await screen.findByText('Login required')).toBeTruthy();
 expect(fetch).not.toHaveBeenCalled();expect(screen.queryByText('Protected dashboard')).toBeNull();
});
it('shows expired-session explanation on the existing login screen even for a non-JSON 401',async()=>{
 sessionStorage.setItem('childguardAdminName','Old Admin');
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status:401,json:async()=>{throw Error('proxy');}});
 render(<MemoryRouter initialEntries={['/private']}><Routes>
  <Route path="/private" element={<AdminSessionGate><p>Protected dashboard</p></AdminSessionGate>}/>
  <Route path="/login" element={<AdminLogin/>}/>
 </Routes></MemoryRouter>);
 expect(await screen.findByText('Your session has expired. Please sign in again.')).toBeTruthy();
 expect(screen.queryByText('Protected dashboard')).toBeNull();
 expect(sessionStorage.getItem('childguardToken')).toBeNull();expect(sessionStorage.getItem('childguardAdminName')).toBeNull();
});
