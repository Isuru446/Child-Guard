import TechnicalDetails from './TechnicalDetails';
import { deviceUpdateLabel } from '../lib/ui-language';
import ModalCloseButton from './ModalCloseButton';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import { useEffect, useRef, useState } from 'react';
import ActionButton from './ActionButton';
import DataTable from './DataTable';
import GoogleMapsLink from './GoogleMapsLink';
import {gpsTime} from '../lib/gps-location';
import { useMonitoringRead } from '../lib/use-monitoring-read';
const time=gpsTime;
const types=['TAMPER_LOOP_OPEN','TAMPER_LOOP_RESTORED','TAMPER_LOOP_STATUS','GPS_STATUS','BLE_PROXIMITY','CHILD_NEAR_GATE','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SUMMARY','ACTIVITY_WINDOW','ACTIVITY_SAMPLE_GAP'];
function detail(event){
 const p=event.payload??{};
 const values=[p.gpsStatus,p.latitude!==undefined&&p.longitude!==undefined?`${p.latitude}, ${p.longitude}`:null,p.proximity,p.rssi!==undefined?`${p.rssi} dBm`:null,p.activityState,p.sensorStatus,p.movementIntensity!==undefined&&p.movementIntensity!==null?`Movement intensity ${p.movementIntensity} g`:null];
 if(event.alerts?.length)values.push(`Stored alerts: ${event.alerts.map(a=>a.kind).join(', ')}`);
 return <>{values.filter(v=>v!==null&&v!==undefined).join(' · ')||'No additional stored measurements'}{p.gpsStatus==='GPS_FIX'&&<GoogleMapsLink latitude={p.latitude} longitude={p.longitude} historical/>}</>;
}
export default function DeviceEventHistory({device,onClose}) {
 const [offset,setOffset]=useState(0),[until,setUntil]=useState(null),[type,setType]=useState('');
 const dialog=useRef(null),close=useRef(onClose);
 useEffect(()=>{close.current=onClose;},[onClose]);
 const q=new URLSearchParams({management:'true',deviceId:device.id,limit:'25',offset:String(offset),...(until?{until}:{}),...(type?{eventType:type}:{})});
 const state=useMonitoringRead(`/api/v1/events?${q}`,{intervalMs:offset?0:15000});
 const rows=state.data?.events??[];
 useDialogAccessibility(dialog,onClose,{open:true,busy:false});
 function newest(){setOffset(0);setUntil(null);if(offset===0&&!until)state.refresh();}
 function page(value){setUntil(value===0?null:state.data.until);setOffset(value);}
 return <div className="registration-modal-overlay"><section ref={dialog} tabIndex={-1} className="registration-modal" role="dialog" data-dialog-size="wide" aria-modal="true" aria-label={`Recent events for ${device.hardwareId}`}><div className="registration-modal__header"><h2>Device update history — {device.hardwareId}</h2><ModalCloseButton disabled={false} onClick={onClose}/></div>
 <p>Device updates saved in the last 24 hours. These show the child linked when each update was recorded, which may differ from the current assignment. An update is not confirmation of an emergency.</p>
 <label>Update type<select value={type} onChange={e=>{setType(e.target.value);setOffset(0);setUntil(null);}}><option value="">All recorded types</option>{types.map(t=><option key={t} value={t}>{deviceUpdateLabel(t)}</option>)}</select></label><ActionButton disabled={state.refreshing} onClick={newest}>Newest events</ActionButton>
 {state.error&&<p role="alert">{state.error}</p>}{state.paused&&<p role="status">Monitoring paused: {state.pausedReason||'not active'}.</p>}
 {state.data&&<p>Updates through {time(state.data.until)}. {offset?'Older pages do not auto-refresh.':'Newest page refreshes every 15 seconds.'}</p>}
 <DataTable caption="Recorded device events" data={rows} loading={state.loading} emptyMessage="No device updates match these filters." minWidth={750} columns={[
  {key:'eventType',label:'Update type',render:e=>deviceUpdateLabel(e.eventType)},{key:'receivedAt',label:'Received',render:e=>time(e.receivedAt)},
  {key:'observedAt',label:'Observation time',render:e=><>{time(e.observedAt)}<TechnicalDetails title="Technical references"><p>Update type: {e.eventType}</p><p>Event reference: {e.eventId||e.id}</p><p>Timing: {e.timingBasis}</p></TechnicalDetails></>},
  {key:'child',label:'Recorded child',render:e=>e.recordedChild?`${e.recordedChild.name} (${e.recordedChild.id})`:e.attribution==='UNASSIGNED'?'Unassigned when recorded':'Recorded child unavailable'},
  {key:'details',label:'Stored details',render:detail},
 ]}/>
 <ActionButton disabled={state.refreshing||state.loading||offset===0||!state.data} onClick={()=>page(Math.max(0,offset-25))}>Previous events</ActionButton><span> Page {offset/25+1} </span><ActionButton disabled={state.refreshing||state.loading||!state.data?.hasMore} onClick={()=>page(offset+25)}>Next events</ActionButton>
 </section></div>;
}
