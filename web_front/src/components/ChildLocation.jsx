import {useEffect,useState} from 'react';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {freshLocation,gpsLabel,gpsTime,validGps} from '../lib/gps-location';
import ActionButton from './ActionButton';
import LocationMap from './LocationMap';
import GoogleMapsLink from './GoogleMapsLink';
import './ChildLocation.css';

export default function ChildLocation({childId,childName}){
 const read=useMonitoringRead(`/api/v1/admin/children/${encodeURIComponent(childId)}/location`);
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setClock(Date.now());},1000);return()=>clearInterval(timer);},[]);
 const data=read.data,device=data?.device,gps=data?.gpsMonitoring,point=gps?.lastValidLocation;
 const verified=data?.child?.id===childId;
 const valid=verified&&device&&point?.recordedChildId===childId&&validGps(point.latitude,point.longitude);
 const server=Date.parse(data?.serverTime);
 const now=Number.isFinite(server)&&read.updatedAt?server+Math.max(0,clock-read.updatedAt):clock;
 const recent=valid&&freshLocation(point,device,gps.latestStatus,now,gps.staleAfterMs??60000);
 const zone=data?.geofence;
 const locations=valid?[{id:childId,name:data.child.name,lat:point.latitude,lng:point.longitude,type:'child',description:recent?'Recent GPS location':'Historical / last recorded location'}]:[];
 if(zone?.active===true&&validGps(zone.latitude,zone.longitude)&&typeof zone.radiusM==='number'&&Number.isFinite(zone.radiusM)&&zone.radiusM>0)locations.push({id:zone.id??'safe-area',name:zone.name,lat:zone.latitude,lng:zone.longitude,radius:zone.radiusM,type:'geofence',description:'Configured boundary; not a live safety assessment'});
 return <section className="cg-child-location" aria-label={`Child location for ${childName}`}><div className="cg-child-location__heading"><h3>Child Location</h3><ActionButton variant="secondary" onClick={read.refresh} disabled={read.refreshing}>Refresh location</ActionButton></div>
 {read.loading?<p role="status">Loading location...</p>:read.error?<p role="alert">Unable to load this child's location. {read.error}</p>:!verified?<p role="alert">Unable to verify this child's location.</p>:<>
 <p>Child: {data.child.name}</p>{device?<p>Wearable: {device.hardwareId}</p>:<p>No wearable assigned to this child.</p>}
 {device&&<><p>{gpsLabel(gps?.latestStatus)}</p><p>Wearable: {device.connectionState==='ONLINE'&&Number.isFinite(now-Date.parse(device.lastSeen))&&now-Date.parse(device.lastSeen)>=0&&now-Date.parse(device.lastSeen)<=60000?'Online':device.connectionState==='OFFLINE'?'Offline':'No recent communication confirmed'}</p></>}
 {valid?<><p className={recent?'':'cg-location-historical'}>{recent?'Recent GPS location':'Historical / last recorded location — not a live position'}</p><dl><dt>Latitude</dt><dd>{point.latitude}</dd><dt>Longitude</dt><dd>{point.longitude}</dd><dt>GPS observed</dt><dd>{gpsTime(point.observedAt)}</dd><dt>Received by ChildGuard</dt><dd>{gpsTime(point.receivedAt)}</dd></dl><GoogleMapsLink latitude={point.latitude} longitude={point.longitude} historical={!recent}/></>:device&&<p>No valid GPS location recorded yet.</p>}
 {locations.length>0&&<LocationMap locations={locations} preserveView label={`Recorded GPS map for ${data.child.name}`}/>}
 <p className="cg-location-note">Recorded GPS and the saved boundary do not establish current child safety.</p>
 </>}
 </section>;
}
