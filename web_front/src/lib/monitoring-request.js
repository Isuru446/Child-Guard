import { api } from './api';
// Share only simultaneous identical reads in this tab; never persist sensitive responses.
const pending=new Map();
export function monitoringRequest(path,{signal}={}) {
 if(signal?.aborted)return Promise.reject(new DOMException('Monitoring read cancelled','AbortError'));
 let entry=pending.get(path);
 if(!entry){
  const controller=new AbortController();entry={controller,users:0,promise:null};
  entry.promise=Promise.resolve().then(()=>api(path,{signal:controller.signal})).finally(()=>{if(pending.get(path)===entry)pending.delete(path);});
  pending.set(path,entry);
 }
 entry.users++;
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(work,value)=>{
   if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.users--;
   if(!entry.users){if(pending.get(path)===entry)pending.delete(path);entry.controller.abort();}
   work(value);
  };
  const abort=()=>finish(reject,new DOMException('Monitoring read cancelled','AbortError'));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
