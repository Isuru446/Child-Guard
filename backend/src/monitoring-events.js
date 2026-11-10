import { randomUUID } from 'node:crypto';
import { fail } from './events.js';

// One API process, no durable event log. Reconnect always requests an authoritative reread.
export function createMonitoringHub() {
 const centers=new Map();
 return {
  subscribe(centerId,listener){
   const listeners=centers.get(centerId)??new Set();
   if(listeners.size>=32)throw fail(429,'STREAM_LIMIT','Too many monitoring streams');
   listeners.add(listener);centers.set(centerId,listeners);
   return()=>{listeners.delete(listener);if(!listeners.size)centers.delete(centerId);};
  },
  publish(centerId,{topics,alertIds=[]}){
   const event={id:randomUUID(),topics:[...new Set(topics)],alertIds:alertIds.slice(0,16),notifiedAt:new Date().toISOString()};
   for(const listener of centers.get(centerId)??[])listener(event);
  },
 };
}

// Called only AFTER ingest() resolves its transaction, never inside a retryable transaction.
export async function notifyCommittedTelemetry(db,hub,device,payload,result) {
 if(result.duplicate)return;
 const topics=['devices'];let alertIds=result.tamperAlertIds??[];
 if(alertIds.length)topics.push('alerts');
 if(payload.eventType==='CHILD_NEAR_GATE')topics.push('attendance');
 if(result.alertCreated || result.geofence?.alertCreated){
  const rows=await db.alert.findMany({where:{event:{eventId:result.eventId,device:{centerId:device.centerId}}},select:{id:true},take:16});
  alertIds=rows.map(r=>r.id);if(alertIds.length)topics.push('alerts');
 }
 hub.publish(device.centerId,{topics,alertIds});
}

export function mountMonitoringStream(app,{hub,asyncRoute,heartbeatMs=15000}) {
 app.get('/api/v1/monitoring/stream',asyncRoute(async(req,res)=>{
  if(req.authTransport!=='admin-cookie'||req.user?.role!=='ADMIN'||!req.validateMonitoringSession)throw fail(403,'FORBIDDEN','Admin cookie session required');
  let stopped=false,busy=false,pending=null,expiry=null,heartbeat=null,unsubscribe=()=>{};
  const centerId=req.user.centerId;
  const close=()=>{if(stopped)return;stopped=true;clearTimeout(expiry);clearInterval(heartbeat);unsubscribe();res.end();};
  res.on('close',close);
  const validate=async()=>{
   const data=await req.validateMonitoringSession();
   if(stopped)return;
   if(data.user.centerId!==centerId||data.user.role!=='ADMIN')throw Error('Authorization changed');
   clearTimeout(expiry);
   const remaining=Math.min(+new Date(data.session.idleExpiresAt),+new Date(data.session.absoluteExpiresAt))-+new Date(data.serverTime);
   expiry=setTimeout(()=>{void deliver(null);},Math.max(1,remaining));expiry.unref?.();
  };
  const deliver=async event=>{
   if(stopped)return;
   if(busy){if(event)pending=event;return;} // Invalidation coalescing, not record delivery.
   busy=true;
   try{
    await validate();if(stopped)return;
    const frame=event?`id: ${event.id}\nevent: ${event.resync?'resync':'update'}\ndata: ${JSON.stringify(event)}\n\n`:': keepalive\n\n';
    if(!res.write(frame))close(); // A slow client reconnects and rereads instead of accumulating data.
   }catch{close();}
   finally{busy=false;if(pending&&!stopped){const next=pending;pending=null;void deliver(next);}}
  };
  await validate();
  if(stopped)return;
  try{unsubscribe=hub.subscribe(centerId,event=>{
   // Merge topics if another commit arrives while session validation is in flight.
   if(busy && pending)event={...event,topics:[...new Set([...pending.topics,...event.topics])],alertIds:[...new Set([...pending.alertIds,...event.alertIds])].slice(0,16)};
   void deliver(event);
  });}catch(error){clearTimeout(expiry);throw error;}
  res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});
  res.flushHeaders();
  heartbeat=setInterval(()=>{void deliver(null);},heartbeatMs);heartbeat.unref?.();
  await deliver({id:randomUUID(),resync:true,topics:['alerts','devices','attendance'],alertIds:[],notifiedAt:new Date().toISOString()});
 }));
}
