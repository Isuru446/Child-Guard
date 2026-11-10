import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useMonitoringRead} from '../lib/use-monitoring-read';
import {createDangerNotifications} from '../lib/danger-notifications';
import {SafetyNoticeContext} from '../lib/safety-notice-context';
import {latencyMark} from '../lib/latency-mark';
import {eventLabel} from '../lib/ui-language';
import './SafetyNotifications.css';
export default function SafetyNotifications({children}){
 const [tracker]=useState(createDangerNotifications);
 const [notices,setNotices]=useState([]);
 const receive=useCallback(data=>{
  if(!data?.rows)return;
  const fresh=tracker.read(data.rows);
  if(fresh.length)setNotices(old=>[...fresh,...old].slice(0,25));
 },[tracker]);
 const feed=useMonitoringRead('/api/v1/alerts?management=true&category=DANGER&limit=25&offset=0',{onData:receive});
 const row=notices[0];
 useEffect(()=>{if(row)latencyMark('childguard-danger-dom-committed',{alertId:row.id});},[row]);
 return <SafetyNoticeContext.Provider value={{count:notices.length,unavailable:!!feed.error}}>{children}{row&&<aside className="cg-safety-notice" role="alert"><strong>{row.kind==='TAMPER_LOOP_OPEN'?eventLabel(row.kind):row.event.zone?.kind==='GATE'?'Recorded gate re-entry alert':'Recorded danger-zone alert'}</strong><p>{row.event.recordedChild?.name||'Recorded child unavailable'} · {row.event.device.hardwareId}</p><p>{row.kind==='TAMPER_LOOP_OPEN'?'Tamper loop disconnected. Please check the child and wearable.':row.event.zone?.name||row.event.zone?.hardwareId||'Beacon'}{row.event.zone?.location?` · ${row.event.zone.location}`:''}</p><p>{new Date(row.createdAt).toLocaleString()} · RECORDED</p><Link to="/alerts" onClick={()=>setNotices([])}>View alert history</Link><button type="button" onClick={()=>setNotices(old=>old.slice(1))}>Dismiss notification</button></aside>}</SafetyNoticeContext.Provider>;
}
