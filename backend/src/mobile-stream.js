import { randomUUID } from 'node:crypto';
import { fail } from './events.js';

// Per-child JWT stream. A center notification alone NEVER authorizes a Parent.
export async function mobileStream(req,res,{db,hub,authorize,centerWide=false}) {
 if(req.authTransport!=='legacy-mobile'||!req.validateMobileStream||!['PARENT','TEACHER'].includes(req.user.role))throw fail(403,'FORBIDDEN','Parent or Teacher JWT required');
 let closed=false,busy=false,pending=null,expiry,heartbeat,unsubscribe=()=>{};
 if(centerWide&&req.user.role!=='TEACHER')throw fail(403,'FORBIDDEN','Center Teacher required');
 const centerId=req.user.centerId,childId=req.params.id;
 const close=()=>{if(closed)return;closed=true;clearTimeout(expiry);clearInterval(heartbeat);unsubscribe();res.end();};
 res.on('close',close);
 async function validate(){
  const session=await req.validateMobileStream();
  if(session.user.centerId!==centerId||!['PARENT','TEACHER'].includes(session.user.role)||(centerWide&&session.user.role!=='TEACHER')||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw fail(401,'UNAUTHENTICATED','Sign in required');
  await authorize({...req,user:session.user});
  clearTimeout(expiry);if(!closed){expiry=setTimeout(close,Math.max(1,session.expiresAt-Date.now()));expiry.unref?.();}
 }
 async function send(event){
  if(closed)return;if(busy){if(event)pending=event;return;}busy=true;
  try{
   await validate();if(closed)return;
   if(event&&!event.resync){
    const alerts=await db.alert.findMany({where:{id:{in:event.alertIds},event:{...(centerWide?{child:{centerId}}:{childId}),device:{centerId}}},select:{id:true},take:16});
    if(!alerts.length)return;
    event={id:event.id,topics:['alerts'],alertIds:alerts.map(a=>a.id),notifiedAt:event.notifiedAt};
   }
   if(!res.write(event?`id: ${event.id}\nevent: ${event.resync?'resync':'update'}\ndata: ${JSON.stringify(event)}\n\n`:': keepalive\n\n'))close();
  }catch{close();}finally{busy=false;if(pending&&!closed){const next=pending;pending=null;void send(next);}}
 }
 await validate();if(closed)return;
 try{unsubscribe=hub.subscribe(centerId,event=>{
  if(event.topics.some(t=>['attendance','pickups','transport-notifications'].includes(t))){
   // No center-wide records or identifiers are sent. Authorization is checked
   // again before a child-scoped authoritative reread.
   void send({id:event.id,resync:true,topics:['alerts','attendance','pickups',...(event.topics.includes('transport-notifications')?['transport']:[])],alertIds:[]});return;
  }
  if(!event.topics.includes('alerts'))return;
  const next=pending?{...event,alertIds:[...new Set([...pending.alertIds,...event.alertIds])].slice(0,16)}:event;void send(next);
 });}catch(error){clearTimeout(expiry);throw error;}
 res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});res.flushHeaders();
 heartbeat=setInterval(()=>{void send(null);},15000);heartbeat.unref?.();
 await send({id:randomUUID(),resync:true,topics:['alerts'],alertIds:[]});
}
