import { useEffect } from 'react';
import { useMonitoringRead } from '../lib/use-monitoring-read';

// Share cancellation, visibility pause, backoff and read-only scheduling.
export default function usePollingApi(path,eventName) {
 const state=useMonitoringRead(path,{enabled:!!path});
 const {refresh}=state;
 useEffect(()=>{
  if(!eventName)return;
  window.addEventListener(eventName,refresh);
  return()=>window.removeEventListener(eventName,refresh);
 },[eventName,refresh]);
 return state;
}
