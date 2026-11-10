import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {attendanceTime,checkinTime,checkoutTime,lastAttendanceUpdate,attendanceCsvRows,csvText,loadAttendanceReport,downloadCsv} from './attendance-report';
import {getMonthDates,getTodayKey} from './attendanceDates';
import {monitoringRequest} from './monitoring-request';
vi.mock('./monitoring-request',()=>({monitoringRequest:vi.fn()}));
const row=(id,status='PRESENT',day='2026-10-25')=>({child:{id:`child-${id}`,name:`Child ${id}`},day,status,confirmation:{username:'Teacher',confirmedAt:'2026-10-25T05:00:00Z'},checkout:{at:'2026-10-25T08:00:00Z',by:{username:'Checkout Teacher'}}});
beforeEach(()=>monitoringRequest.mockReset());
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('uses Colombo time independently of browser timezone and preserves missing timestamps',()=>{
 expect(attendanceTime('2026-10-25T05:01:00Z')).toContain('10:31');expect(attendanceTime('2026-12-31T18:45:00Z')).toContain('01 Jan 2027');expect(attendanceTime(null)).toBe('Not recorded');expect(attendanceTime('bad')).toBe('Not recorded');
});
it.each([['2024-02',29],['2026-02',28],['2026-12',31],['2027-01',31]])('retains correct month boundaries for %s', (month,count)=>{
 const days=getMonthDates(month);expect(days).toHaveLength(count);expect(days[0]).toBe(`${month}-01`);expect(days.at(-1)).toBe(`${month}-${count}`);
});
it('chooses the Colombo current day at year rollover rather than the UTC day',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-31T18:30:00Z'));expect(getTodayKey()).toBe('2027-01-01');
});
it.each(['CHECKIN_PENDING','ABSENT','NOT_CHECKED_IN','NO_RECORD'])('does not invent check-in or checkout for %s even with stale evidence',status=>{
 const record=row(1,status);expect(checkinTime(record)).toBeNull();expect(checkoutTime(record)).toBeNull();const csv=attendanceCsvRows([record]);expect(csv[1][8]).toBeNull();expect(csv[1][9]).toBeNull();expect(csv[1][3]).toBe(status);
});
it('preserves both actual check-in and checkout and chooses the latest evidence after absence correction',()=>{
 const record={...row(1,'CHECKED_OUT'),absenceHistory:[{at:'2026-10-25T03:00:00Z'},{at:'2026-10-25T04:00:00Z'}]};expect(lastAttendanceUpdate(record)).toBe(record.checkout.at);expect(checkinTime(record)).toBe(record.confirmation.confirmedAt);expect(checkoutTime(record)).toBe(record.checkout.at);expect(attendanceCsvRows([record])[1].at(-1)).toBe('Asia/Colombo');
});
it('quotes Unicode, commas, quotes and newlines and neutralizes spreadsheet formulas',()=>{
 const text=csvText([['Child','Value'],['සිංහල, "Name"\nNext','=HYPERLINK("bad")'],...['+1','-1','@SUM(1)','\t=1','\r=1',' =1'].map(value=>[value])]);
 expect(text.startsWith('\uFEFF')).toBe(true);expect(text).toContain('"සිංහල, ""Name""\nNext"');expect(text).toContain('"\'=HYPERLINK(""bad"")"');for(const value of ['+1','-1','@SUM(1)','\t=1','\r=1',' =1'])expect(text).toContain(`"'${value}"`);
});
it('loads all matching pages from offset zero using the existing authenticated read contract',async()=>{
 monitoringRequest.mockResolvedValueOnce({rows:Array.from({length:50},(_,i)=>row(i)),hasMore:true}).mockResolvedValueOnce({rows:[row(50)],hasMore:false});
 const signal=new AbortController().signal,records=await loadAttendanceReport('/api/v1/attendance?management=true&view=roster&day=2026-10-25&search=Demo Child&status=PRESENT&offset=125',{signal});
 expect(records).toHaveLength(51);expect(monitoringRequest).toHaveBeenCalledTimes(2);
 for(const [index,[path,options]] of monitoringRequest.mock.calls.entries()){
  const q=new URLSearchParams(path.split('?')[1]);expect(q.get('offset')).toBe(String(index*50));expect(q.get('limit')).toBe('50');expect(q.get('day')).toBe('2026-10-25');expect(q.get('search')).toBe('Demo Child');expect(q.get('status')).toBe('PRESENT');expect(options).toEqual({signal});
 }
});
it('loads only actual monthly records without adding missing dates or collapsing different days for one child',async()=>{
 monitoringRequest.mockResolvedValue({rows:[row(1,'ABSENT','2024-02-01'),row(1,'CHECKED_OUT','2024-02-29')],hasMore:false});
 const records=await loadAttendanceReport('/api/v1/attendance?management=true&view=history&from=2024-02-01&to=2024-02-29');expect(records.map(r=>[r.day,r.status])).toEqual([['2024-02-01','ABSENT'],['2024-02-29','CHECKED_OUT']]);
});
it('returns an authoritative empty report without inventing rows',async()=>{
 monitoringRequest.mockResolvedValue({rows:[],hasMore:false});expect(await loadAttendanceReport('/api/v1/attendance?view=roster&day=2026-10-25')).toEqual([]);
});
it.each([
 {rows:[row(1),row(1)],hasMore:false},
 {rows:[row(1,'ABSENT','2026-10-24')],hasMore:false},
 {rows:[row(1,'ABSENT')],hasMore:true},
 {rows:[row(1,'FAKE')],hasMore:false},
 {rows:[],hasMore:undefined},
])('refuses duplicate, out-of-scope or incomplete report data',async page=>{
 monitoringRequest.mockResolvedValue(page);await expect(loadAttendanceReport('/api/v1/attendance?management=true&view=roster&day=2026-10-25')).rejects.toThrow();
});
it('does not turn a later-page failure into a partial successful report',async()=>{
 monitoringRequest.mockResolvedValueOnce({rows:Array.from({length:50},(_,i)=>row(i)),hasMore:true}).mockRejectedValueOnce(Error('offline'));
 await expect(loadAttendanceReport('/api/v1/attendance?view=roster&day=2026-10-25')).rejects.toThrow('offline');
});
it('cleans up a failed browser download and does not report it as successful',()=>{
 vi.useFakeTimers();const revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(value){revoke(value);}});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{throw Error('download failed');});
 expect(()=>downloadCsv([['test']],'attendance.csv')).toThrow('download failed');expect(document.querySelector('a[download]')).toBeNull();vi.runAllTimers();expect(revoke).toHaveBeenCalledWith('blob:test');
});
