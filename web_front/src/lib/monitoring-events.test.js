import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMonitoringEvents, monitoringTopics } from './monitoring-events';
let managers,cleanups,sources,visible,reconcile;
beforeEach(()=>{vi.useFakeTimers();managers=[];cleanups=[];sources=[];visible=true;});
afterEach(()=>{cleanups.forEach(fn=>fn());vi.useRealTimers();});
function source(){const listeners={};const value={readyState:0,close:vi.fn(),addEventListener:(name,fn)=>{listeners[name]=fn;},emit(name,event){listeners[name]?.({data:JSON.stringify(event)});}};sources.push(value);return value;}
function manager(options={}){const value=createMonitoringEvents({open:source,supported:true,channelFactory:null,locks:null,visible:()=>visible,listen:fn=>{reconcile=fn;return()=>{};},...options});managers.push(value);return value;}
const flush=()=>vi.advanceTimersByTimeAsync(0);
it('shares a stream across components and deduplicates event IDs without fetching data itself',async()=>{
 const events=[];const m=manager();cleanups.push(m.subscribe(e=>events.push(e)),m.subscribe(()=>{}));expect(sources).toHaveLength(1);
 sources[0].onopen();const e={id:'committed-id',topics:['alerts'],alertIds:['record-id']};sources[0].emit('update',e);sources[0].emit('update',e);
 expect(events.filter(x=>x.id)).toEqual([{...e,live:true}]);
});
it('pauses hidden/offline streams, ignores late messages and resyncs on visibility/reconnection',async()=>{
 const received=[];const m=manager();cleanups.push(m.subscribe(e=>received.push(e)));const old=sources[0];old.onopen();visible=false;reconcile();expect(old.close).toHaveBeenCalled();
 old.emit('update',{id:'obsolete',topics:['alerts']});expect(received.some(e=>e.id==='obsolete')).toBe(false);
 visible=true;reconcile();expect(sources).toHaveLength(2);sources[1].emit('resync',{id:'new',topics:['alerts','devices','attendance']});expect(received.at(-1).id).toBe('new');
});
it('backs off reconnection after failure with a bounded delay',async()=>{
 cleanups.push(manager().subscribe(()=>{}));sources[0].onerror();await vi.advanceTimersByTimeAsync(999);expect(sources).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);expect(sources).toHaveLength(2);
 sources[1].onerror();await vi.advanceTimersByTimeAsync(1999);expect(sources).toHaveLength(2);await vi.advanceTimersByTimeAsync(1);expect(sources).toHaveLength(3);
});
it('shares a single stream across active tabs using locks; a visible follower takes over',async()=>{
 const channels=[];let tail=Promise.resolve();
 const locks={request:vi.fn((name,{signal},work)=>{const next=tail.then(()=>signal.aborted?undefined:work());tail=next.catch(()=>{});return next;})};
 const channelFactory=()=>{const c={onmessage:null,postMessage:event=>{for(const other of channels)if(other!==c)other.onmessage?.({data:event});},close:()=>{channels.splice(channels.indexOf(c),1);}};channels.push(c);return c;};
 let firstVisible=true,firstReconcile;const a=manager({locks,channelFactory,visible:()=>firstVisible,listen:fn=>{firstReconcile=fn;return()=>{};}}),b=manager({locks,channelFactory});
 const received=[];cleanups.push(a.subscribe(()=>{}),b.subscribe(e=>received.push(e)));await flush();expect(sources).toHaveLength(1);sources[0].readyState=1;sources[0].onopen();
 sources[0].emit('update',{id:'one',topics:['alerts'],alertIds:['private-record-id']});expect(received.at(-1)).toMatchObject({id:'one',topics:['alerts'],alertIds:[]});
 firstVisible=false;firstReconcile();await flush();expect(sources).toHaveLength(2);
});
it('uses fallback status without opening streams when EventSource is unavailable',()=>{
 const events=[];cleanups.push(manager({supported:false}).subscribe(e=>events.push(e)));expect(sources).toHaveLength(0);expect(events).toEqual([{live:false}]);
});
it('maps only relevant monitoring reads to updates',()=>{
 expect(monitoringTopics('/api/v1/alerts?limit=25')).toEqual(['alerts']);expect(monitoringTopics('/api/v1/attendance/pending-count')).toEqual(['attendance']);expect(monitoringTopics('/api/v1/admin/overview')).toEqual([]);expect(monitoringTopics('/api/v1/devices?limit=25')).toEqual(['devices']);
 expect(monitoringTopics('/api/v1/beacons?limit=25')).toEqual(['devices']);expect(monitoringTopics('/api/v1/beacons/gate-registration')).toEqual([]);
});
