import { requestMessage } from './ui-language';
import { useCallback, useEffect, useRef, useState } from 'react';
import { monitoringRequest } from './monitoring-request';
import { createMonitoringPoller } from './monitoring-poller';
import { monitoringEvents, monitoringTopics } from './monitoring-events';

export function useMonitoringRead(path,{enabled=true,intervalMs=15000,startDelay=0,onData,adaptiveInterval=true}={}) {
 const [state,setState]=useState({key:null,data:null,error:'',loading:true,refreshing:false,updatedAt:null,paused:false,pausedReason:null,stale:false});
 const poll=useRef(null),manual=useRef(false),receive=useRef(onData);
 useEffect(()=>{receive.current=onData;},[onData]);
 useEffect(()=>{
  if(!enabled)return;
  const driver=createMonitoringPoller({intervalMs,startDelay,read:({signal})=>monitoringRequest(path,{signal}),
   onData:data=>{setState(s=>({...s,key:path,data:s.key===path&&JSON.stringify(s.data)===JSON.stringify(data)?s.data:data,error:'',errorCode:null,loading:false,stale:false,updatedAt:Date.now()}));receive.current?.(data);},
   onError:error=>setState(s=>({...s,key:path,data:s.key===path&&![401,403,404].includes(error.status)?s.data:null,error:requestMessage(error),errorCode:error.code??null,loading:false})),
   onState:next=>{const manualRefreshing=!!next.refreshing&&manual.current;if(next.refreshing===false)manual.current=false;setState(s=>({...s,...next,manualRefreshing,stale:next.pausedReason==='offline'?s.data!=null:s.stale}));},
  });poll.current=driver;driver.start();
  const reconcile=()=>driver.reconcile();
  document.addEventListener('visibilitychange',reconcile);window.addEventListener('online',reconcile);window.addEventListener('offline',reconcile);
  return()=>{driver.dispose();poll.current=null;manual.current=false;document.removeEventListener('visibilitychange',reconcile);window.removeEventListener('online',reconcile);window.removeEventListener('offline',reconcile);};
 },[path,enabled,intervalMs,startDelay]);
 const refresh=useCallback(()=>{if(poll.current){manual.current=true;setState(s=>({...s,manualRefreshing:true}));poll.current.refresh();}},[]);
 useEffect(()=>{
  const topics=monitoringTopics(path);if(!enabled||intervalMs===0||!topics.length)return;
  let timer=null;
  const unsubscribe=monitoringEvents.subscribe(event=>{
   // Short-lived workflows may require a fixed fallback even with live SSE.
   if(adaptiveInterval&&typeof event.live==='boolean')poll.current?.setInterval(event.live?60000:3000);
   if(event.topics?.some(topic=>topics.includes(topic))){
    if(timer===null)timer=setTimeout(()=>{timer=null;poll.current?.invalidate();},topics.includes('alerts')?25:100);
   }
  });
  return()=>{unsubscribe();clearTimeout(timer);};
 },[path,enabled,intervalMs,adaptiveInterval]);
 const current=state.key===path;
 return {...state,...(!current?{data:null,error:'',errorCode:null,loading:true,updatedAt:null,manualRefreshing:false}:{}),
  stale:current&&state.data!=null&&(state.stale||!!state.error||state.pausedReason==='offline'),paused:!enabled||state.paused,refresh};
}
