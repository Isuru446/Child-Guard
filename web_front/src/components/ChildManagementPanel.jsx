import RfidCards from './RfidCards';
import { requestMessage } from '../lib/ui-language';
import ModalCloseButton from './ModalCloseButton';
import useDialogAccessibility, { canDismissDialog } from '../hooks/useDialogAccessibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from './DataTable';
import ActionButton from './ActionButton';
import { StatusPill } from './ManagementUI';
import { api } from '../lib/api';
import ChildProfileEvidence from './ChildProfileEvidence';

const fields=row=>({name:row.name,dateOfBirth:row.dateOfBirth?.slice(0,10)||null,groupName:row.groupName??null});
const messageFor=e=>({DUPLICATE_REVIEW:'A matching child needs review. Search existing records; no child was merged or linked automatically.',CHILD_CHANGED:'Another update changed this child. Close and reopen the details before saving.',NOT_FOUND:'The selected child or guardian is unavailable in your center. Refresh and review your selection.',VALIDATION_ERROR:'Check the name (2â€“150 characters), birth date (not in the future), group (up to 80 characters) and selected Parent.'})[e.code]||requestMessage(e);
function ChildEditDialog({row,onClose,onSaved,onBusy}){
 const ref=useRef(null),pending=useRef(false);
 const [form,setForm]=useState({name:row.name,dateOfBirth:row.dateOfBirth?.slice(0,10)||'',groupName:row.groupName||''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 function close(){if(!pending.current&&canDismissDialog(ref.current))onClose();}
 useDialogAccessibility(ref,close,{busy});
 async function save(event){
  event.preventDefault();if(pending.current)return;
  const body={name:form.name.trim(),dateOfBirth:form.dateOfBirth||null,groupName:form.groupName.trim()||null};
  if(body.name.length<2||body.name.length>150||body.groupName?.length>80||(body.dateOfBirth&&body.dateOfBirth>new Date().toISOString().slice(0,10))){setError(messageFor({code:'VALIDATION_ERROR'}));return;}
  pending.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const saved=await api(`/api/v1/admin/children/${row.id}`,{method:'PATCH',body:JSON.stringify({...body,expected:fields(row)})});
   if(saved?.id!==row.id||typeof saved.name!=='string'||!Object.hasOwn(saved,'dateOfBirth')||!Object.hasOwn(saved,'groupName'))throw Error('Unable to read the saved child details. Refresh and review before editing again.');
   if(ref.current?.isConnected)onSaved(saved);
  }catch(error){if(ref.current?.isConnected)setError(messageFor(error));}
  finally{pending.current=false;onBusy(false);if(ref.current?.isConnected)setBusy(false);}
 }
 return <div className="registration-modal-overlay"><section ref={ref} role="dialog" aria-modal="true" aria-label="Edit child information" data-dialog-size="medium" className="registration-modal cm-modal"><div className="registration-modal__header"><h2>Edit child information</h2><ModalCloseButton disabled={busy} onClick={close}/></div>
 {error&&<p role="alert" className="registration-error">{error}</p>}
 <form onSubmit={save} className="cg-form-grid"><label>Child name<input required minLength={2} maxLength={150} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Birth date<input type="date" max={new Date().toISOString().slice(0,10)} disabled={busy} value={form.dateOfBirth} onChange={e=>setForm({...form,dateOfBirth:e.target.value})}/></label><label>Child group<input maxLength={80} disabled={busy} value={form.groupName} onChange={e=>setForm({...form,groupName:e.target.value})}/></label>
 <p>Birth date and group are optional. Saving does not change guardians, attendance or wearable assignments.</p><div className="registration-modal__actions"><ActionButton type="submit" disabled={busy}>{busy?'Saving...':'Save child information'}</ActionButton><ActionButton variant="secondary" disabled={busy} onClick={close}>Cancel</ActionButton></div></form>
 </section></div>;
}
export default function ChildManagementPanel({onChanged,refreshKey=0}) {
 const [rows,setRows]=useState([]),[search,setSearch]=useState(''),[group,setGroup]=useState(''),[guardian,setGuardian]=useState(''),[offset,setOffset]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [editing,setEditing]=useState(null),[relationshipStale,setRelationshipStale]=useState(false);
 const [dialog,setDialog]=useState(null),[form,setForm]=useState({}),[parents,setParents]=useState([]),[parentOffset,setParentOffset]=useState(0),[parentLoading,setParentLoading]=useState(false),[parentId,setParentId]=useState('');
 const sequence=useRef(0),detailsSequence=useRef(0),mutation=useRef(false),dialogRef=useRef(null);
 const invalidate=useCallback(()=>{sequence.current++;},[]);
 const rfidChanged=useCallback((childId,rfidStatus)=>{
  // Patch the saved child locally; no list reload, dialog reset or scroll change.
  setRows(previous=>previous.map(row=>row.id===childId&&row.rfidStatus!==rfidStatus?{...row,rfidStatus}:row));
  setDialog(previous=>previous?.row?.id===childId&&previous.row.rfidStatus!==rfidStatus?{...previous,row:{...previous.row,rfidStatus}}:previous);
 },[]);
 const load=useCallback(async()=>{
  const own=++sequence.current;setLoading(true);
  const q=new URLSearchParams({limit:'25',offset:String(offset),...(search.trim()?{search:search.trim()}:{}),...(group.trim()?{group:group.trim()}:{}),...(guardian?{guardian}:{})});
  try{const data=await api(`/api/v1/admin/children?${q}`);if(own===sequence.current)setRows(data);}
  catch(e){if(own===sequence.current){setRows([]);setError(messageFor(e));}}
  finally{if(own===sequence.current)setLoading(false);}
 },[search,group,guardian,offset]);
 useEffect(()=>{const timer=setTimeout(load,200);return()=>{clearTimeout(timer);invalidate();};},[load,invalidate,refreshKey]);
 useEffect(()=>()=>{detailsSequence.current++;},[]);
 const selecting=dialog?.mode==='detail';
 useEffect(()=>{
  if(!selecting)return;
  let cancelled=false;
  const timer=setTimeout(async()=>{
   setParentLoading(true);
   try{const q=new URLSearchParams({role:'PARENT',status:'ACTIVE',limit:'25',offset:String(parentOffset)});const data=await api(`/api/v1/admin/users?${q}`);if(!cancelled)setParents(data);}
   catch(e){if(!cancelled){setParents([]);setError(messageFor(e));}}
   finally{if(!cancelled)setParentLoading(false);}
  },200);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[selecting,parentOffset]);
 const open=Boolean(dialog);
 useDialogAccessibility(dialogRef,()=>close(),{open:open,busy:busy});
 async function details(row) {
  if(mutation.current)return;
  const own=++detailsSequence.current;setRelationshipStale(false);setError('');setMessage('');setParentOffset(0);setParents([]);setParentLoading(true);setParentId('');setDialog({mode:'loading'});
  try{const data=await api(`/api/v1/admin/children/${row.id}`);if(own===detailsSequence.current)setDialog({mode:'detail',row:data});}
  catch(e){if(own===detailsSequence.current){setDialog(null);setError(messageFor(e));}}
 }
 function close(){if(!mutation.current&&canDismissDialog(dialogRef.current)){detailsSequence.current++;setDialog(null);setError('');}}
 async function mutate(work,success,keepChild) {
  if(mutation.current)return;
  mutation.current=true;setBusy(true);setError('');setMessage('');
  try{
   await work();
   // If this read fails, do not offer a stale relationship action for retry.
   setParentId('');
   if(keepChild){setRelationshipStale(true);const row=await api(`/api/v1/admin/children/${keepChild}`);setDialog(previous=>({...previous,row}));setRelationshipStale(false);}
   else setDialog(null);
   setMessage(success);await load();await onChanged?.();
  }catch(e){setError(messageFor(e));}
  finally{mutation.current=false;setBusy(false);}
 }
 function create(){detailsSequence.current++;setError('');setMessage('');setForm({name:'',dateOfBirth:'',groupName:''});setDialog({mode:'create'});}
 function edit(){setEditing(dialog.row);setError('');}
 function edited(saved){
  setDialog(previous=>previous?.row?.id===saved.id?{...previous,row:{...previous.row,name:saved.name,dateOfBirth:saved.dateOfBirth,groupName:saved.groupName}}:previous);
  setEditing(null);setMessage('Child information updated.');void load();void onChanged?.();
 }
 async function refreshRelationships(){
  if(mutation.current)return;mutation.current=true;setBusy(true);setError('');
  try{const row=await api(`/api/v1/admin/children/${dialog.row.id}`);setDialog(previous=>({...previous,row}));setRelationshipStale(false);}
  catch(error){setError(messageFor(error));}finally{mutation.current=false;setBusy(false);}
 }

 function save(e){
  e.preventDefault();
  const body={name:form.name.trim(),dateOfBirth:form.dateOfBirth||null,groupName:form.groupName.trim()||null};
  if(body.name.length<2||body.name.length>150||body.groupName?.length>80||(body.dateOfBirth&&body.dateOfBirth>new Date().toISOString().slice(0,10))){setError(messageFor({code:'VALIDATION_ERROR'}));return;}
  if(dialog.mode==='create'){
   if(!window.confirm('Enroll this child in your center? Review existing records first. No guardian or wearable will be assigned automatically.'))return;
   return mutate(()=>api('/api/v1/admin/children',{method:'POST',body:JSON.stringify(body)}),'Child enrolled. Review and explicitly link a verified Parent from the child details.');
  }

 }
 function link(){
  if(mutation.current||relationshipStale)return;
  if(!parentId){setError('Select a verified active Parent account first.');return;}
  const parent=parents.find(p=>p.id===parentId);
  if(!parent||!window.confirm(`Link ${parent.username} to ${dialog.row.name}? Confirm that you have independently verified this guardianship.`))return;
  const childId=dialog.row.id;
  return mutate(()=>api(`/api/v1/admin/users/${parentId}/guardians`,{method:'POST',body:JSON.stringify({childIds:[childId]})}),'Guardian relationship saved.',childId);
 }
 function unlink(user){
  if(mutation.current||relationshipStale)return;
  if(!window.confirm(`Remove ${user.username} as guardian of ${dialog.row.name}? This removes the guardian link and any access that depends on it. The child, attendance and device history will be retained.`))return;
  const childId=dialog.row.id;
  return mutate(()=>api(`/api/v1/admin/users/${user.id}/guardians`,{method:'DELETE',body:JSON.stringify({childId,removalAcknowledged:true})}),'Guardian relationship removed.',childId);
 }
 function parentPage(value){setParentId('');setParentOffset(value);setParents([]);setParentLoading(true);}
 return <section className="cg-children-panel" aria-label="Child enrollment and guardians">
 <div className="cg-panel-heading"><div><h2>Child directory</h2></div><ActionButton variant="add" disabled={busy} onClick={create}>Add child</ActionButton></div>
 <p><Link to="/registration-approval">Review new child and Parent access requests</Link>. Adding a child does not give a Parent access automatically.</p>
 {!dialog&&error&&<p className="registration-error" role="alert">{error}</p>}{message&&<p className="registration-success" role="status">{message}</p>}
 <div className="cm-toolbar"><label>Search children<input maxLength={100} value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label><label>Filter by Group<input maxLength={80} value={group} disabled={busy} onChange={e=>{setGroup(e.target.value);setOffset(0);}}/></label><label>Guardian links<select value={guardian} disabled={busy} onChange={e=>{setGuardian(e.target.value);setOffset(0);}}><option value="">All children</option><option value="LINKED">With linked guardians</option><option value="UNLINKED">Without linked guardians</option></select></label><ActionButton disabled={busy||loading} onClick={()=>{setError('');load();}}>Refresh</ActionButton></div>
 <DataTable caption="Enrolled children" data={rows} loading={loading} emptyMessage={search||group||guardian?'No children match these filters.':'No enrolled children in your center.'} columns={[
  {key:'name',label:'Child',render:r=><span className="cm-child-cell"><span className="cm-child-avatar cm-avatar-fallback" aria-hidden="true">{r.name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</span><span className="cg-cell-title" title={`Child reference: ${r.id}`}>{r.name}</span></span>},{key:'groupName',label:'Group',render:r=>r.groupName||'Not recorded'},
  {key:'guardians',label:'Guardians',render:r=><StatusPill tone={r.guardians.length?'success':'warning'}>{r.guardians.length?`${r.guardians.length} linked`:'No linked guardian'}</StatusPill>},
  {key:'rfid',label:'RFID Card',render:r=><StatusPill tone={r.rfidStatus==='ASSIGNED'?'success':'warning'}>{r.rfidStatus==='ASSIGNED'?'Assigned':r.rfidStatus==='SETUP_PENDING'?'Card setup pending':'Card not assigned'}</StatusPill>},
  {key:'assignments',label:'Assigned wearable',render:r=><StatusPill tone={r.assignments.length?'info':'muted'}>{r.assignments.map(a=>a.device.hardwareId).join(', ')||'Unassigned'}</StatusPill>},
  {key:'actions',label:'Actions',render:r=><ActionButton variant="secondary" size="small" aria-label={`View / edit ${r.name}`} disabled={busy} onClick={()=>details(r)}>View / edit</ActionButton>},
 ]}/>
 <div className="cg-pagination"><ActionButton disabled={busy||loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous children</ActionButton><span> Page {offset/25+1} </span><ActionButton disabled={busy||loading||rows.length<25} onClick={()=>setOffset(n=>n+25)}>Next children</ActionButton></div>
 {dialog&&<div className="registration-modal-overlay"><section ref={dialogRef} tabIndex={-1} role="dialog" data-dialog-size="wide" aria-modal="true" aria-label="Child details" className={`registration-modal cm-modal cg-child-dialog ${dialog.mode==='detail'?'cm-profile-dialog':''}`}><div className="registration-modal__header"><h2>{dialog.mode==='create'?'Add child':'Child details'}</h2><ModalCloseButton disabled={busy} onClick={close}/></div>
 {error&&<p role="alert" className="registration-error">{error}</p>}
 {dialog.mode==='loading'?<p role="status">Loading childâ€¦</p>:dialog.mode==='create'?<form onSubmit={save} className="cg-form-grid">
 <label>Child name<input required minLength={2} maxLength={150} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Birth date<input type="date" max={new Date().toISOString().slice(0,10)} disabled={busy} value={form.dateOfBirth} onChange={e=>setForm({...form,dateOfBirth:e.target.value})}/></label><label>Child group<input maxLength={80} disabled={busy} value={form.groupName} onChange={e=>setForm({...form,groupName:e.target.value})}/></label>
 <p>Birth date and group are optional. Saving does not change guardians, attendance or wearable assignments.</p><div className="registration-modal__actions"><ActionButton type="submit" disabled={busy}>{busy?'Savingâ€¦':dialog.mode==='create'?'Add child':'Save child information'}</ActionButton><ActionButton variant="secondary" disabled={busy} onClick={close}>Cancel</ActionButton></div>
 </form>:<>
 <ChildProfileEvidence key={dialog.row.id} child={dialog.row}/><RfidCards child={dialog.row} onAssignmentChange={rfidChanged}/><section className="cm-panel cm-management-details"><h3>Child information</h3><dl><dt>Name</dt><dd>{dialog.row.name}</dd><dt>Child reference</dt><dd>{dialog.row.id}</dd><dt>Birth date</dt><dd>{dialog.row.dateOfBirth?.slice(0,10)||'Not recorded'}</dd><dt>Group</dt><dd>{dialog.row.groupName||'Not recorded'}</dd></dl><ActionButton disabled={busy} onClick={edit}>Edit child information</ActionButton>
 <h3>Assigned wearable</h3>{dialog.row.assignments.length?dialog.row.assignments.map(a=><p key={a.id}>{a.device.hardwareId} â€” {a.device.active?'Active':'Inactive'}</p>):<p>No current wearable assignment.</p>}
 <p><Link to="/attendance">Review attendance monitoring</Link> for recorded presence and confirmation history.</p>
 <h3>Registration history</h3>{dialog.row.enrollmentRequests?.length?<ul>{dialog.row.enrollmentRequests.map(r=><li key={r.id}>{r.status}{r.reviewedAt?` / ${new Date(r.reviewedAt).toLocaleDateString()}`:''}</li>)}</ul>:<p>No app registration request is linked. Children added by Admin do not need an app request.</p>}
 <h3>Parents with access</h3>{relationshipStale&&<p role="alert">Parent access changed. Refresh these details before another access change. <ActionButton disabled={busy} onClick={refreshRelationships}>Refresh child details</ActionButton></p>}{dialog.row.guardians.length?<ul>{dialog.row.guardians.map(({user})=><li key={user.id}>{user.profile?.fullName||user.username} ({user.username}) â€” {user.role}, {user.active?'Active':'Inactive'} <ActionButton disabled={busy||relationshipStale} onClick={()=>unlink(user)}>Remove {user.username}</ActionButton></li>)}</ul>:<p>No linked guardians. Add a Parent only after checking their authority.</p>}
 <h3>Give a Verified Parent Access</h3><p>Check that the Parent is authorized to care for this child before selecting them. A matching name or phone number is not enough.</p>
 {parentLoading?<p role="status">Loading Parentsâ€¦</p>:<><label>Verified Parent<select value={parentId} disabled={busy} onChange={e=>setParentId(e.target.value)}><option value="">Select Parent</option>{parents.filter(p=>!dialog.row.guardians.some(g=>g.user.id===p.id)).map(p=><option key={p.id} value={p.id}>{p.username}{p.profile?.fullName?` / ${p.profile.fullName}`:''}</option>)}</select></label>{!parents.length&&<p>No active Parent accounts on this page.</p>}</>}
 <ActionButton disabled={busy||parentLoading||parentOffset===0} onClick={()=>parentPage(Math.max(0,parentOffset-25))}>Previous Parents</ActionButton><ActionButton disabled={busy||parentLoading||parents.length<25} onClick={()=>parentPage(parentOffset+25)}>Next Parents</ActionButton><ActionButton disabled={busy||parentLoading||!parentId||relationshipStale} onClick={link}>Link selected Parent</ActionButton>
 </section></>}
 </section></div>}
 {editing&&<ChildEditDialog key={editing.id} row={editing} onClose={()=>setEditing(null)} onSaved={edited} onBusy={setBusy}/>}
 </section>;
}
