import {useEffect,useRef,useState} from 'react';
import {api} from '../lib/api';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import ActionButton from './ActionButton';
import DataTable from './DataTable';
import ModalCloseButton from './ModalCloseButton';
import TechnicalDetails from './TechnicalDetails';
import {StatusPill} from './ManagementUI';
import '../style/WearableAssignments.css';

const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const childName=assignment=>assignment?.child?.name||'Child not available';
const eligible=child=>child.guardians?.some(link=>link.user?.role==='PARENT'&&link.user.active===true);
const current=child=>child.assignments??[];
function state(device){
 if(device.active===false)return 'Inactive';
 if(device.active!==true||!Object.hasOwn(device,'currentAssignment'))return 'Unavailable';
 return device.currentAssignment?'Assigned':'Available';
}
const feedback=error=>['ASSIGNMENT_CONFLICT','DEVICE_CHANGED'].includes(error.code)?'This assignment has changed. Refresh and try again.':error.code==='NOT_FOUND'?'The wearable or child is no longer eligible. Refresh and review your selection.':error.status===403?'You do not have permission to manage this assignment.':error.message==='CANCELLED'?'': 'Unable to update the wearable assignment. Please try again.';
async function allPages(path,limit,signal){
 const rows=new Map();
 for(let offset=0;offset<=100000;offset+=limit){
  const data=await api(`${path}${path.includes('?')?'&':'?'}limit=${limit}&offset=${offset}`,{signal});
  if(!Array.isArray(data)||data.some(row=>!row?.id))throw Error('Invalid inventory response');
  const before=rows.size;
  for(const row of data)rows.set(row.id,row);
  if(data.length>limit||(data.length===limit&&rows.size===before))throw Error('Incomplete inventory pagination');
  if(data.length<limit)return [...rows.values()];
 }
 throw Error('Inventory is too large for this view');
}
function planFor(devices,children,selection){
 const device=devices.find(row=>row.id===selection.deviceId),child=children.find(row=>row.id===selection.childId);
 if(!device||!child)throw Error('Choose a wearable and child.');
 if(!eligible(child))throw Error('Choose a child with an active, verified Parent.');
 const assigned=current(child);
 if(selection.operation==='move'){
  if(state(device)!=='Assigned')throw Error('Choose an active wearable that is currently assigned.');
  if(assigned.length||device.currentAssignment.childId===child.id)throw Error('Choose another child without a wearable. Use Replace Wearable for an existing assignment.');
  return {device,child,previous:device.currentAssignment,operation:'move'};
 }
 if(state(device)!=='Available')throw Error('Choose an active, available wearable.');
 if(selection.operation==='replace'){
  if(assigned.length!==1||assigned[0].device?.id===device.id)throw Error('Choose a child with one existing wearable and a different available replacement.');
  return {device,child,previous:assigned[0],operation:'replace'};
 }
 if(assigned.length)throw Error('This child already has a wearable. Choose Replace Wearable.');
 return {device,child,previous:null,operation:'assign'};
}
function Confirmation({review,busy,blocked,error,onClose,onConfirm}){
 const ref=useRef(null);useDialogAccessibility(ref,onClose,{busy});
 const {device,child,previous,operation}=review;
 const title=operation==='assign'?'Assign Wearable':operation==='move'?'Confirm Move':'Confirm Replacement';
 return <div className="registration-modal-overlay"><section ref={ref} role="dialog" aria-modal="true" aria-label={title} data-dialog-size="small" className="registration-modal wa-confirm"><div className="registration-modal__header"><h2>{title}</h2><ModalCloseButton disabled={busy} onClick={onClose}/></div>
 <dl><dt>Wearable</dt><dd>{device.hardwareId}</dd>{operation==='move'&&<><dt>Current child</dt><dd>{childName(previous)}</dd></>}<dt>{operation==='move'?'New child':'Child'}</dt><dd>{child.name}</dd>{operation==='replace'&&<><dt>Current wearable</dt><dd>{previous.device?.hardwareId||'Wearable not available'}</dd></>}</dl>
 <p>{operation==='assign'?`${device.hardwareId} will be assigned to ${child.name}.`:operation==='move'?`${device.hardwareId} will be removed from ${childName(previous)} and assigned to ${child.name}.`:`${child.name}'s wearable will change from ${previous.device?.hardwareId||'the current wearable'} to ${device.hardwareId}.`}</p>
 {previous&&<p>The previous assignment will end. History will be kept.</p>}
 {error&&<p role="alert" className="registration-error">{error}</p>}
 <div className="wa-actions"><ActionButton disabled={busy||blocked} onClick={onConfirm}>{busy?'Saving...':title}</ActionButton><ActionButton variant="secondary" disabled={busy} onClick={onClose}>Cancel</ActionButton></div>
 </section></div>;
}
function AssignmentHistory({device,onClose}){
 const ref=useRef(null);useDialogAccessibility(ref,onClose);
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const controller=new AbortController();api(`/api/v1/devices/${encodeURIComponent(device.id)}?management=true`,{signal:controller.signal}).then(row=>{if(active)setData(row);}).catch(()=>{if(active)setError('Unable to load assignment history. Close and try again.');});return()=>{active=false;controller.abort();};},[device.id]);
 return <div className="registration-modal-overlay"><section ref={ref} role="dialog" aria-modal="true" aria-label={`Assignment history for ${device.hardwareId}`} data-dialog-size="large" className="registration-modal"><div className="registration-modal__header"><h2>{device.hardwareId} — Assignment History</h2><ModalCloseButton onClick={onClose}/></div>
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading assignment history...</p>:<><DataTable caption="Wearable assignment history" minWidth={560} data={data.assignmentHistory??[]} emptyMessage="This wearable has not been assigned yet." columns={[{key:'child',label:'Child',render:childName},{key:'startedAt',label:'Assigned',render:row=>date(row.startedAt)},{key:'endedAt',label:'Ended',render:row=>row.endedAt?date(row.endedAt):'Current'},{key:'reference',label:'Details',render:row=><TechnicalDetails><p>Assignment reference: {row.id}</p><p>Child reference: {row.childId}</p></TechnicalDetails>}]}/><p className="cg-field-help">Latest 50 assignments. Current means assigned, not necessarily online.</p><TechnicalDetails><p>Wearable reference: {device.id}</p></TechnicalDetails></>}
 </section></div>;
}
const empty={operation:'assign',deviceId:'',childId:''};
export default function WearableAssignments({onChanged}){
 const [open,setOpen]=useState(false),[devices,setDevices]=useState(null),[children,setChildren]=useState(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[showForm,setShowForm]=useState(false),[selection,setSelection]=useState(empty),[review,setReview]=useState(null),[history,setHistory]=useState(null),[error,setError]=useState(''),[fieldError,setFieldError]=useState(''),[message,setMessage]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false),[page,setPage]=useState(0);
 const pending=useRef(false),generation=useRef(0),controller=useRef(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function load(withChildren=showForm){
  const own=++generation.current;controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal;setLoading(true);setError('');
  try{
   const [inventory,roster]=await Promise.all([allPages('/api/v1/devices?management=true',25,signal),withChildren?allPages('/api/v1/admin/children',100,signal):Promise.resolve(null)]);
   if(mounted.current&&own===generation.current){setDevices(inventory);setPage(value=>Math.min(value,Math.max(0,Math.ceil(inventory.length/25)-1)));if(roster)setChildren(roster);setNeedsRefresh(false);}
  }catch{if(mounted.current&&own===generation.current){setDevices(null);setChildren(null);setNeedsRefresh(true);setError('Unable to load wearable assignments. Please try again.');}}
  finally{if(mounted.current&&own===generation.current)setLoading(false);}
 }
 function toggle(event){const expanded=event.currentTarget.open;setOpen(expanded);if(expanded&&devices===null&&!loading)void load(false);}
 function manage(){setShowForm(true);setSelection(empty);setFieldError('');setChildren(null);void load(true);}
 async function preview(event){
  event.preventDefault();if(pending.current||loading||needsRefresh)return;
  let chosen;try{chosen=planFor(devices??[],children??[],selection);}catch(error){setFieldError(error.message);return;}
  pending.current=true;setBusy(true);setFieldError('');setError('');
  try{
   const [device,child]=await Promise.all([api(`/api/v1/devices/${encodeURIComponent(chosen.device.id)}?management=true`),api(`/api/v1/admin/children/${encodeURIComponent(chosen.child.id)}`)]);
   const checked=planFor([device],[child],selection);
   if(checked.previous?.id!==chosen.previous?.id)throw Object.assign(Error(),{code:'ASSIGNMENT_CONFLICT'});
   if(mounted.current)setReview(checked);
  }catch(error){if(mounted.current){setFieldError(error.code?feedback(error):'This assignment has changed. Refresh and try again.');setNeedsRefresh(true);}}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 async function save(){
  if(pending.current||!review||needsRefresh)return;pending.current=true;setBusy(true);setError('');
  const {device,child,previous}=review;
  try{
   const result=await api(`/api/v1/admin/devices/${encodeURIComponent(device.id)}/${previous?'transfer':'assignment'}`,{method:'POST',body:JSON.stringify(previous?{expectedAssignmentId:previous.id,childId:child.id,transferAcknowledged:true}:{childId:child.id,assignmentAcknowledged:true})});
   if(!result?.id||result.childId!==child.id)throw Error('Invalid saved assignment');
   if(!mounted.current)return;
   setReview(null);setShowForm(false);setSelection(empty);setMessage(`${device.hardwareId} is now assigned to ${child.name}.`);await load(false);await onChanged?.();
  }catch(error){if(mounted.current){setError(feedback(error));setNeedsRefresh(true);}}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 const available=(devices??[]).filter(device=>state(device)==='Available'),assigned=(devices??[]).filter(device=>state(device)==='Assigned'),childOptions=(children??[]).filter(child=>eligible(child)&&(selection.operation==='replace'?current(child).length===1:current(child).length===0));
 const options=selection.operation==='move'?assigned:available,selectedDevice=devices?.find(device=>device.id===selection.deviceId),selectedChild=children?.find(child=>child.id===selection.childId);
 return <details className="cg-panel wa-panel" onToggle={toggle}><summary>Wearable Assignments</summary>{open&&<>
 <div className="wa-heading"><p>View which wearable belongs to each child and manage assignments.</p><div className="wa-actions"><ActionButton disabled={loading||busy} onClick={manage}>Manage Assignments</ActionButton><ActionButton variant="secondary" disabled={loading||busy} onClick={()=>load()}>Refresh assignments</ActionButton></div></div>
 {message&&<p role="status" className="registration-success">{message}</p>}{error&&!review&&<p role="alert" className="registration-error">{error}</p>}
 <DataTable caption="Wearable assignments" minWidth={680} loading={loading} data={(devices??[]).slice(page*25,page*25+25)} emptyMessage={devices===null?'Assignment information is unavailable.':'No wearables have been registered yet.'} columns={[{key:'hardwareId',label:'Wearable'},{key:'child',label:'Assigned Child',render:device=>device.currentAssignment?childName(device.currentAssignment):state(device)==='Unavailable'?'Assignment not available':'Not assigned'},{key:'date',label:'Assigned Date',render:device=>device.currentAssignment?date(device.currentAssignment.startedAt):'—'},{key:'status',label:'Status',render:device=><StatusPill tone={state(device)==='Available'?'success':state(device)==='Assigned'?'info':'muted'}>{state(device)}</StatusPill>},{key:'actions',label:'Actions',render:device=><ActionButton variant="secondary" disabled={busy} onClick={()=>setHistory(device)}>View History</ActionButton>}]}/>
 {(devices?.length??0)>25&&<div className="wa-actions"><ActionButton disabled={!page||loading||busy} onClick={()=>setPage(value=>value-1)}>Previous wearables</ActionButton><span>Page {page+1}</span><ActionButton disabled={(page+1)*25>=devices.length||loading||busy} onClick={()=>setPage(value=>value+1)}>Next wearables</ActionButton></div>}
 {showForm&&<form className="wa-form" onSubmit={preview} aria-label="Manage wearable assignments"><label>Action<select disabled={loading||busy} value={selection.operation} onChange={event=>{setSelection({...empty,operation:event.target.value});setFieldError('');}}><option value="assign">Assign Wearable</option><option value="move">Move Wearable</option><option value="replace">Replace Wearable</option></select></label>
 <p className="cg-field-help">{selection.operation==='assign'?'Give an available registered wearable to a child without one.':selection.operation==='move'?'Move an assigned wearable to another child without one.':"Change a child's wearable to a different available wearable."}</p>
 {selection.operation==='replace'&&<label>Child<select required disabled={loading||busy} value={selection.childId} onChange={event=>setSelection({...selection,childId:event.target.value})}><option value="">Select child</option>{childOptions.map(child=><option key={child.id} value={child.id}>{child.name}</option>)}</select></label>}
 {selection.operation==='replace'&&selectedChild&&<p>Current wearable: <strong>{current(selectedChild)[0]?.device?.hardwareId||'Not available'}</strong></p>}
 <label>{selection.operation==='move'?'Wearable to move':selection.operation==='replace'?'Replacement wearable':'Available wearable'}<select required disabled={loading||busy} value={selection.deviceId} onChange={event=>setSelection({...selection,deviceId:event.target.value})}><option value="">Select wearable</option>{options.map(device=><option key={device.id} value={device.id}>{device.hardwareId}{selection.operation==='move'?` — ${childName(device.currentAssignment)}`:''}</option>)}</select></label>
 {!loading&&devices&&options.length===0&&<p>{selection.operation==='move'?'No active assigned wearables are available to move.':available.length===0&&(devices.some(device=>device.active)&&devices.filter(device=>device.active).every(device=>state(device)==='Assigned'))?'No available wearables. All eligible registered wearables are currently assigned.':'No active, available wearables. Register or activate a wearable in Wearable Devices.'}</p>}
 {selection.operation==='move'&&selectedDevice?.currentAssignment&&<p>Currently assigned to: <strong>{childName(selectedDevice.currentAssignment)}</strong></p>}
 {selection.operation!=='replace'&&<label>{selection.operation==='move'?'Move to child':'Child'}<select required disabled={loading||busy||children===null} value={selection.childId} onChange={event=>setSelection({...selection,childId:event.target.value})}><option value="">Select child</option>{childOptions.map(child=><option key={child.id} value={child.id}>{child.name}</option>)}</select></label>}
 {!loading&&children&&childOptions.length===0&&<p>{selection.operation==='replace'?'No eligible children have a wearable to replace.':'No eligible children without a wearable. Use Replace Wearable for a child who already has one.'}</p>}
 <p className="cg-important-note">Before moving or replacing a physical belt, ask the project owner to stop it and finish sending queued updates. Old measurements must not be attached to another child.</p>
 {fieldError&&<p role="alert" className="registration-error">{fieldError}</p>}
 <div className="wa-actions"><ActionButton type="submit" disabled={loading||busy||needsRefresh||!selection.deviceId||!selection.childId}>{busy?'Checking...':selection.operation==='assign'?'Review Assignment':selection.operation==='move'?'Review Move':'Review Replacement'}</ActionButton><ActionButton variant="secondary" disabled={busy} onClick={()=>{setShowForm(false);setFieldError('');}}>Cancel</ActionButton></div>
 </form>}
 {review&&<Confirmation review={review} busy={busy} blocked={needsRefresh} error={error} onClose={()=>{if(!pending.current){setReview(null);setError('');}}} onConfirm={save}/>}{history&&<AssignmentHistory device={history} onClose={()=>setHistory(null)}/>}
 </>}</details>;
}
