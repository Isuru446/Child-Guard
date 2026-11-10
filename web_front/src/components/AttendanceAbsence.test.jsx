import {it,expect} from 'vitest';
import {attendanceTrend,attendanceDistribution,attendanceStates} from './attendance-chart-data';
import {dashboardAttendance,dashboardDaily} from '../lib/dashboard-attendance';
it('keeps recorded absence distinct from missing records in charts and Dashboard',()=>{
 const counts={PRESENT:2,CHECKIN_PENDING:1,NOT_CHECKED_IN:1,CHECKED_OUT:1,ABSENT:3,NO_RECORD:4,rosterCount:12};
 expect(attendanceDistribution(counts).find(s=>s.key==='ABSENT').value).toBe(3);
 expect(attendanceTrend([{day:'2026-10-27',status:'ABSENT',count:3},{day:'2026-10-27',status:'NO_RECORD',count:4}])).toEqual([{day:'2026-10-27',PRESENT:0,CHECKIN_PENDING:0,NOT_CHECKED_IN:0,CHECKED_OUT:0,ABSENT:3}]);
 expect(dashboardDaily(counts)).toMatchObject({absent:3,noRecord:4,present:2});expect(dashboardAttendance([{status:'ABSENT'},{status:'NO_RECORD'}])).toMatchObject({absent:1,total:1});
 expect(attendanceStates.find(s=>s.key==='ABSENT').name).toBe('Absent');
});
