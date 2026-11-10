import {useRef,useState} from 'react';
import {Bus,RefreshCw} from 'lucide-react';
import {api} from '../lib/api';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import ActionButton from './ActionButton';
import './BusTransportMonitoring.css';

const labels={DISARMED:'Inactive',WAITING_FOR_BOARDING:'Waiting for boarding',BOARDING_CANDIDATE:'Boarding candidate',ON_BOARD:'On Board',EXIT_CANDIDATE:'Exit candidate',OFF_BOARD:'Off Board',CONNECTION_UNKNOWN:'Connection lost / location unconfirmed'};
const time=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Colombo'}):'Not available';
export default function BusTransportMonitoring(){
 const read=useMonitoringRead('/api/v1/transport',{intervalMs:5000,adaptiveInterval:false});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
 const data=read.data,unconfirmed=read.stale||!!read.error;
 async function activate(){
  if(pending.current||!window.confirm('End the daycare session and activate temporary bus monitoring for today? This does not check out children or change attendance.'))return;
  pending.current=true;setBusy(true);setError('');
  try{await api('/api/v1/transport/end-daycare',{method:'POST',body:JSON.stringify({confirm:true})});read.refresh();}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}
 }
 return <section className="bus-monitor" aria-label="Live bus BLE monitoring">
  <div className="bus-monitor__heading"><div className="bus-monitor__icon"><Bus aria-hidden="true"/></div><div><h2>Bus BLE Monitoring</h2><p>Live wearable reports · BLE-inferred transport, not verified physical boarding or exit.</p></div><ActionButton variant="secondary" icon={RefreshCw} onClick={read.refresh}>Refresh bus monitoring</ActionButton></div>
  <div className="bus-monitor__session"><div><h3>Daycare Transport Session</h3><p><strong>{unconfirmed?'Status unavailable':data?.session?'Active':'Inactive'}</strong>{data?.session&&` · Activated ${time(data.session.activatedAt)} (Sri Lanka)`}</p><p>Temporary memory only. Backend restart clears this session and its notifications; Admin must activate it again.</p></div><ActionButton disabled={busy||!data?.enabled||!!data?.session||unconfirmed} onClick={activate}>{busy?'Activating…':'End Daycare Session'}</ActionButton></div>
  {data&&!data.enabled&&<p>Bus transport is not configured for this center. Configure the private backend settings before testing.</p>}
  {(error||read.error)&&<p role="alert">{error||read.error} Last readings are unconfirmed. Retry using Refresh bus monitoring.</p>}
  {read.loading&&!data?<p role="status">Loading bus reports…</p>:<><p><strong>{data?.busId??'Bus unavailable'}</strong> · Beacon {data?.beaconId??'unavailable'} · Times shown in Sri Lanka time.</p><div className="bus-monitor__table"><table><thead><tr><th>Child / wearable</th><th>Bus signal</th><th>Scan / connection</th><th>Transport status</th><th>Latest detections</th></tr></thead><tbody>{(data?.rows??[]).map(row=><tr key={row.child.id+row.wearableId}><td><strong>{row.child.name}</strong><br/>{row.wearableId}</td><td><span className="bus-monitor__badge">{unconfirmed?'UNKNOWN':row.proximity}</span><br/>{!unconfirmed&&typeof row.rssi==='number'?`${row.rssi.toFixed(1)} dBm`:'No current RSSI'}<br/>Last detected: {time(row.lastDetectionAt)}</td><td>{unconfirmed||row.connection!=='RECENT_REPORT'?'Connection unconfirmed':'Recent authenticated report'}<br/>Healthy scan: {time(row.lastHealthyScanAt)}<br/>Report: {time(row.lastReportAt)}</td><td><strong>{unconfirmed?labels.CONNECTION_UNKNOWN:labels[row.state]??'Unknown'}</strong>{row.lastConfirmedState&&<p>Last confirmed BLE state: {labels[row.lastConfirmedState]}</p>}</td><td>Boarding: {time(row.boardedAt)}<br/>Inferred exit: {time(row.exitedAt)}</td></tr>)}</tbody></table></div>{data?.rows?.length===0&&<p>No active assigned wearables in this center.</p>}</>}
 </section>;
}
