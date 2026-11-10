import TechnicalDetails from '../components/TechnicalDetails';
import { approvalLabel } from '../lib/ui-language';
import ModalCloseButton from '../components/ModalCloseButton';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, CheckCircle2, XCircle, Users } from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import ActionButton from '../components/ActionButton';
import { api } from '../lib/api';
import ProfilePhoto from '../components/ProfilePhoto';
import '../style/RegistrationApproval.css';
import '../style/ApprovalRestoration.css';

const requestError=e=>e.code==='REGISTRATION_UNAVAILABLE'?'App registration requests are currently turned off. You can still manage existing accounts, children and devices on their pages.':e.message;
export default function RegistrationApproval() {
 const [rows,setRows]=useState([]),[children,setChildren]=useState([]),[wearables,setWearables]=useState([]);
 const [status,setStatus]=useState('PENDING'),[role,setRole]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[unavailable,setUnavailable]=useState(false);
 const [detail,setDetail]=useState(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[existingChildId,setExistingChildId]=useState('');
 const requestSequence=useRef(0),mutation=useRef(false),dialogRef=useRef(null);
 const invalidateRequests=useCallback(()=>{requestSequence.current++;},[]);
 const load=useCallback(async()=>{
  const sequence=++requestSequence.current;
  setBusy(true);setError('');
  try {const query=new URLSearchParams({limit:'25',offset:String(offset),...(status?{status}:{}),...(role?{role}:{}),...(search?{search}:{}),...(from?{from}:{}),...(to?{to}:{})});
   const [r,c,w]=await Promise.all([api(`/api/v1/admin/registrations?${query}`),api('/api/v1/admin/enrollments'),api('/api/v1/admin/wearable-requests')]);if(sequence===requestSequence.current){setRows(r);setChildren(c);setWearables(w);setUnavailable(false);}
  }catch(e){if(sequence===requestSequence.current){setRows([]);setChildren([]);setWearables([]);setUnavailable(e.code==='REGISTRATION_UNAVAILABLE');setError(requestError(e));}}finally{if(sequence===requestSequence.current)setBusy(false);}
 },[status,role,search,from,to,offset]);
 useEffect(()=>{const timer=window.setTimeout(()=>{load();},100);return()=>{window.clearTimeout(timer);invalidateRequests();};},[load,invalidateRequests]);
 useDialogAccessibility(dialogRef,()=>setDetail(null),{open:Boolean(detail),busy});
 async function decide(group,row,state) {
  if(mutation.current)return;
  if(state==='REJECTED'&&reason.trim().length<3){setError('Enter a reason of at least 3 characters so the applicant understands the decision.');return;}
  if(!window.confirm(`${state==='APPROVED'?'Approve':'Reject'} this ${group==='registrations'?'account registration':group==='enrollments'?'child and Parent access':'wearable assignment'} request? Account approval does not approve child or wearable relationships.`))return;
  mutation.current=true;setBusy(true);setError('');setMessage('');
  try {await api(`/api/v1/admin/${group}/${row.id}/decision`,{method:'POST',body:JSON.stringify({status:state,...(state==='REJECTED'?{reason:reason.trim()}:{} ),...(group==='enrollments'&&state==='APPROVED'&&existingChildId?{existingChildId}:{} )})});setMessage('Decision saved. The applicant can see the updated status.');setDetail(null);setReason('');await load();}catch(e){setError(requestError(e));}finally{mutation.current=false;setBusy(false);}
 }
 async function invitation(){if(mutation.current||unavailable)return;mutation.current=true;setBusy(true);setError('');setMessage('');try{const value=await api('/api/v1/admin/center-invitations',{method:'POST',body:'{}'});setMessage(`Center invitation (share privately; expires ${new Date(value.expiresAt).toLocaleString()}): ${value.code}`);}catch(e){setError(requestError(e));}finally{mutation.current=false;setBusy(false);}}
 const actions=(group,row)=><div className="cg-table-actions"><ActionButton disabled={busy} onClick={()=>{setExistingChildId('');setReason('');setDetail({group,row});}}>Review</ActionButton></div>;
 const fieldLabel=key=>({fullName:'Full name',username:'Username',email:'Email',phone:'Phone',role:'Requested role',status:'Request status',createdAt:'Submitted',reviewedAt:'Reviewed',address:'Address',relationship:'Relationship to child',dateOfBirth:'Birth date',qualifications:'Qualifications',reason:'Decision reason'})[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
 const columns=[{key:'photo',label:'Photo',width:80,render:r=><ProfilePhoto id={r.photoId} version={r.photoUpdatedAt}/>},{key:'fullName',label:'Applicant',render:r=><div className="registration-person"><strong>{r.fullName}</strong><span>{r.username}</span></div>},{key:'role',label:'Role'},{key:'status',label:'Status',width:140,render:r=>approvalLabel(r.status)},{key:'createdAt',label:'Submitted',width:180,render:r=>new Date(r.createdAt).toLocaleString()},{key:'actions',label:'Actions',render:r=>actions('registrations',r)}];
 return <div className="registration-page"><Topbar hideTitle/><main className="registration-content cg-admin-content"><h1>Requests & Approvals</h1>
 <div className="registration-stats"><StatCard title="Requests on this page" value={rows.length} icon={ClipboardList}/><StatCard title="Waiting for Approval" value={rows.filter(r=>r.status==='PENDING').length} icon={Users}/><StatCard title="Approved" value={rows.filter(r=>r.status==='APPROVED').length} icon={CheckCircle2}/><StatCard title="Rejected" value={rows.filter(r=>r.status==='REJECTED').length} icon={XCircle}/></div>
 {!detail&&error&&<p role="alert" className="registration-error">{error}</p>}{message&&<p role="status" className="registration-success">{message}</p>}
 <div className="registration-tools"><label>Status <select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">All</option>{['PENDING','APPROVED','REJECTED'].map(v=><option key={v} value={v}>{approvalLabel(v)}</option>)}</select></label><label>Role <select value={role} onChange={e=>{setRole(e.target.value);setOffset(0);}}><option value="">All</option><option value="PARENT">Parent</option><option value="TEACHER">Teacher</option></select></label><label>Search <input value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label><label>From <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setOffset(0);}}/></label><label>To <input type="date" value={to} onChange={e=>{setTo(e.target.value);setOffset(0);}}/></label><ActionButton onClick={load} disabled={busy}>Refresh</ActionButton><ActionButton onClick={invitation} disabled={busy||unavailable}>Create center invitation</ActionButton></div>
 <DataTable caption="Registration requests" columns={columns} data={rows} loading={busy} emptyMessage="No registration requests match these filters."/>
 <div className="cg-pagination"><ActionButton disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous</ActionButton><ActionButton disabled={busy||rows.length<25} onClick={()=>setOffset(offset+25)}>Next</ActionButton></div>
 <section className="cg-panel registration-review-section"><h2>Child registration and Parent access requests</h2><DataTable caption="Child registration and Parent access requests" minWidth={680} emptyMessage="No child registration or Parent access requests." data={children} columns={[{key:'fullName',label:'Child',render:r=>r.fullName||r.existingChildId},{key:'relationship',label:'Relationship'},{key:'status',label:'Status',width:140,render:r=>approvalLabel(r.status)},{key:'actions',label:'Actions',render:r=>actions('enrollments',r)}]}/>
 </section><section className="cg-panel registration-review-section"><h2>Wearable assignment requests</h2><DataTable caption="Wearable assignment requests" minWidth={700} emptyMessage="No wearable assignment requests." data={wearables} columns={[{key:'hardwareId',label:'Device'},{key:'status',label:'Status',width:140,render:r=>approvalLabel(r.status)},{key:'claimVerified',label:'Parent request code',render:r=>r.claimVerified?'Valid, unused':'Unverified / expired / consumed'},{key:'actions',label:'Actions',render:r=>actions('wearable-requests',r)}]}/>
 </section>
 {detail&&<div className="registration-modal-overlay"><section ref={dialogRef} id="registration-dialog" tabIndex={-1} className="registration-modal" role="dialog" data-dialog-size="medium" aria-modal="true" aria-label="Review request"><div className="registration-modal__header"><h2>{detail.group==='registrations'?'Review Account Registration':detail.group==='enrollments'?'Review Child and Parent Access':'Review Wearable Request'}</h2><ModalCloseButton onClick={()=>setDetail(null)} disabled={busy}/></div>{error&&<p role="alert" className="registration-error">{error}</p>}
 {detail.row.photoId&&<ProfilePhoto id={detail.row.photoId} version={detail.row.photoUpdatedAt}/>}
 <dl>{Object.entries(detail.row).filter(([key,v])=>!['photoId','children','decisions','device','wearable'].includes(key)&&typeof v!=='object'&&!/id$|token|hash|secret/i.test(key)).map(([key,v])=><div key={key}><dt>{fieldLabel(key)}</dt><dd>{key==='status'?approvalLabel(v):key==='role'?v==='PARENT'?'Parent':v==='TEACHER'?'Teacher':String(v):/At$/.test(key)&&v?new Date(v).toLocaleString():String(v??'Not recorded')}</dd></div>)}</dl>
 <TechnicalDetails title="Request reference numbers"><dl>{Object.entries(detail.row).filter(([key,v])=>/id$/i.test(key)&&typeof v!=='object'&&!/photo/i.test(key)).map(([key,v])=><div key={key}><dt>{fieldLabel(key)}</dt><dd>{String(v??'Not recorded')}</dd></div>)}</dl></TechnicalDetails>
 {detail.row.children?.map(child=><p key={child.id}>{child.fullName||child.existingChildId} / {child.relationship} / {child.status} / Wearable: {child.wearable?.hardwareId||'Not requested'}</p>)}
 {detail.group==='enrollments'&&!detail.row.existingChildId&&<label>Existing child reference (optional; only after checking for duplicates)<input value={existingChildId} onChange={e=>setExistingChildId(e.target.value)}/></label>}
 {detail.row.duplicateCandidates?.map(c=><p key={c.id}>Possible duplicate: {c.name} / {c.id} / {c.dateOfBirth?.slice(0,10)||'Birth date not recorded'}</p>)}
 {detail.row.device&&<p>Wearable: {detail.row.device.hardwareId}; active assignments: {detail.row.device.assignments.length}</p>}
 {detail.row.decisions?.map((d,i)=><p key={i}>{approvalLabel(d.status)} / {new Date(d.createdAt).toLocaleString()} / {d.reason||'Approved'}</p>)}
 <label>Reason shown to the applicant (required to reject)<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
 {detail.row.status==='PENDING'&&<div className="registration-modal__actions"><ActionButton disabled={busy} onClick={()=>decide(detail.group,detail.row,'APPROVED')}>Approve</ActionButton><ActionButton disabled={busy} onClick={()=>decide(detail.group,detail.row,'REJECTED')}>Reject</ActionButton></div>}
 </section></div>}
 </main><Footer/></div>;
}
