import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChildProfileEvidence from './ChildProfileEvidence';
import { api } from '../lib/api';
import { getTodayKey } from '../lib/attendanceDates';
import { readAttendanceMonitoring } from '../../../backend/src/attendance-monitoring.js';

vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,BarChart:({data})=><output aria-label="Backend chart records">{JSON.stringify(data)}</output>,Bar:()=>null,CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('renders the actual backend reader contract for the exact authorized child, including same-name isolation',async()=>{
  const child={id:'12345678-1234-4234-8234-123456789abc',name:'Shared name',guardians:[],assignments:[]};
  const other={...child,id:'12345678-1234-4234-8234-123456789abd'};
  const row=c=>({id:c.id,child:c,childId:c.id,day:getTodayKey(),status:'PRESENT',confirmations:[],observations:[]});
  const db={
    $queryRaw:async()=>[{now:new Date()}],child:{count:async()=>2},
    attendance:{groupBy:async()=>[{day:getTodayKey(),status:'PRESENT',_count:{_all:2}}],findMany:vi.fn(async({where})=>[row(child),row(other)].filter(r=>where.child.centerId==='center-a'&&where.child.id===r.childId))},
    assignment:{findMany:async()=>[]},auditLog:{findMany:async()=>[]},
  };
  api.mockImplementation(path=>readAttendanceMonitoring(db,{user:{role:'ADMIN',centerId:'center-a'},query:Object.fromEntries(new URLSearchParams(path.split('?')[1]))}));
  render(<MemoryRouter><ChildProfileEvidence child={child}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  const chart=await screen.findByLabelText('Backend chart records');
  const data=JSON.parse(chart.textContent);expect(data).toHaveLength(1);expect(data[0].PRESENT).toBe(1);
  expect(db.attendance.findMany.mock.calls[0][0].where.child).toMatchObject({centerId:'center-a',id:child.id});
  expect(screen.getByLabelText(`${getTodayKey()}: Present`)).toBeTruthy();
});

it('surfaces the actual backend role rejection without substituting a successful empty history',async()=>{
  api.mockImplementation(path=>readAttendanceMonitoring({}, {user:{role:'TEACHER',centerId:'center-a'},query:Object.fromEntries(new URLSearchParams(path.split('?')[1]))}));
  render(<MemoryRouter><ChildProfileEvidence child={{id:'12345678-1234-4234-8234-123456789abc',name:'Synthetic child',guardians:[],assignments:[]}}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Load monthly records'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Administrator required');
  expect(screen.queryByLabelText('Backend chart records')).toBeNull();
});
