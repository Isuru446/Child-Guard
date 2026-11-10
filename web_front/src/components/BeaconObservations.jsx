import { proximityLabel } from '../lib/ui-language';
import DataTable from './DataTable';
import {Bluetooth} from 'lucide-react';
import MonitoringCardHeader from './MonitoringCardHeader';
const time=value=>value?new Date(value).toLocaleString():'Not observed';
export default function BeaconObservations({device,now,unavailable=false}){
 const stale=b=>{if(unavailable)return true;const age=now-new Date(b.observedAt).getTime();return !b.observedAt||!Number.isFinite(age)||age<0||age>(b.staleAfterMs||45000);};
 const columns=[
  {key:'beaconId',label:'Beacon ID'}, {key:'name',label:'Name',render:b=>b.name||'Not configured'},
  {key:'location',label:'Location',render:b=>b.location||'Not configured'}, {key:'kind',label:'Type'},
  {key:'proximity',label:'Proximity',render:b=>{const p=stale(b)||!device.active?'UNKNOWN':b.proximity;return <span className={`dv-badge dv-badge--${p==='NEAR'?'near':p==='FAR'?'success':'unknown'}`}>{proximityLabel(p)}</span>;}},
  {key:'rssi',label:'Bluetooth signal strength',render:b=>b.rssi==null?'Unavailable':`${b.rssi.toFixed(1)} dBm${stale(b)?' (historical)':''}`},
  {key:'observedAt',label:'Observation time',render:b=>time(b.observedAt)},
  {key:'freshness',label:'Freshness',render:b=>!b.observedAt?'Not observed':stale(b)?'No recent update':'Recent'},
 ];
 return <details className="dv-beacon-details monitoring-card"><MonitoringCardHeader icon={Bluetooth} title={`${device.hardwareId} - Bluetooth beacon readings`} description="View recent Bluetooth beacon observations and signal readings."/><div className="monitoring-card__body"><DataTable caption={`Beacon observations for ${device.hardwareId}`} columns={columns} data={device.beaconStates||[]} rowKey="beaconId" minWidth={900} emptyMessage="No authorized beacon configuration reported." /></div></details>;
}
