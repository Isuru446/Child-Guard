import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createMonitoringHub, mountMonitoringStream, notifyCommittedTelemetry } from '../src/monitoring-events.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
let f,login,hub,handler,res,req;
const flush=()=>vi.advanceTimersByTimeAsync(0);
beforeEach(async()=>{
 vi.useFakeTimers();f=sessionFixture();login=await f.login();hub=createMonitoringHub();
 mountMonitoringStream({get:(path,fn)=>{handler=fn;}},{hub,asyncRoute:fn=>fn,heartbeatMs:1000});
 req={user:login.user,authTransport:'admin-cookie',validateMonitoringSession:()=>f.service.validate(login.credential)};
 res=new EventEmitter();res.frames=[];res.status=()=>res;res.set=()=>res;res.flushHeaders=vi.fn();res.write=vi.fn(frame=>{res.frames.push(frame);return true;});res.end=vi.fn();
});
afterEach(()=>{res.emit('close');vi.useRealTimers();});
it('sends authenticated resync then a private center update with original alert IDs',async()=>{
 await handler(req,res);expect(res.frames[0]).toContain('event: resync');
 hub.publish('another-center',{topics:['alerts'],alertIds:['private-other-id']});await flush();expect(res.frames).toHaveLength(1);
 hub.publish(login.user.centerId,{topics:['alerts'],alertIds:['recorded-alert-id']});await flush();expect(res.frames.at(-1)).toContain('recorded-alert-id');expect(res.frames.join('')).not.toContain('private-other-id');
});
it('never renews inactivity through subscription, messages or keepalive',async()=>{
 const before=structuredClone(f.state.sessions[0]);await handler(req,res);
 for(let i=0;i<3;i++){f.tick(1000);await vi.advanceTimersByTimeAsync(1000);hub.publish(login.user.centerId,{topics:['devices']});await flush();}
 expect(f.updates).toBe(0);expect(f.state.sessions[0]).toEqual(before);expect(res.frames.join('')).toContain(': keepalive');
});
it.each(['idle','absolute','revoked','role','center'])('closes %s authorization and sends no further private update',async reason=>{
 if(reason==='absolute'){
  f.tick(28800000-1000);const s=f.state.sessions[0];s.lastActivityAt=new Date(f.clock);s.idleExpiresAt=s.absoluteExpiresAt;
 }
 await handler(req,res);const count=res.frames.length;
 if(reason==='idle'){f.tick(300000);await vi.advanceTimersByTimeAsync(300000);}
 if(reason==='absolute'){f.tick(1000);await vi.advanceTimersByTimeAsync(1000);}
 if(reason==='revoked')f.state.sessions[0].revokedAt=new Date(f.clock);
 if(reason==='role')f.state.user.role='TEACHER';
 if(reason==='center')f.state.user.centerId='new-center';
 hub.publish(login.user.centerId,{topics:['alerts'],alertIds:['must-not-arrive']});await flush();
 expect(res.end).toHaveBeenCalled();expect(res.frames.slice(count).join('')).not.toContain('must-not-arrive');
});
it('revalidates revocation even when there are only keepalives',async()=>{
 await handler(req,res);f.state.sessions[0].revokedAt=new Date(f.clock);await vi.advanceTimersByTimeAsync(1000);expect(res.end).toHaveBeenCalled();
});
it('rejects JWT and missing Admin stream authority',async()=>{
 await expect(handler({...req,authTransport:'legacy-mobile'},res)).rejects.toMatchObject({status:403});
 await expect(handler({...req,validateMonitoringSession:null},res)).rejects.toMatchObject({status:403});
 expect(res.flushHeaders).not.toHaveBeenCalled();
});
it('ends a slow stream instead of building a notification backlog',async()=>{
 res.write.mockReturnValue(false);await handler(req,res);expect(res.end).toHaveBeenCalled();
});
it('reconnect always resynchronizes rather than trusting a missing/restarted event log',async()=>{
 await handler(req,res);res.emit('close');const next=new EventEmitter();Object.assign(next,{frames:[],status:()=>next,set:()=>next,flushHeaders:()=>{},write:frame=>{next.frames.push(frame);return true;},end:()=>{}});
 await handler(req,next);expect(next.frames[0]).toContain('event: resync');next.emit('close');
});
it.each([{alertCreated:true},{geofence:{alertCreated:true}}])('reads committed records before announcing BLE/activity or GPS alert %j',async result=>{
 const received=[];hub.subscribe('center-a',event=>received.push(event));
 const db={alert:{findMany:vi.fn().mockResolvedValue([{id:'persisted-id'}])}};
 await notifyCommittedTelemetry(db,hub,{centerId:'center-a'},{eventType:'GPS_STATUS'},{eventId:'event',...result});
 expect(db.alert.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{event:{eventId:'event',device:{centerId:'center-a'}}}}));
 expect(received[0]).toMatchObject({topics:['devices','alerts'],alertIds:['persisted-id']});
});
it('never claims an alert on suppression, duplicate or absent persisted alert',async()=>{
 const received=[];hub.subscribe('center-a',e=>received.push(e));const db={alert:{findMany:vi.fn().mockResolvedValue([])}};
 await notifyCommittedTelemetry(db,hub,{centerId:'center-a'},{eventType:'DANGER_ZONE_NEAR'},{eventId:'x',duplicate:true,alertCreated:true});expect(received).toHaveLength(0);
 await notifyCommittedTelemetry(db,hub,{centerId:'center-a'},{eventType:'DANGER_ZONE_NEAR'},{eventId:'x',alertCreated:false});
 await notifyCommittedTelemetry(db,hub,{centerId:'center-a'},{eventType:'DANGER_ZONE_NEAR'},{eventId:'x',alertCreated:true});
 expect(received.every(e=>!e.topics.includes('alerts')&&!e.alertIds.length)).toBe(true);
});
