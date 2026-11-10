import {latencyMark} from './latency-mark';
// One stream per visible origin when Web Locks + BroadcastChannel are available.
// Only invalidations travel across tabs; no child data, cookies or credentials are stored.
export function createMonitoringEvents({open=()=>new EventSource('/api/v1/monitoring/stream'),locks=globalThis.navigator?.locks,
 channelFactory=typeof BroadcastChannel==='function'?()=>new BroadcastChannel('childguard-monitoring-v1'):null,
 supported=typeof EventSource==='function',visible=()=>!document.hidden&&navigator.onLine!==false,
 schedule=setTimeout,cancel=clearTimeout,listen=fn=>{
  document.addEventListener('visibilitychange',fn);window.addEventListener('online',fn);window.addEventListener('offline',fn);
  return()=>{document.removeEventListener('visibilitychange',fn);window.removeEventListener('online',fn);window.removeEventListener('offline',fn);};
 }}={}) {
 const listeners=new Set(),seen=new Set();let source=null,channel=null,controller=null,release=null,unlisten=null,retry=null,failures=0,live=false;
 function emit(event,broadcast=false){
  if(event.id){if(seen.has(event.id))return;seen.add(event.id);if(seen.size>256)seen.delete(seen.values().next().value);}
  if(typeof event.live==='boolean')live=event.live;
  if(event.topics?.includes('alerts'))latencyMark('childguard-alert-frame',{notificationId:event.id,alertIds:event.alertIds??[]});
  for(const fn of listeners)fn(event);
  if(broadcast)channel?.postMessage({...event,alertIds:[]});
 }
 function stop(){
  const wasLeader=!!source;
  cancel(retry);retry=null;controller?.abort();controller=null;source?.close();source=null;release?.();release=null;
  if(live)emit({live:false},wasLeader);
 }
 function connect(){
  if(!visible()||!listeners.size)return;
  let current;
  try{current=open();}catch{stop();retry=schedule(reconcile,Math.min(30000,1000*2**Math.min(failures++,5)));return;}
  source=current;
  source.onopen=()=>{if(source!==current)return;failures=0;emit({live:true},true);};
  const receive=message=>{
   if(source!==current||!visible())return;
   try{const e=JSON.parse(message.data);if(!Array.isArray(e.topics)||!e.topics.every(t=>['alerts','devices','attendance'].includes(t)))return;
    emit({...e,live:true},true);
   }catch{/* An invalid frame never changes displayed records. */}
  };
  source.addEventListener('update',receive);source.addEventListener('resync',receive);
  source.onerror=()=>{
   if(source!==current)return;
   stop();if(visible()&&listeners.size){const delay=Math.min(30000,1000*2**Math.min(failures++,5));retry=schedule(reconcile,delay);}
  };
 }
 function reconcile(){
  if(!visible()||!listeners.size){stop();return;}
  channel?.postMessage({probe:true});
  if(!supported||source||controller)return;
  if(locks&&channel){
   controller=new AbortController();const own=controller;
   locks.request('childguard-monitoring-stream',{signal:own.signal},async()=>{
    if(own.signal.aborted||!visible())return;
    await new Promise(resolve=>{release=resolve;connect();});
   }).catch(()=>{}).finally(()=>{if(controller===own)controller=null;});
  }else connect();
 }
 return {
  subscribe(fn){
   listeners.add(fn);fn({live});
   if(listeners.size===1){
    channel=supported?channelFactory?.():null;if(channel){channel.onmessage=e=>{
     if(e.data.probe){if(source?.readyState===1)channel.postMessage({live:true});}
     else if(visible())emit(e.data);
    };channel.postMessage({probe:true});}
    unlisten=listen(reconcile);reconcile();
   }
   return()=>{listeners.delete(fn);if(!listeners.size){stop();unlisten?.();unlisten=null;channel?.close();channel=null;seen.clear();}};
  },
 };
}
export const monitoringEvents=createMonitoringEvents();
export function monitoringTopics(path){
 if(path?.startsWith('/api/v1/transport'))return ['transport'];
 if(path?.startsWith('/api/v1/admin/rfid'))return ['devices','attendance'];
 if(path?.startsWith('/api/v1/activity'))return ['devices','alerts','attendance'];
 if(/^\/api\/v1\/admin\/children\/[^/]+\/location(?:\?|$)/.test(path??''))return ['devices'];
 if(path?.startsWith('/api/v1/beacons')&&!path.startsWith('/api/v1/beacons/gate-registration'))return ['devices'];
 if(path?.startsWith('/api/v1/alerts'))return ['alerts'];
 if(path?.startsWith('/api/v1/admin/safety-summary'))return ['alerts','attendance'];
 if(path?.startsWith('/api/v1/devices')||path?.startsWith('/api/v1/events'))return ['devices'];
 if(path?.startsWith('/api/v1/attendance'))return ['attendance'];
 return [];
}
