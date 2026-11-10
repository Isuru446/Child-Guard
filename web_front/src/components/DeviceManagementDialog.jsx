import { requestMessage } from '../lib/ui-language';
import TechnicalDetails from './TechnicalDetails';
import ModalCloseButton from './ModalCloseButton';
import useDialogAccessibility, { canDismissDialog } from '../hooks/useDialogAccessibility';
import { useEffect, useRef, useState } from 'react';
import ActionButton from './ActionButton';
import { api } from '../lib/api';
import DeviceIdentity from './DeviceIdentity';
const feedback=e=>({DEVICE_UNAVAILABLE:'This device ID or private key is already in use or unavailable. Check the details with the project owner; an existing belt cannot be replaced here.',ASSIGNMENT_CONFLICT:'Assignments changed or conflict. Refresh and review; unassign conflicting belts explicitly first.',ASSIGNED:'Remove this belt from its child before deactivating it.',DEVICE_CHANGED:'Device status changed. Reopen the details before editing.',NOT_FOUND:'The belt or child is unavailable, or the child lacks an active verified Parent in your center.',VALIDATION_ERROR:'Check the device ID, private access key and selected child. Confirm any assignment change.'})[e.code]||requestMessage(e);
export default function DeviceManagementDialog({selection,onClose,onSaved}) {
 const registering=selection==='register';
 const [registered,setRegistered]=useState(null);
 const [device,setDevice]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(!registering),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({hardwareId:'',deviceToken:'',confirmation:''});
 const [children,setChildren]=useState([]),[childId,setChildId]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[childLoading,setChildLoading]=useState(!registering);
 const mutation=useRef(false),ref=useRef(null),closeRef=useRef(onClose);
 useEffect(()=>{closeRef.current=onClose;},[onClose]);
 useDialogAccessibility(ref,()=>requestClose(),{open:true,busy});
 useEffect(()=>{
  if(registering)return;let active=true;
  api(`/api/v1/devices/${selection.id}?management=true`).then(row=>{if(active)setDevice(row);}).catch(e=>{if(active)setError(feedback(e));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[selection,registering]);
 useEffect(()=>{
  if(registering)return;let active=true;
  const timer=setTimeout(async()=>{
   setChildLoading(true);
   try{const q=new URLSearchParams({limit:'25',offset:String(offset),...(search.trim()?{search:search.trim()}:{})});const rows=await api(`/api/v1/admin/children?${q}`);if(active)setChildren(rows);}
   catch(e){if(active){setChildren([]);setError(feedback(e));}}
   finally{if(active)setChildLoading(false);}
  },200);return()=>{active=false;clearTimeout(timer);};
 },[registering,search,offset]);
 async function mutate(work,afterSave) {
  if(mutation.current)return;mutation.current=true;setBusy(true);setError('');
  try{const result=await work();setForm({hardwareId:'',deviceToken:'',confirmation:''});onSaved();if(afterSave)afterSave(result);else onClose();}
  catch(e){setError(feedback(e));}
  finally{mutation.current=false;setBusy(false);}
 }
 function register(e){
  e.preventDefault();if(mutation.current)return;
  if(!/^[A-Za-z0-9_-]{1,150}$/.test(form.hardwareId)){setError('Use the exact hardware ID: 1–150 letters, numbers, underscore or hyphen.');return;}
  if(!/^[\x21-\x7e]{32,256}$/.test(form.deviceToken)||form.deviceToken!==form.confirmation){setError('Enter and confirm the existing privately provisioned token (32–256 printable ASCII characters, without spaces).');return;}
  if(!window.confirm('Register this new belt in your center using its privately provisioned credential? Existing hardware cannot be overwritten. Registration does not assign a child.'))return;
  return mutate(()=>api('/api/v1/admin/devices',{method:'POST',body:JSON.stringify({hardwareId:form.hardwareId,deviceToken:form.deviceToken})}),setRegistered);
 }
 const current=device?.currentAssignment;
 function assign(){
  if(mutation.current)return;
  const child=children.find(c=>c.id===childId);if(!child)return;
  const destination=child.assignments?.[0];
  if(current&&destination&&current.id!==destination.id){setError('Both the belt and child are assigned. Review and unassign one explicitly before transfer.');return;}
  const previous=current?.id||destination?.id;
  if(!window.confirm(`${previous?'Transfer / replace':'Assign'} ${device.hardwareId} to ${child.name}? ${current?`Its assignment to ${current.child.name} will end. `:''}${destination?`The child's current wearable assignment will end. `:''}History will be retained. Verify the physical belt first.`))return;
  return mutate(()=>api(`/api/v1/admin/devices/${device.id}/${previous?'transfer':'assignment'}`,{method:'POST',body:JSON.stringify(previous?{expectedAssignmentId:previous,childId,transferAcknowledged:true}:{childId,assignmentAcknowledged:true})}));
 }
 function unassign(){
  if(mutation.current||!current)return;
  if(!window.confirm(`Remove ${device.hardwareId} from ${current.child.name}? Future belt updates will no longer be linked to this child. Historical records will be retained.`))return;
  return mutate(()=>api(`/api/v1/admin/devices/${device.id}/unassign`,{method:'POST',body:JSON.stringify({expectedAssignmentId:current.id,unassignAcknowledged:true})}));
 }
 function status(){
  if(mutation.current)return;
  if(!window.confirm(`${device.active?'Deactivate':'Activate'} ${device.hardwareId}? ${device.active?'Its updates will be rejected while inactive.':'Its existing private access key will be accepted again.'}`))return;
  return mutate(()=>api(`/api/v1/admin/devices/${device.id}/status`,{method:'PATCH',body:JSON.stringify({active:!device.active,expectedActive:device.active})}));
 }
 function requestClose(){if(!mutation.current&&canDismissDialog(ref.current))onClose();}
 function filter(value){setSearch(value);setOffset(0);setChildId('');setChildren([]);setChildLoading(true);}
 function page(value){setOffset(value);setChildId('');setChildren([]);setChildLoading(true);}
 return <div className="registration-modal-overlay"><section ref={ref} tabIndex={-1} className="registration-modal" role="dialog" data-dialog-size="large" aria-modal="true" aria-label={registering?'Register wearable belt':'Wearable belt details'}><div className="registration-modal__header"><h2>{registering?'Register wearable belt':'Wearable belt details'}</h2><ModalCloseButton disabled={busy} onClick={requestClose}/></div>
 {error&&<p className="registration-error" role="alert">{error}</p>}
 {registering&&registered?<><p role="status" className="registration-success">Wearable registered. You can now assign it to a child.</p><DeviceIdentity device={registered}/><p>Status: {registered.active?'Active':'Inactive'}. No child has been assigned yet.</p><p>The private access key has been cleared. It cannot be retrieved here. Close this dialog and select Manage to assign the belt.</p></>:registering?<form onSubmit={register}>
 <p>Register a new physical belt using the device ID and private access key supplied by the project owner. Registration does not assign a child.</p>
 <p className="cg-important-note">For a belt that already works, close this form and select Manage. Do not register it again or replace its access key.</p>
 <label>Device ID (required)<input autoComplete="off" placeholder="For example, CG-WEARABLE-001" required maxLength={150} disabled={busy} value={form.hardwareId} onChange={e=>setForm({...form,hardwareId:e.target.value})}/></label>
 <label>Private device access key (required)<input type="password" autoComplete="new-password" required minLength={32} maxLength={256} disabled={busy} value={form.deviceToken} onChange={e=>setForm({...form,deviceToken:e.target.value})}/></label>
 <span className="cg-field-help">Ask the project owner for the key configured on this belt. Do not use a Parent request code or a beacon code.</span>
 <label>Confirm private access key (required)<input type="password" autoComplete="new-password" required disabled={busy} value={form.confirmation} onChange={e=>setForm({...form,confirmation:e.target.value})}/></label>
 <TechnicalDetails title="Owner setup and technical requirements"><p>The authorized owner privately creates a unique random token for each new belt and configures the same token as DEVICE_TOKEN on that belt. Enter that value here. Use 32-256 printable characters without spaces. The server stores only its SHA-256 hash; this form cannot show an existing token.</p><p>Use the physical belt's DEVICE_ID. A database reference number (UUID) is generated automatically. Bluetooth beacon UUIDs, JWT secrets and Parent claim codes are different values. No key is saved in browser storage or generated here. Token rotation is not supported.</p></TechnicalDetails>
 <div className="cg-dialog-actions"><ActionButton type="submit" disabled={busy}>{busy?'Registering...':'Register wearable'}</ActionButton></div></form>:loading?<p role="status">Loading wearable...</p>:device&&<>
 <section className="cg-dialog-section"><h3>Device Information</h3><dl><dt>Device ID</dt><dd>{device.hardwareId}</dd><dt>Status</dt><dd>{device.active?'Active':'Inactive'}</dd><dt>Latest updates</dt><dd>{device.lastSeen?'Device has sent verified updates':'Waiting for its first update'}</dd><dt>Last update</dt><dd>{device.lastSeen?new Date(device.lastSeen).toLocaleString():'No updates received'}</dd><dt>Battery</dt><dd>Not reported</dd><dt>Assigned child</dt><dd>{current?current.child.name:'Not assigned'}</dd></dl><p className="cg-important-note">A recent update does not prove the belt is worn or the child is safe.</p></section>
 <section className="cg-dialog-section"><h3>Assigned Child</h3><p>{current?`Currently assigned to: ${current.child.name}`:'This wearable is not assigned to a child.'}</p>
 {current&&<div className="cg-dialog-actions"><ActionButton variant="delete" disabled={busy} onClick={unassign}>Remove assignment</ActionButton></div>}
 <details><summary>{current?'Move to Another Child':'Assign to Child'}</summary><p>The selected child must have an active, approved Parent in your center. You will review and confirm any assignment change.</p><p className="cg-important-note">Before moving a physical belt, ask the project owner to stop it and finish sending its queued updates. Otherwise, older updates may be linked to the next child.</p>
 <label>Search children<input maxLength={100} disabled={busy} value={search} onChange={e=>filter(e.target.value)}/></label>
 {childLoading?<p role="status">Loading children...</p>:<><label>Choose child<select disabled={busy||!device.active} value={childId} onChange={e=>setChildId(e.target.value)}><option value="">Select child</option>{children.map(c=><option key={c.id} value={c.id}>{c.name}{c.assignments?.length?' / already assigned':' / no wearable'}</option>)}</select></label>{!children.length&&<p>No registered children match this view.</p>}</>}
 {!device.active&&<p>Activate this wearable before assigning it.</p>}
 <div className="cg-dialog-actions"><ActionButton variant="secondary" disabled={busy||childLoading||offset===0} onClick={()=>page(Math.max(0,offset-25))}>Previous children</ActionButton><ActionButton variant="secondary" disabled={busy||childLoading||children.length<25} onClick={()=>page(offset+25)}>Next children</ActionButton><ActionButton disabled={busy||childLoading||!device.active||!childId||current?.childId===childId} onClick={assign}>Confirm assignment / transfer</ActionButton></div>
 </details></section>
 <section className="cg-dialog-section"><h3>Manage Wearable</h3><p>{device.active?'Deactivating stops this belt from sending accepted updates to ChildGuard.':'Activating allows this belt to send updates using its existing private access key.'}</p><ActionButton variant={device.active?'delete':'primary'} disabled={busy||Boolean(device.active&&current)} onClick={status}>{device.active?'Deactivate belt':'Activate belt'}</ActionButton>{device.active&&current&&<p>Remove the child assignment before deactivating this belt.</p>}</section>
 <TechnicalDetails><p>These details identify this wearable in the system. You usually do not need them for everyday tasks.</p><DeviceIdentity device={device}/><p>This device ID and private access key cannot be changed here. Active means enabled in ChildGuard; it does not mean the belt is online.</p></TechnicalDetails>
 <details className="cg-dialog-section"><summary>Assignment history (latest 50)</summary>{device.assignmentHistory?.length?<ul>{device.assignmentHistory.map(a=><li key={a.id}>{a.child.name} / {new Date(a.startedAt).toLocaleString()} - {a.endedAt?new Date(a.endedAt).toLocaleString():'Current'}</li>)}</ul>:<p>No assignment history yet.</p>}</details>
 <details className="cg-dialog-section"><summary>Help with wearable assignments</summary><ol><li>Register a belt once, using the private key supplied by the project owner.</li><li>Assign it to a child whose Parent access has been approved.</li><li>Moving or replacing a belt ends the selected old assignment. Previous records stay in history.</li><li>A Parent request code is separate from the private device key. Do not share the private key with Parents.</li></ol></details>
 </>}

 </section></div>;
}
