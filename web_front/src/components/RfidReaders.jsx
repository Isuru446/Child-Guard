import {useEffect,useRef,useState} from 'react';
import {Radio,Clock3,KeyRound,Copy,Check,Power,Plus} from 'lucide-react';
import {api} from '../lib/api';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {StatusPill} from './ManagementUI';
import ActionButton from './ActionButton';
import MonitoringCardHeader from './MonitoringCardHeader';
import '../style/RfidReaders.css';
const root='/api/v1/admin/rfid/readers';
const minute=text=>{const [h,m]=text.split(':').map(Number);return h*60+m;};
const validTime=text=>/^([01]\d|2[0-3]):[0-5]\d$/.test(text);
export default function RfidReaders(){
 const [open,setOpen]=useState(false),[count,setCount]=useState(null);
 return <details className="rfid-readers monitoring-card" onToggle={e=>setOpen(e.currentTarget.open)}>
  <MonitoringCardHeader icon={Radio} title="RFID Attendance Readers" description="Manage standalone RFID readers used for attendance confirmation." count={count} countLabel={`${count} registered readers`}/>
  {open&&<ReaderManagement onCount={setCount}/>}
 </details>;
}
export function ReaderManagement({onCount}){
 const read=useMonitoringRead(root);
 const readers=Array.isArray(read.data)?read.data:[];
 useEffect(()=>{if(Array.isArray(read.data))onCount?.(read.data.length);},[read.data,onCount]);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const online=r=>{const server=Date.parse(r.serverTime),clock=Number.isFinite(server)&&read.updatedAt?server+Math.max(0,now-read.updatedAt):now;const age=clock-Date.parse(r.lastSeen);return r.active&&Number.isFinite(age)&&age>=0&&age<=60000;};
 const [hardwareId,setId]=useState(''),[start,setStart]=useState('06:00'),[end,setEnd]=useState('18:00'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[token,setToken]=useState(''),[fields,setFields]=useState({}),[notice,setNotice]=useState('');
 const mutation=useRef(false);
 async function register(e){
  e.preventDefault();if(mutation.current||token)return;
  const next={};
  if(!/^[A-Za-z0-9_-]{1,150}$/.test(hardwareId))next.hardwareId='Enter a reader ID using letters, numbers, underscores or hyphens.';
  if(!validTime(start))next.start='Choose the daily attendance start time.';
  if(!validTime(end))next.end='Choose the daily attendance end time.';
  else if(validTime(start)&&minute(end)<=minute(start))next.end='End time must be later than start time.';
  setFields(next);if(Object.keys(next).length)return;
  if(!window.confirm('Register this separate, supervised RFID reader? Review the daily attendance window in Sri Lanka time. This is not a child wearable.'))return;
  mutation.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await api(root,{method:'POST',body:JSON.stringify({hardwareId,startMinute:minute(start),endMinute:minute(end)})});setToken(r.provisioningToken);setId('');setNotice('Reader registered. Complete the one-time provisioning below.');read.refresh();}catch(e){setError(e.message);}finally{mutation.current=false;setBusy(false);}
 }
 async function toggle(r){
  if(mutation.current||!window.confirm(`${r.active?'Disable':'Enable'} reader ${r.hardwareId}?`))return;
  mutation.current=true;setBusy(true);setError('');setNotice('');
  try{await api(`${root}/${r.id}`,{method:'PATCH',body:JSON.stringify({active:!r.active,expectedActive:r.active})});setNotice(`Reader ${r.active?'disabled':'enabled'}.`);read.refresh();}catch(e){setError(e.message);}finally{mutation.current=false;setBusy(false);}
 }
 return <section className="rfid-readers__body" aria-label="RFID reader management" aria-busy={busy}>
  {read.errorCode==='RFID_UNAVAILABLE'?<p className="rfid-readers__feedback">RFID setup requires the staged migration, updated Prisma client and private backend lookup key. Existing wearables are unchanged.</p>:<>
   <section className="rfid-readers__registered" aria-label="Registered RFID readers"><h3>Registered readers</h3>
    {read.loading?<p role="status" className="rfid-readers__muted">Loading readers…</p>:readers.length?<div className="rfid-readers__list">{readers.map(r=>{
     const current=online(r)&&!read.stale&&!read.error;
     return <article key={r.id} className="rfid-reader-card" aria-label={`Reader ${r.hardwareId}`}>
      <div className="rfid-reader-card__details"><h4>{r.hardwareId}</h4><div className="rfid-reader-card__badges"><StatusPill tone={r.active?'success':'muted'}>{r.active?'Enabled':'Disabled'}</StatusPill><StatusPill tone={current?'success':'muted'}>{read.stale||read.error?'Communication unavailable':current?'Online':'No recent communication'}</StatusPill></div><p className="rfid-reader-card__time"><Clock3 size={15} aria-hidden="true"/><span>Last communication: {r.lastSeen?<time dateTime={r.lastSeen}>{new Date(r.lastSeen).toLocaleString()}</time>:'Not received'}</span></p></div>
      <div className="rfid-reader-card__action"><ActionButton variant="secondary" icon={Power} disabled={busy} onClick={()=>toggle(r)}>{r.active?'Disable reader':'Enable reader'}</ActionButton></div>
     </article>;
    })}</div>:<p className="rfid-readers__empty">No RFID readers registered yet. Register your standalone attendance reader below.</p>}
   </section>
   {notice&&<p role="status" className="rfid-readers__feedback rfid-readers__feedback--success"><Check size={17} aria-hidden="true"/>{notice}</p>}
   <section className="rfid-readers__registration" aria-labelledby="rfid-registration-title"><h3 id="rfid-registration-title"><Plus size={18} aria-hidden="true"/>Register New Reader</h3><p className="rfid-readers__muted">Use the public ID of the separate reader. Attendance times use Sri Lanka time.</p>
    <form className="rfid-readers__form" onSubmit={register} noValidate>
     <div className="rfid-readers__field rfid-readers__field--wide"><label htmlFor="rfid-reader-public-id">Reader public ID</label><input id="rfid-reader-public-id" required maxLength={150} value={hardwareId} onChange={e=>{setId(e.target.value);setFields(previous=>({...previous,hardwareId:''}));}} placeholder="CG-RFID-READER-02" disabled={busy||!!token} aria-invalid={!!fields.hardwareId} aria-describedby={fields.hardwareId?'rfid-reader-id-error':undefined}/>{fields.hardwareId&&<p id="rfid-reader-id-error" className="rfid-readers__field-error">{fields.hardwareId}</p>}</div>
     <div className="rfid-readers__field"><label htmlFor="rfid-reader-start">Daily attendance starts (Sri Lanka)</label><input id="rfid-reader-start" type="time" required value={start} onChange={e=>{setStart(e.target.value);setFields(previous=>({...previous,start:'',end:''}));}} disabled={busy||!!token} aria-invalid={!!fields.start} aria-describedby={fields.start?'rfid-reader-start-error':undefined}/>{fields.start&&<p id="rfid-reader-start-error" className="rfid-readers__field-error">{fields.start}</p>}</div>
     <div className="rfid-readers__field"><label htmlFor="rfid-reader-end">Daily attendance ends (Sri Lanka)</label><input id="rfid-reader-end" type="time" required value={end} onChange={e=>{setEnd(e.target.value);setFields(previous=>({...previous,end:''}));}} disabled={busy||!!token} aria-invalid={!!fields.end} aria-describedby={fields.end?'rfid-reader-end-error':undefined}/>{fields.end&&<p id="rfid-reader-end-error" className="rfid-readers__field-error">{fields.end}</p>}</div>
     <div className="rfid-readers__form-actions"><ActionButton type="submit" icon={Plus} disabled={busy||!!token||!!read.error||read.loading}>{busy?'Saving reader…':'Register reader'}</ActionButton></div>
    </form>
   </section>
   {token&&<section className="rfid-readers__provisioning" aria-labelledby="rfid-provisioning-title"><h3 id="rfid-provisioning-title"><KeyRound size={18} aria-hidden="true"/>One-time reader provisioning</h3><p>Copy this credential directly into the reader's ignored private config. It cannot be retrieved later. Do not share it or put it in screenshots.</p><div className="rfid-readers__field"><label htmlFor="rfid-reader-credential">One-time reader credential</label><input id="rfid-reader-credential" type="password" readOnly value={token}/></div><div className="rfid-readers__credential-actions"><ActionButton variant="secondary" icon={Copy} onClick={async()=>{try{await navigator.clipboard.writeText(token);setNotice('Provisioning credential copied.');}catch{setError('Clipboard unavailable. Select and copy the credential manually.');}}}>Copy provisioning credential</ActionButton><ActionButton icon={Check} onClick={()=>{setToken('');setNotice('Provisioning credential cleared.');}}>Provisioning complete · clear credential</ActionButton></div></section>}
  </>}
  {(error||read.error)&&read.errorCode!=='RFID_UNAVAILABLE'&&<div role="alert" className="rfid-readers__feedback rfid-readers__feedback--error"><span>{error||read.error}</span><ActionButton variant="secondary" disabled={busy} onClick={read.refresh}>Retry readers</ActionButton></div>}
 </section>;
}
