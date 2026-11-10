import { requestMessage } from '../lib/ui-language';
import ModalCloseButton from './ModalCloseButton';
import useDialogAccessibility, { canDismissDialog } from '../hooks/useDialogAccessibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Topbar from './Topbar';
import Footer from './Footer';
import DataTable from './DataTable';
import ActionButton from './ActionButton';
import StatCard from './StatCard';
import { Users } from 'lucide-react';
import { StatusPill } from './ManagementUI';
import '../style/Teacher.css';
import '../style/AccountRestoration.css';
import { api } from '../lib/api';
import '../style/RegistrationApproval.css';

const profileFields = ['fullName','email','phone'];
function feedback(error) {
 if(error.code==='USERNAME_EXISTS')return 'That username is unavailable. Choose another username.';
 if(error.code==='PROFILE_CONFLICT')return 'That email address is unavailable. Review the details.';
 if(error.status===404)return 'This account or child is no longer available in your center. Refresh and review the selection.';
 if(error.status===422)return 'Check the entered details. Use a valid name, email and phone, or a username and password meeting the requirements.';
 return requestMessage(error);
}
export default function AccountManagementPage({role}) {
 const title=role==='TEACHER'?'Teacher':'Parent';
 const [rows,setRows]=useState([]),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [dialog,setDialog]=useState(null),[form,setForm]=useState({}),[children,setChildren]=useState([]),[childOffset,setChildOffset]=useState(0),[childLoading,setChildLoading]=useState(false);
 const sequence=useRef(0),detailSequence=useRef(0),mutation=useRef(false),dialogRef=useRef(null);
 const invalidateList=useCallback(()=>{sequence.current++;},[]);
 const load=useCallback(async()=>{
  const own=++sequence.current;setLoading(true);setError('');
  const query=new URLSearchParams({role,limit:'25',offset:String(offset),...(search.trim()?{search:search.trim()}:{}),...(status?{status}:{})});
  try {const data=await api(`/api/v1/admin/users?${query}`);if(own===sequence.current)setRows(data);}
  catch(e){if(own===sequence.current){setRows([]);setError(feedback(e));}}
  finally{if(own===sequence.current)setLoading(false);}
 },[role,search,status,offset]);
 useEffect(()=>{const timer=setTimeout(load,200);return()=>{clearTimeout(timer);invalidateList();};},[load,invalidateList]);
 useEffect(()=>()=>{detailSequence.current++;},[]);
 const creatingParent=dialog?.mode==='create'&&role==='PARENT';
 useEffect(()=>{
  if(!creatingParent)return;
  let cancelled=false;
  api(`/api/v1/mobile/children?limit=25&offset=${childOffset}`).then(data=>{if(!cancelled)setChildren(data);}).catch(e=>{if(!cancelled)setError(feedback(e));}).finally(()=>{if(!cancelled)setChildLoading(false);});
  return()=>{cancelled=true;};
 },[creatingParent,childOffset]);
 const dialogOpen=Boolean(dialog);
 useDialogAccessibility(dialogRef,()=>close(),{open:dialogOpen,busy:busy});
 async function details(row) {
  if(mutation.current)return;
  const own=++detailSequence.current;setError('');setMessage('');setDialog({mode:'loading'});
  try {const data=await api(`/api/v1/admin/users/${row.id}`);if(own===detailSequence.current){setDialog({mode:'view',row:data});setForm(Object.fromEntries(profileFields.map(k=>[k,data.profile?.[k]||''])));}}
  catch(e){if(own===detailSequence.current){setDialog(null);setError(feedback(e));}}
 }
 async function mutate(work,success) {
  if(mutation.current)return;
  mutation.current=true;setBusy(true);setError('');setMessage('');
  try {await work();setDialog(null);setForm({});setMessage(success);await load();}
  catch(e){setError(feedback(e));}
  finally{mutation.current=false;setBusy(false);}
 }
 function changeStatus(row) {
  if(mutation.current)return;
  if(!window.confirm(`${row.active?'Deactivate':'Activate'} ${row.username}? ${row.active?'They will lose access to their account.':'They will be able to sign in again.'}`))return;
  return mutate(()=>api(`/api/v1/admin/users/${row.id}/status`,{method:'PATCH',body:JSON.stringify({active:!row.active})}),'Account status updated.');
 }
 function create() {
  detailSequence.current++;
  setError('');setMessage('');setChildren([]);setChildLoading(role==='PARENT');setChildOffset(0);setForm({username:'',password:'',confirmPassword:'',childIds:[]});setDialog({mode:'create'});
 }
 function childPage(next){setChildLoading(true);setChildren([]);setChildOffset(next);}
 function save(e) {
  e.preventDefault();
  if(dialog.mode==='create'){
   if(!/^[A-Za-z0-9._@+-]{3,100}$/.test(form.username.trim())){setError('Use 3–100 letters, numbers or . _ @ + - for the username.');return;}
   if(form.password.length<12||new TextEncoder().encode(form.password).length>72){setError('Use at least 12 characters. The password is too long if it exceeds the 72-byte limit.');return;}
   if(form.password!==form.confirmPassword){setError('Passwords do not match.');return;}
   if(role==='PARENT'&&!form.childIds.length){setError('Select at least one verified existing child. A Parent needs at least one child you are authorized to link.');return;}
   if(!window.confirm(`Create this ${title.toLowerCase()} account${role==='PARENT'?` and explicitly link the ${form.childIds.length} selected child record(s)`:''}? Verify identity and authorization first.`))return;
   return mutate(()=>api('/api/v1/admin/users',{method:'POST',body:JSON.stringify({username:form.username.trim(),password:form.password,role,childIds:form.childIds})}),'Account created. Share the username and password privately with the verified account holder.');
  }
  return mutate(()=>api(`/api/v1/admin/users/${dialog.row.id}/profile`,{method:'PATCH',body:JSON.stringify(Object.fromEntries(profileFields.map(k=>[k,form[k].trim()])))}),'Account information updated.');
 }
 function close(){if(!mutation.current&&canDismissDialog(dialogRef.current)){detailSequence.current++;setDialog(null);setForm({});setError('');}}
 return <div className="teacher-page"><Topbar hideTitle/><main className="teacher-content cg-admin-content"><h1>{title}s</h1>
 <p>Manage {title.toLowerCase()} accounts and contact details. <Link to="/registration-approval">Review registration and relationship requests</Link>.</p>
 {message&&<p role="status" className="registration-success">{message}</p>}
 {!dialog&&error&&<p role="alert" className="registration-error">{error}</p>}
 <div className="teacher-summary-row"><div className="teacher-summary-card"><StatCard title={`${title} Accounts`} value={rows.length} icon={Users}/></div><div className="teacher-search-wrapper restored-filterbar"><label>Search {title.toLowerCase()}s<input maxLength={100} value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label><label>Account status<select value={status} disabled={busy} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><ActionButton disabled={busy||loading} onClick={load}>Refresh</ActionButton><ActionButton disabled={busy} onClick={create}>Add {title}</ActionButton></div></div>
 <DataTable minWidth={role==='PARENT'?960:800} caption={`${title} accounts`} data={rows} loading={loading} emptyMessage={search||status?'No accounts match these filters.':`No ${title.toLowerCase()} accounts in your center yet.`} columns={[
  {key:'username',label:'Account',width:role==='PARENT'?'26%':'32%',render:r=><span className="cm-child-cell"><span className="teacher-avatar teacher-avatar--fallback" aria-hidden="true">{(r.profile?.fullName||r.username).slice(0,2).toUpperCase()}</span><span><strong className="teacher-name">{r.profile?.fullName||r.username}</strong><small className="cg-cell-note">{r.username}</small></span></span>},{key:'contact',label:'Contact',render:r=><span className="teacher-contact">{r.profile?.phone||r.profile?.email||'Contact details not added'}</span>},
  ...(role==='PARENT'?[{key:'children',label:'Children',width:'24%',render:r=>r.guardians?.length?<span className="parent-linked-children">{r.guardians.map(({child})=><span key={child.id}>{child.name}</span>)}</span>:'No child linked'}]:[]),
  {key:'active',label:'Status',width:110,render:r=><StatusPill tone={r.active?'success':'muted'}>{r.active?'Active':'Inactive'}</StatusPill>},
  {key:'actions',label:'Actions',render:r=><div className="cg-table-actions"><ActionButton variant="edit" aria-label={`View / edit ${r.username}`} disabled={busy} onClick={()=>details(r)}>View / edit</ActionButton><ActionButton variant={r.active?'delete':'secondary'} aria-label={`${r.active?'Deactivate':'Activate'} ${r.username}`} disabled={busy} onClick={()=>changeStatus(r)}>{r.active?'Deactivate':'Activate'}</ActionButton></div>},
 ]}/>
 <div className="cg-pagination"><ActionButton disabled={busy||loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous</ActionButton><span> Page {offset/25+1} </span><ActionButton disabled={busy||loading||rows.length<25} onClick={()=>setOffset(n=>n+25)}>Next</ActionButton></div>
 {dialog&&<div className="registration-modal-overlay"><section ref={dialogRef} tabIndex={-1} role="dialog" data-dialog-size="medium" aria-modal="true" aria-label={`${title} account`} className="registration-modal teacher-modal"><div className="registration-modal__header"><h2>{dialog.mode==='create'?`Add ${title}`:`${title} account`}</h2><ModalCloseButton disabled={busy} onClick={close}/></div>
 {error&&<p role="alert" className="registration-error">{error}</p>}
 {dialog.mode==='loading'?<p role="status">Loading account…</p>:<form onSubmit={save} className="cg-form-grid">
 {dialog.row&&<><div className="teacher-profile-card"><span className="teacher-avatar teacher-avatar--fallback" aria-hidden="true">{(dialog.row.profile?.fullName||dialog.row.username).slice(0,2).toUpperCase()}</span><div><strong>{dialog.row.profile?.fullName||dialog.row.username}</strong><p>{dialog.row.role} ? {dialog.row.active?'Active':'Inactive'}</p></div></div><dl><dt>Username</dt><dd>{dialog.row.username}</dd><dt>Role</dt><dd>{dialog.row.role}</dd><dt>Status</dt><dd>{dialog.row.active?'Active':'Inactive'}</dd></dl>
 {role==='PARENT'&&<><h3>Existing approved children</h3>{dialog.row.guardians?.length?<ul>{dialog.row.guardians.map(g=><li key={g.child.id}>{g.child.name} ({g.child.id})</li>)}</ul>:<p>No approved child relationships recorded.</p>}<p>To change child access, review the child?s details or the related approval request.</p></>}
 </>}
 {dialog.mode==='create'?<>
 <p>This creates an account immediately. Check the person's identity and permission first. Share the sign-in details privately.</p>
 <label>Username<input required minLength={3} maxLength={100} autoComplete="off" disabled={busy} value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label>
 <label>Initial password<input type="password" required minLength={12} maxLength={72} autoComplete="new-password" disabled={busy} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
 <label>Confirm password<input type="password" required autoComplete="new-password" disabled={busy} value={form.confirmPassword} onChange={e=>setForm({...form,confirmPassword:e.target.value})}/></label>
 <p>Use at least 12 characters. Some symbols take more space; the system allows up to 72 bytes.</p>
 {role==='PARENT'&&<fieldset disabled={busy||childLoading}><legend>Choose children you are authorized to link</legend><p>Select only children this Parent is authorized to care for.</p>{childLoading?<p role="status">Loading children…</p>:children.length?children.map(c=><label key={c.id}><input type="checkbox" checked={form.childIds.includes(c.id)} onChange={e=>setForm({...form,childIds:e.target.checked?[...form.childIds,c.id]:form.childIds.filter(id=>id!==c.id)})}/>{c.name} ({c.id})</label>):<p>No children on this page. Use Request Approval for a new child enrollment.</p>}<p>{form.childIds.length} selected across pages</p><ActionButton disabled={busy||childLoading||childOffset===0} onClick={()=>childPage(Math.max(0,childOffset-25))}>Previous children</ActionButton><ActionButton disabled={busy||childLoading||children.length<25} onClick={()=>childPage(childOffset+25)}>Next children</ActionButton></fieldset>}
 </>:profileFields.map(key=><label key={key}>{({fullName:'Full name',email:'Email',phone:'Phone'})[key]}<input required type={key==='email'?'email':'text'} minLength={key==='fullName'?2:key==='phone'?7:undefined} maxLength={key==='fullName'?150:key==='email'?254:30} disabled={busy} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
 <div className="registration-modal__actions"><ActionButton type="submit" disabled={busy||dialog.mode==='loading'}>{busy?'Saving…':dialog.mode==='create'?'Create account':'Save information'}</ActionButton><ActionButton disabled={busy} onClick={close}>Cancel</ActionButton></div>
 </form>}
 </section></div>}
 </main><Footer/></div>;
}
