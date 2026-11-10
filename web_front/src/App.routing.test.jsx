import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { CookieAdminSessionProvider } from './components/CookieAdminSession';
import { createAdminSessionController } from './lib/admin-session-controller';
import { adminDestination } from './lib/admin-navigation';

vi.mock('./components/SafetyNotifications',()=>({default:({children})=>children}));
vi.mock('./pages/Dashboard',()=>({default:()=> <p>Dashboard page</p>}));
vi.mock('./pages/Devices',()=>({default:()=> <p>Devices page</p>}));
vi.mock('./pages/Children',()=>({default:()=> <p>Children page</p>}));
vi.mock('./pages/Parents',()=>({default:()=> <p>Parents page</p>}));
vi.mock('./pages/Teacher',()=>({default:()=> <p>Teachers page</p>}));
vi.mock('./pages/AttendanceOverview',()=>({default:()=> <p>Attendance page</p>}));
vi.mock('./pages/ActivityMonitoring',()=>({default:()=> <p>Activity page</p>}));
vi.mock('./pages/Alerts',()=>({default:()=> <p>Alerts page</p>}));
vi.mock('./pages/Transport',()=>({default:()=> <p>Transport page</p>}));
const at=Date.now();
const data={user:{id:'admin',role:'ADMIN',centerId:'center-a'},session:{id:'session',createdAt:new Date(at).toISOString(),idleExpiresAt:new Date(at+300000).toISOString(),absoluteExpiresAt:new Date(at+28800000).toISOString()},serverTime:new Date(at).toISOString(),csrfToken:'A'.repeat(43)};
const response=(value,status=200)=>({ok:status===200,status,json:async()=>({data:value})});
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
function Location(){return <output data-testid="location">{useLocation().pathname+useLocation().search+useLocation().hash}</output>;}
function mount(entry,authenticated=true){
 let signedIn=authenticated;
 const fetch=vi.fn(async(path)=>{
  if(path.endsWith('/login')){signedIn=true;return response(data);}
  if(path.endsWith('/logout')){signedIn=false;return response({revoked:true});}
  return signedIn?response(data):response(null,401);
 });
 const client=createAdminSessionController({fetchImpl:fetch,now:()=>at});
 const view=render(<MemoryRouter initialEntries={[entry]}><CookieAdminSessionProvider client={client}><App/><Location/></CookieAdminSessionProvider></MemoryRouter>);
 return {client,fetch,...view};
}
async function login(){
 fireEvent.change(await screen.findByLabelText('Username'),{target:{value:'admin'}});
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'password'}});
 fireEvent.submit(screen.getByRole('button',{name:'Sign In'}).closest('form'));
}
it.each(['/','/login'])('restores an Admin at %s to Dashboard and highlights it',async entry=>{
 const {fetch}=mount(entry);
 expect(await screen.findByText('Dashboard page')).toBeTruthy();
 expect(screen.getByTestId('location').textContent).toBe('/dashboard');
 expect(screen.getByRole('link',{name:'Dashboard'}).getAttribute('aria-current')).toBe('page');
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
});
it('fresh login and logout/login use Dashboard, while Devices remains navigable',async()=>{
 mount('/login',false);await login();
 expect(await screen.findByText('Dashboard page')).toBeTruthy();
 fireEvent.click(screen.getByRole('link',{name:'Wearable Devices'}));
 expect(await screen.findByText('Devices page')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Wearable Devices'}).getAttribute('aria-current')).toBe('page');
 fireEvent.click(screen.getByRole('button',{name:'Logout'}));
 await login();expect(await screen.findByText('Dashboard page')).toBeTruthy();
});
it.each(['/devices','/students','/parents','/teachers','/attendance','/activity','/alerts','/transport'])('restores the current authorized route %s',async path=>{
 const {fetch}=mount(path);
 await screen.findByRole('button',{name:'Logout'});
 expect(screen.getByTestId('location').textContent).toBe(path);
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('returns to an intentional deep link after login, preserving query and hash',async()=>{
 mount('/devices?view=assigned#readers',false);await login();
 expect(await screen.findByText('Devices page')).toBeTruthy();
 expect(screen.getByTestId('location').textContent).toBe('/devices?view=assigned#readers');
});
it.each(['https://evil.test','//evil.test','/login','/unknown','/devices/../login','/devices\\evil','javascript:alert(1)'])('rejects unsafe or unauthorized destination %s',async returnTo=>{
 expect(adminDestination(returnTo)).toBe('/dashboard');
 mount({pathname:'/login',state:{returnTo}},false);await login();
 expect(await screen.findByText('Dashboard page')).toBeTruthy();
});
it('expired sessions reach login without loops and logout clears the session',async()=>{
 const {client}=mount('/devices');await screen.findByText('Devices page');
 await act(async()=>{await client.logout();await expect(client.restore()).rejects.toMatchObject({status:401});});
 expect(await screen.findByLabelText('Username')).toBeTruthy();
 expect(client.getSnapshot().status).toBe('signed-out');
 expect(screen.getByTestId('location').textContent).toBe('/login');
});
