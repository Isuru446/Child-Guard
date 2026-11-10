import RfidReaders from './RfidReaders';
import MonitoringCardHeader from './MonitoringCardHeader';
import MonitoringStatus from './MonitoringStatus';
import TamperStatus from './TamperStatus';
import TechnicalDetails from './TechnicalDetails';
import { proximityLabel, deviceUpdateLabel } from '../lib/ui-language';
import { useEffect, useState } from 'react';
import { useMonitoringRead } from '../lib/use-monitoring-read';
import Topbar from './Topbar';
import Footer from './Footer';
import DataTable from './DataTable';
import BeaconObservations from './BeaconObservations';
import StatCard from './StatCard';
import { Activity, Cpu, Wifi } from 'lucide-react';
import ActionButton from './ActionButton';
import { PageHeading } from './ManagementUI';
import DeviceManagementDialog from './DeviceManagementDialog';
import DeviceEventHistory from './DeviceEventHistory';
import DeviceGps from './DeviceGps';
import RecordedLocationPreview from './RecordedLocationPreview';
import '../style/RegistrationApproval.css';
import '../style/Device.css';
import '../style/DeviceRestoration.css';
const time = value => value ? new Date(value).toLocaleString() : 'Never received';
const observation = event => {
 if (!event) return 'Not reported';
 const p = event.payload;
 return [event.eventType, time(event.receivedAt), p.rssi !== undefined ? `RSSI ${p.rssi} dBm` : null, p.activityState, p.sensorStatus, p.movementIntensity!==undefined&&p.movementIntensity!==null?`Movement intensity ${p.movementIntensity} g`:null, p.accelRms !== undefined ? `Acceleration RMS ${p.accelRms}` : null, p.gyroRms !== undefined ? `Gyroscope RMS ${p.gyroRms}` : null].filter(Boolean).join(' · ');
};
export default function LiveDevices() {
 const [now, setNow] = useState(() => Date.now());
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[assignment,setAssignment]=useState(''),[offset,setOffset]=useState(0),[selection,setSelection]=useState(null),[message,setMessage]=useState('');
 const [history,setHistory]=useState(null);
 const query=new URLSearchParams({management:'true',limit:'25',offset:String(offset),...(search.trim()?{search:search.trim()}:{}),...(status?{state:status}:{}),...(assignment?{assignment}:{})});
 const read=useMonitoringRead(`/api/v1/devices?${query}`,{enabled:!selection&&!history,startDelay:200});
 const state={devices:read.data??[],loading:read.loading,error:read.error};
 useEffect(()=>{const clock=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);return()=>clearInterval(clock);},[]);
 const clock=d=>{
  const server=Date.parse(d.monitoring?.serverTime);
  return Number.isFinite(server)&&read.updatedAt?server+Math.max(0,now-read.updatedAt):Math.max(now,read.updatedAt??now);
 };
 const bleStale = d => {if(read.stale)return true;const age=clock(d)-Date.parse(d.bleState?.observedAt);return !Number.isFinite(age)||age<0||age>(d.bleState?.staleAfterMs||45000);};
 const connection = d => {
  if(!d.active)return 'INACTIVE';
  if(read.stale)return 'UNAVAILABLE';
  const age=clock(d)-new Date(d.lastSeen).getTime();
  if(!d.lastSeen||!Number.isFinite(age)||age<0)return 'UNKNOWN';
  if(d.connectionState==='OFFLINE'||d.connectionState==='UNKNOWN')return d.connectionState;
  return age>60000?'STALE':d.connectionState==='STALE'?'STALE':'ONLINE';
 };
 const telemetryColumns = [
  { key: 'hardwareId', label: 'Public Device ID' },
  { key: 'tamper', label: 'Tamper loop', render:d=><TamperStatus tamper={d.tamper} now={clock(d)} unavailable={read.stale||connection(d)!=='ONLINE'}/> },
  { key: 'registration', label: 'Registration', render:d=>d.active?(d.lastSeen?'Active / event history':'Active / awaiting first event'):'Inactive' },
  { key: 'child', label: 'Assigned child', render:d=>d.currentAssignment?.child.name||'Unassigned' },
  { key: 'actions', label: 'Management', render:d=><ActionButton onClick={()=>setSelection(d)}>Manage {d.hardwareId}</ActionButton> },
  { key: 'events', label: 'Monitoring history', render:d=><ActionButton onClick={()=>setHistory(d)}>Recent events {d.hardwareId}</ActionButton> },
  { key: 'connectionState', label: 'Communication', render:d=>({ONLINE:'Online',OFFLINE:'Offline',STALE:'No recent update',UNKNOWN:'No updates received',UNAVAILABLE:'Updates unavailable',INACTIVE:'Inactive'})[connection(d)] },
  { key: 'lastSeen', label: 'Last seen', render: d => time(d.lastSeen) },
  { key: 'battery', label: 'Battery', render: () => 'Not reported' },
  { key: 'latestEvent', label: 'Latest event', render: d => d.latestEvent ? `${deviceUpdateLabel(d.latestEvent.eventType)} · ${time(d.latestEvent.receivedAt)}` : 'Not reported' },
  { key: 'gps', label: 'GPS', render: d => <DeviceGps device={d} now={clock(d)} stale={read.stale}/> },
  { key: 'gate', label: 'Monitored beacon ID', render: d => d.bleState?.gateId || 'Not reported' },
  { key: 'purpose', label: 'Beacon type / purpose', render: d => d.bleState?.beaconType || (d.bleState?.gateId ? 'Gate / Attendance + Danger Zone' : 'Not reported') },
  { key: 'ble', label: 'Bluetooth proximity', render: d => {
   const stale = bleStale(d) || !d.active;
   const proximity = stale ? 'UNKNOWN' : d.bleState?.proximity || 'UNKNOWN';
   return <span className={`dv-badge ${proximity === 'NEAR' ? 'dv-badge--near' : proximity === 'FAR' ? 'dv-badge--success' : 'dv-badge--unknown'}`}>{proximityLabel(proximity)}</span>;
  } },
  { key: 'rssi', label: 'Bluetooth signal strength', render: d => d.bleState?.rssi == null ? 'Unavailable' : `${d.bleState.rssi.toFixed(1)} dBm${bleStale(d) ? ' (historical)' : ''}` },
  { key: 'bleTime', label: 'Last Bluetooth reading', render: d => time(d.bleState?.observedAt) },
  { key: 'freshness', label: 'Reading age', render: d => !d.bleState?.observedAt ? 'Not reported' : bleStale(d) ? 'Stale' : 'Fresh' },
  { key: 'mpu6050', label: 'Movement sensor readings', render: d => observation(d.mpu6050) },
 ];
 return <div className="dv-page"><Topbar hideTitle /><main className="dv-container cg-admin-content">
  <PageHeading title="Wearable devices" actions={<ActionButton onClick={()=>setSelection('register')}>Register wearable</ActionButton>}></PageHeading>
  <p className="cg-important-note">A recent device update does not prove the belt is worn or the child is safe.</p><TechnicalDetails title="Update times and device references"><p>Active means registered and enabled, not online. Online means an update was received within 60 seconds; no recent update means more than 60 seconds, and offline follows the backend connection timeout. Bluetooth readings expire after 45 seconds. A GPS location becomes historical after 60 seconds or a newer no-fix report.</p><p>Open Manage to find the Device Reference Number (UUID) and Copy UUID. The belt uses its Device ID, such as CG-WEARABLE-001. Private keys are not shown in device details.</p><p>Recent update history covers the last 24 hours. Updates pause when this page is hidden or offline. Counts cover this page only.</p></TechnicalDetails>
  {message&&<p role="status" className="registration-success">{message}</p>}
  <div className="dv-toolbar restored-filterbar"><label>Search devices<input maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label><label>Device status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label>Assignment status<select value={assignment} onChange={e=>{setAssignment(e.target.value);setOffset(0);}}><option value="">All assignments</option><option value="ASSIGNED">Assigned</option><option value="UNASSIGNED">Unassigned</option></select></label><ActionButton disabled={read.manualRefreshing} onClick={read.refresh}>Refresh</ActionButton></div>
  <MonitoringStatus read={read}/>
  {state.loading ? <p role="status">Loading devices…</p> : state.error && !read.data ? null : <>
  <section className="dv-stats-grid"><StatCard title="Registered devices" value={state.devices.length} icon={Cpu} color="blue" /><StatCard title="Online" value={read.stale?'Unavailable':state.devices.filter(d => connection(d) === 'ONLINE').length} icon={Wifi} color="green" /><StatCard title="Assigned wearables" value={state.devices.filter(d=>d.currentAssignment).length} icon={Cpu} color="purple"/></section>
  <DataTable columns={telemetryColumns.filter(c=>['hardwareId','child','connectionState','tamper','lastSeen','actions','events'].includes(c.key))} data={state.devices} rowKey="id" minWidth={900} emptyMessage={search||status||assignment?'No devices match these filters.':'No wearable devices have been registered yet.'} />
  {state.devices.map(device=><details key={`telemetry-${device.id}`} className="dv-telemetry-details monitoring-card"><MonitoringCardHeader icon={Activity} title={`${device.hardwareId} - Location, movement and Bluetooth readings`} description="View location, movement and Bluetooth proximity data."/><div className="monitoring-card__body"><dl className="dv-telemetry-grid">{telemetryColumns.filter(c=>!['actions','events','hardwareId','child','connectionState','lastSeen'].includes(c.key)).map(c=><div key={c.key}><dt>{c.label}</dt><dd>{c.render?c.render(device):device[c.key]??'Not reported'}</dd></div>)}</dl><RecordedLocationPreview latitude={device.gpsMonitoring?.lastValidLocation?.latitude} longitude={device.gpsMonitoring?.lastValidLocation?.longitude} name={`${device.hardwareId}: recorded GPS evidence`} label="Historical wearable GPS evidence"/></div></details>)}
  {state.devices.map(device=><BeaconObservations key={device.id} device={device} now={clock(device)} unavailable={read.stale} />)}
  </>}
  <div className="cg-pagination"><ActionButton disabled={offset===0||state.loading} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous devices</ActionButton><span> Page {offset/25+1} </span><ActionButton disabled={state.devices.length<25||state.loading} onClick={()=>setOffset(n=>n+25)}>Next devices</ActionButton></div>
  <RfidReaders/>
  {selection&&<DeviceManagementDialog selection={selection} onClose={()=>setSelection(null)} onSaved={()=>setMessage('Device operation saved.')}/>}
  {history&&<DeviceEventHistory device={history} onClose={()=>setHistory(null)}/>}
 </main><Footer /></div>;
}
