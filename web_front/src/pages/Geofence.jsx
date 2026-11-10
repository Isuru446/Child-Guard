import ChildLocationPicker from '../components/ChildLocationPicker';
import TechnicalDetails from '../components/TechnicalDetails';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import ActionButton from '../components/ActionButton';
import StatCard from '../components/StatCard';
import { MapPin, CircleDot, Pencil, RefreshCw } from 'lucide-react';
import {StatusPill} from '../components/ManagementUI';
import RecordedLocationPreview from '../components/RecordedLocationPreview';
import '../style/SafetyRestoration.css';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import { api } from '../lib/api';
import '../style/Geofence.css';
import '../style/RegistrationApproval.css';
const locationState=value=>({INSIDE:'Inside safe area',OUTSIDE:'Outside safe area',UNKNOWN:'No recent valid location'})[value]||'Location unavailable';
const blank={name:'',latitude:'',longitude:'',radiusM:'',active:false};
export default function Geofence(){
 const read=useMonitoringRead('/api/v1/safe-zones',{intervalMs:15000});
 const [form,setForm]=useState(blank),[draft,setDraft]=useState(null),[error,setError]=useState('');
 const limits=read.data?.limits;
 const [busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[message,setMessage]=useState('');
 const available=read.data?.configurationAvailable===true,zone=read.data?.zones?.[0];
 async function save(){
  if(!draft||busy||!available||!window.confirm('Save this center safe zone? Active configuration evaluates only fresh, qualified prototype GPS; it does not guarantee child safety.'))return;
  setBusy(true);setError('');try{await api('/api/v1/safe-zones',{method:'PUT',body:JSON.stringify({...draft,revision})});setMessage('Safe area saved. Alerts still need recent, good-quality GPS readings.');setDraft(null);read.refresh();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const change=e=>{setForm(v=>({...v,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}));setDraft(null);setError('');};
 function review(e){
  e.preventDefault();setDraft(null);
  const latitude=Number(form.latitude),longitude=Number(form.longitude),radiusM=Number(form.radiusM),name=form.name.trim();
  if(!limits||!name||name.length>limits.maxNameLength||[...form.name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||[form.latitude,form.longitude,form.radiusM].some(v=>!v.trim())||![latitude,longitude,radiusM].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||radiusM<limits.minRadiusM||radiusM>limits.maxRadiusM){setError('Enter a zone name, valid coordinate pair and a radius within the displayed review limits.');return;}
  setError('');setDraft({name,latitude,longitude,radiusM,active:form.active});
 }
 return <div className="gf-page"><Topbar hideTitle/><main className="gf-container cg-admin-content"><h1>GPS Safe Area</h1>
 <p role="note">{available?'Set the safe area for your center. Alerts need recent GPS readings; missing or old readings cannot show current safety.':'Safe-area monitoring is not available yet. Ask the project owner to complete setup. This page is not enforcing a boundary.'}</p>
 {read.loading&&<p role="status">Checking safe-zone availability…</p>}{read.error&&<p role="alert">{read.error}</p>}
 <section className="gf-stats-grid"><StatCard title="Saved safe areas" value={available?(zone?1:0):'Unavailable'} icon={MapPin}/></section><div className="gf-configuration-layout"><section className="cg-panel gf-saved-zone" aria-labelledby="saved-safe-area-title"><h2 id="saved-safe-area-title">Saved GPS Safe Area</h2>
 {available&&zone?<>
  <div className="gf-saved-header"><div><span className="gf-detail-label">Zone Name</span><h3>{zone.name}</h3></div><div className="gf-zone-status"><span className="gf-detail-label">Status</span><StatusPill tone={zone.active?'success':'muted'}>{zone.active?'Enabled':'Disabled'}</StatusPill></div></div>
  <div className="gf-saved-location"><h3>Center Location</h3><RecordedLocationPreview latitude={zone.latitude} longitude={zone.longitude} radius={zone.radiusM} name={zone.name} label="Persisted center safe-zone boundary" previewLabel="Preview Location"/></div>
  <dl className="gf-zone-radius"><dt><CircleDot size={19} aria-hidden="true"/>Safe Area Radius</dt><dd>{zone.radiusM} meters</dd></dl>
  <TechnicalDetails title="Safe area technical details"><p>Revision: {zone.revision}</p></TechnicalDetails>
 </>:<p>{available?'No center zone configured. Enter real coordinates below; nothing is prefilled.':'Saved safe areas are currently unavailable. Refresh Safe Area, or ask the project owner to check setup.'}</p>}
 <div className="gf-saved-actions">{available&&zone&&<ActionButton icon={Pencil} onClick={()=>{setForm({name:zone.name,latitude:String(zone.latitude),longitude:String(zone.longitude),radiusM:String(zone.radiusM),active:zone.active});setRevision(zone.revision);setDraft(null);setMessage('');}}>Edit Safe Area</ActionButton>}<ActionButton variant="secondary" icon={RefreshCw} title="Reload setup availability and the saved safe area." onClick={read.refresh} disabled={read.refreshing}>{read.refreshing?'Refreshing...':'Refresh Safe Area'}</ActionButton></div></section>

 <section className="cg-panel gf-editor restored-filterbar"><h2>Set Up Your Safe Area</h2><p>Your center can have one circular safe area. Saving it does not change child or wearable assignments.</p><p>Reviewing a draft does not save it or create alerts. Select Save center zone after reviewing.</p>
 <form onSubmit={review}><fieldset disabled={!limits||read.loading||!!read.error||busy}><legend>Safe area details</legend>
 <label>Zone name<input name="name" value={form.name} maxLength={limits?.maxNameLength??100} required onChange={change}/></label>
 <label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" value={form.latitude} required onChange={change}/></label>
 <label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" value={form.longitude} required onChange={change}/></label>
 <label>Radius (meters)<input name="radiusM" type="number" step="any" min={limits?.minRadiusM} max={limits?.maxRadiusM} value={form.radiusM} required onChange={change}/></label>
 <label><input name="active" type="checkbox" checked={form.active} onChange={change}/>Enable after saving (reviewing alone does not start monitoring)</label>
 <p>Allowed radius: {limits?`${limits.minRadiusM}–${limits.maxRadiusM} meters`:'unavailable'}. GPS readings may be less accurate near the edge.</p><ActionButton type="submit">Review safe area</ActionButton>
 </fieldset></form>{error&&<p role="alert">{error}</p>}
 {draft&&<section aria-label="Unsaved zone draft"><h3>{draft.name}</h3><p>This draft is for your center.</p><p>Coordinates: {draft.latitude}, {draft.longitude}. Radius: {draft.radiusM} meters.</p><p>After saving: {draft.active?'active':'inactive'}. Not saved. Not used for monitoring yet.</p><ActionButton variant="secondary" onClick={()=>{setForm(blank);setDraft(null);}}>Discard draft</ActionButton></section>}
 {available&&draft&&<ActionButton disabled={busy} onClick={save}>{busy?'Saving zone…':'Save center zone'}</ActionButton>}{message&&<p role="status">{message}</p>}
 </section></div>
 {available&&<section className="cg-panel"><h2>Recent Location Readings</h2><p>Location readings may be out of date. Check the time before acting.</p>{read.data.readings?.length?<div className="cg-table-scroll"><table><thead><tr><th>Child / belt</th><th>Recorded Location</th><th>Latest Location</th><th>Time</th><th>Details</th></tr></thead><tbody>{read.data.readings.map(r=><tr key={r.eventId}><td>{r.childName||'Unassigned / unknown'} / {r.hardwareId}</td><td>{locationState(r.state)}</td><td>{locationState(r.currentState)}</td><td>{r.observedAt?new Date(r.observedAt).toLocaleString():'Not established'}</td><td><TechnicalDetails title="Technical reason">{r.reason}</TechnicalDetails></td></tr>)}</tbody></table></div>:<p>No GPS readings are available yet. Check the wearable and try again.</p>}</section>}
 <ChildLocationPicker/>
 <TechnicalDetails title="GPS requirements and technical limits"><p>Legacy GPS cannot trigger violations. New prototype evidence requires GNSS UTC within 15 seconds of server receipt, fix age at most 5 seconds, queue age at most 1 second, at least 4 reported satellites and HDOP at most 2.5. HDOP is not accuracy in meters. Unknown quality, delayed telemetry, changed assignments or stale positions do not create alerts.</p><p><Link to="/alerts">Review recorded safety alerts</Link>, <Link to="/devices">wearable observations</Link> and <Link to="/students">existing child/device relationships</Link>.</p></TechnicalDetails>
 </main><Footer/></div>;
}
