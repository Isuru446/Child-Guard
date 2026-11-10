import {useCallback,useRef,useState} from 'react';
import {api} from '../lib/api';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import ActionButton from './ActionButton';
const root='/api/v1/admin/rfid';
const time=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Colombo'}):'Not recorded';

export default function RfidCards({child,onAssignmentChange}){
 return <ChildRfid key={child.id} child={child} onAssignmentChange={onAssignmentChange}/>;
}
function ChildRfid({child,onAssignmentChange}){
 const [watching,setWatching]=useState(false);
 const assignment=useRef(null);
 const receive=useCallback(data=>{
  // Only an authorized server read ends the wait; never a local deadline/SSE frame.
  setWatching(data?.enrollment?.status==='PENDING');
  const status=data?.cards?.some(card=>card.status==='ACTIVE')?'ASSIGNED':'NOT_ASSIGNED';
  if(assignment.current!==status){assignment.current=status;onAssignmentChange?.(child.id,status);}
 },[child.id,onAssignmentChange]);
 const read=useMonitoringRead(`${root}/children/${encodeURIComponent(child.id)}`,{
  intervalMs:watching?1000:15000,adaptiveInterval:!watching,onData:receive,
 });
 const readers=useMonitoringRead(`${root}/readers`);
 const [reader,setReader]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=read.data?.cards?.find(c=>c.status==='ACTIVE');
 const session=read.data?.enrollment,pending=session?.status==='PENDING';
 async function act(path,body){
  if(busy)return;setBusy(true);setError('');
  try{await api(path,{method:'POST',body:JSON.stringify(body)});read.refresh();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 function enroll(){
  if(!reader)return;
  if(!window.confirm(`${active?'Replace':'Issue'} the RFID card for ${child.name}? The selected reader will enroll its next card for 60 seconds. Supervise the scan. The old card remains active until replacement succeeds.`))return;
  void act(`${root}/children/${child.id}/enrollment`,{readerId:reader,mode:active?'REPLACE':'ISSUE'});
 }
 function revoke(){
  const reason=window.prompt(`Reason for revoking ${child.name}'s card (minimum 3 characters)`);
  if(!reason||reason.trim().length<3)return;
  if(window.confirm('Revoke this card? Existing attendance history will remain.'))void act(`${root}/children/${child.id}/revoke`,{cardId:active.id,reason:reason.trim()});
 }
 return <section className="cm-panel" aria-label="Child RFID Card"><h3>RFID Card</h3>
  {read.loading?<p>Loading card assignment…</p>:read.errorCode==='RFID_UNAVAILABLE'?<p>Card setup is not available yet. The owner must deploy the reviewed RFID migration and configure the backend. Normal attendance remains available.</p>:<>
   <p><strong>{active?'Assigned':read.data?.cards?.length?'Revoked / Not assigned':'Card not assigned'}</strong></p>
   {!active&&<p>This child still needs an active card for RFID backup attendance. Normal BLE and Teacher attendance remain available.</p>}
   {active&&<p>{active.maskedUid} · Issued {time(active.issuedAt)} by {active.issuedBy?.username||'Admin'} · Reader {active.reader?.hardwareId}</p>}
   <label>Enrollment reader<select disabled={busy||pending} value={reader} onChange={e=>setReader(e.target.value)}><option value="">Select registered reader</option>{(Array.isArray(readers.data)?readers.data:[]).filter(r=>r.active).map(r=><option value={r.id} key={r.id}>{r.hardwareId}{r.online?' · Online':' · No recent communication'}</option>)}</select></label>
   {pending?<div role="status"><p>Waiting for card scan · {child.name} · Reader {(Array.isArray(readers.data)?readers.data:[]).find(r=>r.id===session.readerId)?.hardwareId||'Selected reader'} · Expires {time(session.expiresAt)}</p><p>The next card on this reader is for enrollment, not attendance.</p><ActionButton disabled={busy} onClick={()=>act(`${root}/enrollments/${session.id}/cancel`,{})}>Cancel enrollment</ActionButton></div>:<>
    {session?.status==='SUCCESS'&&<p role="status">Card successfully enrolled.</p>}
    {['EXPIRED','REJECTED','CANCELLED'].includes(session?.status)&&<p>Enrollment {session.status.toLowerCase()}. Select the reader and retry.</p>}
    <ActionButton disabled={busy||!reader||!!read.error} onClick={enroll}>{['EXPIRED','REJECTED','CANCELLED'].includes(session?.status)?'Retry enrollment':active?'Replace RFID Card':'Issue RFID Card'}</ActionButton>
    {active&&<ActionButton disabled={busy} onClick={revoke}>Revoke RFID Card</ActionButton>}
   </>}
   {read.data?.cards?.length>0&&<details><summary>Card history</summary>{read.data.cards.map(c=><p key={c.id}>{c.maskedUid} · {c.status.toLowerCase()} · Issued {time(c.issuedAt)}{c.revokedAt?` · Ended ${time(c.revokedAt)} · ${c.reason}`:''}</p>)}</details>}
  </>}
  {(error||read.error||readers.error)&&read.errorCode!=='RFID_UNAVAILABLE'&&<p role="alert">{error||read.error||readers.error} <ActionButton disabled={busy} onClick={()=>{read.refresh();readers.refresh();}}>Retry card status</ActionButton></p>}
  <p>Supervised UID-only prototype: cards can be cloned. No child information is written to the card.</p>
 </section>;
}
