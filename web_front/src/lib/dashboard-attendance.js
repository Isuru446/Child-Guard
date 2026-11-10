// Stored V2 states only. Missing records and pending arrival never become absence.
export function dashboardAttendance(records) {
  const counts={present:0,notCheckedIn:0,pending:0,checkedOut:0,absent:0};
  const keys={Present:'present',PRESENT:'present',NOT_CHECKED_IN:'notCheckedIn',CHECKIN_PENDING:'pending',CHECKED_OUT:'checkedOut',ABSENT:'absent'};
  for(const record of records){const key=keys[record.status];if(key)counts[key]++;}
  const total=Object.values(counts).reduce((n,value)=>n+value,0);
  return {...counts,total,rate:total?Number((counts.present/total*100).toFixed(1)):null};
}
export function dashboardDaily(summary) {
  const keys=['PRESENT','NOT_CHECKED_IN','CHECKIN_PENDING','CHECKED_OUT','NO_RECORD','rosterCount'];
  if(!keys.every(key=>Number.isSafeInteger(summary?.[key])&&summary[key]>=0))return null;
  if(summary.ABSENT!==undefined&&(!Number.isSafeInteger(summary.ABSENT)||summary.ABSENT<0))return null;
  return {absent:Number.isSafeInteger(summary.ABSENT)?summary.ABSENT:null,present:summary.PRESENT,notCheckedIn:summary.NOT_CHECKED_IN,pending:summary.CHECKIN_PENDING,checkedOut:summary.CHECKED_OUT,noRecord:summary.NO_RECORD,total:summary.rosterCount,rate:summary.rosterCount?Number((summary.PRESENT/summary.rosterCount*100).toFixed(1)):null};
}
