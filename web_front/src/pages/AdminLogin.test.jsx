import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLogin from './AdminLogin';

beforeEach(()=>sessionStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();});
const mount=role=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({data:{token:'synthetic-token',user:{role}}})});
 render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<AdminLogin/>}/><Route path="/dashboard" element={<p>Authenticated dashboard route</p>}/></Routes></MemoryRouter>);
 const inputs=document.querySelectorAll('input');
 fireEvent.change(inputs[0],{target:{value:'synthetic-user'}});
 fireEvent.change(inputs[1],{target:{value:'synthetic-password'}});
 fireEvent.submit(inputs[0].closest('form'));
};
it.each(['PARENT','TEACHER'])('rejects %s tokens from the Admin login without changing UI',async role=>{
 sessionStorage.setItem('childguardToken','stale-token');
 mount(role);
 expect(await screen.findByText('An administrator account is required for this dashboard.')).toBeTruthy();
 expect(sessionStorage.getItem('childguardToken')).toBeNull();
 expect(screen.queryByText('Authenticated dashboard route')).toBeNull();
});
it('stores an Admin token and follows the existing dashboard route',async()=>{
 mount('ADMIN');
 expect(await screen.findByText('Authenticated dashboard route')).toBeTruthy();
 expect(sessionStorage.getItem('childguardToken')).toBe('synthetic-token');
});
function fillLogin() {
 render(<MemoryRouter><AdminLogin/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'admin'}});
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'synthetic-password'}});
 return screen.getByRole('button',{name:'Sign In'}).closest('form');
}
it('locks duplicate submissions synchronously and shows loading until the request finishes',async()=>{
 let finish;
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const form=fillLogin();
 fireEvent.submit(form);fireEvent.submit(form);
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Signing in…'}).disabled).toBe(true);
 expect(form.getAttribute('aria-busy')).toBe('true');
 await act(async()=>finish({ok:false,status:401,json:async()=>({error:{code:'INVALID_CREDENTIALS'}})}));
 expect(await screen.findByText('Invalid username or password.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Sign In'}).disabled).toBe(false);
});
it.each([
 [401,'Invalid username or password.'],
 [429,'Too many attempts. Please wait a minute before trying again.'],
])('shows HTTP %s failures and permits another attempt',async(status,message)=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status,json:async()=>({})});
 const form=fillLogin();fireEvent.submit(form);
 expect(await screen.findByRole('alert')).toHaveProperty('textContent',message);
 fireEvent.submit(form);await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
});
it('shows a network failure, clears stale browser identity, and permits retry',async()=>{
 sessionStorage.setItem('childguardToken','stale');sessionStorage.setItem('childguardAdminName','Old Admin');
 vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));
 fireEvent.submit(fillLogin());
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Cannot reach ChildGuard API. Check your connection and try again.');
 expect(sessionStorage.getItem('childguardToken')).toBeNull();expect(sessionStorage.getItem('childguardAdminName')).toBeNull();
 expect(screen.getByRole('button',{name:'Sign In'}).disabled).toBe(false);
});
it('does not store an absent token from an otherwise ADMIN response',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({data:{user:{role:'ADMIN'}}})});
 fireEvent.submit(fillLogin());
 expect(await screen.findByText('Unexpected sign-in response. Please try again.')).toBeTruthy();
 expect(sessionStorage.getItem('childguardToken')).toBeNull();
});
