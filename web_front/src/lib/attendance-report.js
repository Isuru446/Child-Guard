export const confirmationLabel=c=>c?.method==='RFID_CARD'?`RFID Card / ${c.reader?.hardwareId||'Registered reader'}`:c?.username||'Not confirmed';
import {monitoringRequest} from './monitoring-request';

export const attendanceTime=value=>value&&Number.isFinite(+new Date(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value)):'Not recorded';
export const checkinTime=row=>['PRESENT','CHECKED_OUT'].includes(row.status)?row.confirmation?.confirmedAt:null;
export const checkoutTime=row=>row.status==='CHECKED_OUT'?row.checkout?.at:null;
export function lastAttendanceUpdate(row){
 const candidates=[row.arrival?.receivedAt,checkinTime(row),checkoutTime(row),...(row.absenceHistory??[]).map(a=>a.at),...(row.resets??[]).map(a=>a.createdAt)].filter(value=>value&&Number.isFinite(+new Date(value)));
 return candidates.sort((a,b)=>+new Date(b)-+new Date(a))[0]??null;
}
export function attendanceCsvRows(rows){
 return [['Date','Child reference','Child','Attendance status','Arrival belt','Gate receipt','Confirmed by','Role at confirmation','Confirmed at','Checked out at','Checked out by','Absence history','Last updated','Check-in (Sri Lanka)','Check-out (Sri Lanka)','Attendance day timezone'],...rows.map(r=>[r.day,r.child.id,r.child.name,r.status,r.arrival?.wearable,r.arrival?.receivedAt,checkinTime(r)?confirmationLabel(r.confirmation):null,checkinTime(r)?r.confirmation?.roleAtConfirmation:null,checkinTime(r),checkoutTime(r),checkoutTime(r)?r.checkout?.by?.username:null,(r.absenceHistory??[]).map(a=>`${a.type}: ${a.by?.username??a.by?.id??'Not recorded'} / ${a.at}`).join('; '),lastAttendanceUpdate(r),checkinTime(r)?attendanceTime(checkinTime(r)):null,checkoutTime(r)?attendanceTime(checkoutTime(r)):null,'Asia/Colombo'])];
}
export function csvText(rows){
 const cell=value=>{const raw=String(value??''),safe=raw.charCodeAt(0)<32||/^[\s=+@-]/u.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadCsv(rows,name){
 const url=URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');
 try{anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();}
 finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
}
// Reuse the existing authenticated, center-scoped read endpoint; never POST.
export async function loadAttendanceReport(path,{signal}={}){
 const query=new URLSearchParams(path.split('?')[1]),records=new Map();query.set('management','true');query.set('limit','50');
 for(let offset=0;offset<=10000;offset+=50){
  query.set('offset',String(offset));const page=await monitoringRequest(`/api/v1/attendance?${query}`,{signal});
  if(!Array.isArray(page?.rows)||page.rows.length>50||typeof page.hasMore!=='boolean')throw Error('Incomplete attendance report');
  for(const row of page.rows){
   if(!row.child?.id||typeof row.child.name!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!['PRESENT','CHECKIN_PENDING','ABSENT','CHECKED_OUT','NOT_CHECKED_IN','NO_RECORD'].includes(row.status))throw Error('Invalid attendance report');
   if((query.get('view')==='roster'&&row.day!==query.get('day'))||(query.get('view')==='history'&&(row.day<query.get('from')||row.day>query.get('to')||row.status==='NO_RECORD'))||(query.get('status')&&row.status!==query.get('status')))throw Error('Attendance report scope changed');
   const key=`${row.child.id}:${row.day}`;if(records.has(key))throw Error('Attendance changed during export. Refresh and try again.');records.set(key,row);
  }
  if(!page.hasMore)return [...records.values()];
  if(page.rows.length!==50)throw Error('Incomplete attendance report');
 }
 throw Error('Report exceeds the attendance read limit. Narrow your search.');
}
