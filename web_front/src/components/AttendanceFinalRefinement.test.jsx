import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import AttendanceOverview from '../pages/AttendanceOverview';
import {api} from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));vi.mock('./Topbar',()=>({default:()=>null}));vi.mock('./Footer',()=>({default:()=>null}));
vi.mock('./AttendanceCharts',()=>({default:()=>null}));vi.mock('./AttendanceExplorer',()=>({default:()=>null}));vi.mock('./PendingAttendance',()=>({default:()=>null}));
beforeEach(()=>{api.mockResolvedValue({rows:[{id:'a',child:{id:'child',name:'Actual child'},day:'2026-10-27',status:'CHECKED_OUT',confirmation:{confirmedAt:'2026-10-27T03:00:00Z',username:'teacher'},checkout:{at:'2026-10-27T05:00:00Z',by:{username:'teacher'}}}],hasMore:false});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows recorded check-out times without offering an Admin handover or departure action',async()=>{
 render(<MemoryRouter><AttendanceOverview/></MemoryRouter>);await screen.findByText('Actual child');
 expect(screen.getByRole('columnheader',{name:'Check-in Time'})).toBeTruthy();expect(screen.getByRole('columnheader',{name:'Check-out Time'})).toBeTruthy();expect(screen.getByRole('columnheader',{name:'Last Updated'})).toBeTruthy();
 expect(screen.getByRole('cell',{name:'Checked Out'})).toBeTruthy();expect(screen.queryByRole('button',{name:/check out|mark absent|approve attendance/i})).toBeNull();
 const status=screen.getByLabelText('Attendance status');expect(within(status).getByRole('option',{name:'Absent'})).toBeTruthy();expect(screen.getByText(/Teachers record attendance in the Teacher app/)).toBeTruthy();
 fireEvent.change(status,{target:{value:'CHECKED_OUT'}});await screen.findByText('Actual child');
 expect(screen.queryByText('How to use this page')).toBeNull();
});
