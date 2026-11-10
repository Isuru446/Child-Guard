// Read-only scheduler. No auth/activity/storage imports or writes.
export function createMonitoringPoller({read,onData,onError,onState=()=>{},intervalMs=15000,startDelay=0,timeoutMs=10000,schedule=setTimeout,cancel=clearTimeout,now=Date.now,isVisible=()=>!document.hidden,isOnline=()=>navigator.onLine!==false}) {
 let timer=null,timeout=null,controller=null,inFlight=false,queued=false,disposed=false,generation=0,failures=0,terminal=false,retryUntil=0,hasRead=false;
 const runnable=()=>!disposed&&isVisible()&&isOnline();
 const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
 function queue(delay){if(!runnable()||terminal)return;if(inFlight){queued=true;return;}clear();timer=schedule(run,Math.max(delay,retryUntil-now()));}
 async function run(){
  timer=null;if(!runnable()||inFlight||terminal)return;
  inFlight=true;hasRead=true;queued=false;const own=generation;let timedOut=false;controller=new AbortController();
  onState({refreshing:true,paused:false,pausedReason:null});
  timeout=schedule(()=>{timedOut=true;controller?.abort();},timeoutMs);
  try{const data=await read({signal:controller.signal});if(timedOut)throw Error('Monitoring timeout');if(runnable()&&own===generation){failures=0;retryUntil=0;onData(data);}}
  catch(error){if(runnable()&&own===generation){queued=false;failures=error.status===429?Math.max(2,failures+1):failures+1;if(error.status===429)retryUntil=now()+60000;terminal=[401,403].includes(error.status);onError(timedOut?Object.assign(Error('Monitoring request timed out. Please retry.'),{status:0,code:'NETWORK_TIMEOUT'}):error);}}
  finally{
   if(timeout!==null)cancel(timeout);timeout=null;controller=null;inFlight=false;
   if(!disposed&&own===generation)onState({refreshing:false});
   if(runnable()&&!terminal){if(queued){queued=false;queue(0);}else if(intervalMs>0)queue(failures?Math.min(60000,intervalMs*2**Math.min(failures,3)):intervalMs);}
  }
 }
 function reconcile(){
  clear();if(!runnable()){
   generation++;queued=false;if(timeout!==null)cancel(timeout);timeout=null;controller?.abort();
   if(!disposed)onState({refreshing:false,paused:true,pausedReason:isOnline()?'hidden':'offline'});
  }else if(!terminal){if(inFlight)queued=true;else queue(0);}
 }
 return {
  start(){if(runnable())queue(startDelay);else reconcile();},
  refresh(){terminal=false;failures=0;if(runnable()){if(inFlight)queued=true;else queue(0);}else reconcile();},
  invalidate(){if(inFlight){generation++;queued=true;controller?.abort();}else if(!terminal)queue(0);},
  setInterval(ms){if(intervalMs===ms)return;intervalMs=ms;if(hasRead&&!inFlight)queue(ms);},
  reconcile,
  dispose(){disposed=true;generation++;queued=false;clear();if(timeout!==null)cancel(timeout);timeout=null;controller?.abort();},
 };
}
