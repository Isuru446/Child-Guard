export const attendanceStates = [
  { key: 'PRESENT', name: 'Present', short: 'Present', color: '#0284c7' },
  { key: 'CHECKIN_PENDING', name: 'Pending', short: 'Pending', color: '#d99a2b' },
  { key: 'NOT_CHECKED_IN', name: 'Not Checked In Yet', short: 'Not checked in', color: '#64748b' },
  { key: 'CHECKED_OUT', name: 'Checked Out', short: 'Checked out', color: '#8b5cf6' },
  { key: 'ABSENT', name: 'Absent', short: 'Absent', color: '#dc6262' },
  { key: 'NO_RECORD', name: 'No Attendance Recorded', short: 'No record', color: '#b8c6d8' },
];
const count = value => Number.isSafeInteger(value) && value >= 0;

// Presentation only. Raw states below remain available to details, history and CSV.
export const attendanceDecisionStates = ['PRESENT','CHECKIN_PENDING','ABSENT','CHECKED_OUT']
  .map(key => attendanceStates.find(state => state.key === key));
export function attendanceLabel(status, details = false) {
  if (!details && ['NOT_CHECKED_IN','NO_RECORD'].includes(status)) return '—';
  return attendanceStates.find(state => state.key === status)?.name || status || '—';
}

export function attendanceChartData(summary, roster = true) {
  const legend = attendanceDecisionStates.map(state => ({...state,value:count(summary?.[state.key])?summary[state.key]:null}));
  const all = attendanceDistribution(summary,roster);
  const storedTotal = all.reduce((total,state) => total+(state.value??0),0);
  const total = roster ? summary?.rosterCount : storedTotal;
  const complete = legend.every(state => state.value!==null) && all.every(state => state.value!==null)
    && count(total) && (!roster || total===storedTotal);
  const decisions = legend.reduce((total,state) => total+(state.value??0),0);
  const remainder = complete ? total-decisions : null;
  // Keep the full denominator without promoting undecided/missing records as statuses.
  const slices = complete ? [...legend,...(remainder>0?[{key:'UNDECIDED',name:'No attendance decision',value:remainder,color:'#dce5ef'}]:[])] : [];
  return {legend,slices,total:complete?total:null,decisions:complete?decisions:null,remainder,complete};
}

export function attendanceDistribution(summary, roster = true) {
  return attendanceStates.filter(s => (roster || s.key !== 'NO_RECORD') && (s.key !== 'ABSENT' || summary?.ABSENT !== undefined))
    .map(s => ({ ...s, value: count(summary?.[s.key]) ? summary[s.key] : null }));
}

// Only days actually returned by the API. Gaps are not manufactured observations.
export function attendanceTrend(rows = []) {
  const days = new Map();
  for (const row of rows) {
    if (!attendanceStates.filter(s => s.key !== 'NO_RECORD').some(s => s.key === row.status) || !count(row.count) || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue;
    const day = days.get(row.day) ?? { day: row.day, PRESENT: 0, CHECKIN_PENDING: 0, NOT_CHECKED_IN: 0, CHECKED_OUT: 0, ABSENT: 0 };
    day[row.status] += row.count;
    days.set(row.day, day);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
