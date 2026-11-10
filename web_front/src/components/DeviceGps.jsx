import GoogleMapsLink from './GoogleMapsLink';
import RecordedLocationPreview from './RecordedLocationPreview';
import {gpsTime,freshLocation} from '../lib/gps-location';
const time=gpsTime;
export default function DeviceGps({device,now,stale=false}) {
 const info=device.gpsMonitoring;
 if(!info)return <span>Not reported</span>;
 const location=info.lastValidLocation;
 const valid=location&&typeof location.latitude==='number'&&Number.isFinite(location.latitude)&&Math.abs(location.latitude)<=90&&typeof location.longitude==='number'&&Number.isFinite(location.longitude)&&Math.abs(location.longitude)<=180;
 const recent=!stale&&valid&&freshLocation(location,device,info.latestStatus,now,info.staleAfterMs??60000)&&location.recordedChildId===device.currentAssignment?.child?.id;
 return <div><p>GPS status in recent events: {info.latestStatus==='NOT_REPORTED'?'Not reported':info.latestStatus}</p>{info.statusReceivedAt&&<p>Status received: {time(info.statusReceivedAt)}</p>}
 {valid?<><p>{recent?'Recent reported fix':'Historical / last valid position'}: {location.latitude}, {location.longitude}</p><p>Observed: {time(location.observedAt)} ({location.timingBasis})</p><p>Received: {time(location.receivedAt)}</p><p>Recorded child: {location.recordedChild?`${location.recordedChild.name} (${location.recordedChild.id})`:location.attribution==='UNASSIGNED'?'Unassigned when recorded':'Unavailable'}</p><GoogleMapsLink latitude={location.latitude} longitude={location.longitude} historical={!recent}/><details><summary>View recorded GPS map</summary><RecordedLocationPreview latitude={location.latitude} longitude={location.longitude} name={location.recordedChild?.name??device.hardwareId} label="GPS recorded by this wearable" showGoogle={false}/></details></>:<p>No valid location found in the 24-hour monitoring window.</p>}
 </div>;
}
