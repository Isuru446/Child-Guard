import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
afterEach(()=>{cleanup();sessionStorage.clear();});
it('sidebar logout clears credentials and cached identity',()=>{
 sessionStorage.setItem('childguardToken','synthetic-token');
 sessionStorage.setItem('childguardAdminName','Synthetic Admin');
 render(<MemoryRouter><AdminSidebar isOpen={true}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Logout'}));
 expect(sessionStorage.getItem('childguardToken')).toBeNull();
 expect(sessionStorage.getItem('childguardAdminName')).toBeNull();
});
