import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
const secret='synthetic-monitoring-session-secret-over-32',password='Synthetic-monitoring-password',hash=bcrypt.hashSync(password,4);
let f,db,app,auth,devices,events,oldChild,newChild,otherChild,beacon,parent,teacher;
function matches(row,where={}) {
 return Object.entries(where).every(([key,filter])=>{
  if(filter===undefined)return true;if(key==='AND')return filter.every(q=>matches(row,q));if(key==='OR')return filter.some(q=>matches(row,q));
  let value=row?.[key];
  if(filter===null||typeof filter!=='object'||filter instanceof Date)return value===filter;
  if(filter.path)value=filter.path.reduce((v,k)=>v?.[k],value);
  if(filter.in)return filter.in.includes(value);
  if(Object.hasOwn(filter,'equals'))return value===filter.equals;
  if(filter.contains!==undefined)return String(value).toLowerCase().includes(filter.contains.toLowerCase());
  if(Object.hasOwn(filter,'gte')||Object.hasOwn(filter,'lte'))return value!==null&&value!==undefined&&(filter.gte===undefined||value>=filter.gte)&&(filter.lte===undefined||value<=filter.lte);
  return matches(value,filter);
 });
}
function project(row,select){if(!row)return null;if(!select)return structuredClone(row);return Object.fromEntries(Object.entries(select).map(([k,s])=>[k,s===true?row[k]:Array.isArray(row[k])?row[k].slice(0,s.take??Infinity).map(r=>project(r,s.select)):project(row[k],s.select)]));}
const hydrate=e=>({...e,device:devices.find(d=>d.id===e.deviceId),child:[oldChild,newChild,otherChild].find(c=>c.id===e.childId)??null,beacon:e.beaconId===beacon.id?beacon:null,alerts:e.alerts??[]});
function event(payload={},age=1000,extra={}){return {id:randomUUID(),eventId:randomUUID(),deviceId:devices[0].id,childId:oldChild.id,beaconId:beacon.id,eventType:'GPS_STATUS',receivedAt:new Date(Date.now()-age),observedAt:new Date(Date.now()-age),payload:{gpsStatus:'GPS_NO_FIX',...payload},...extra};}
const http=(path)=>request(app).get(path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const get=path=>http(path).set('Cookie',auth.cookie);
const history=(q='')=>get(`/api/v1/events?management=true&deviceId=${devices[0].id}${q}`);
beforeEach(async()=>{
 f=sessionFixture();f.state.user.passwordHash=hash;
 devices=[{id:randomUUID(),hardwareId:'CG-MONITOR',active:true,lastSeen:new Date(),centerId:'center-a',tokenHash:'synthetic-not-public'},{id:randomUUID(),hardwareId:'FOREIGN-HARDWARE',active:true,lastSeen:null,centerId:'center-b'}];
 oldChild={id:randomUUID(),name:'Previously recorded child',centerId:'center-a'};newChild={id:randomUUID(),name:'Currently assigned child',centerId:'center-a'};otherChild={id:randomUUID(),name:'Foreign private child',centerId:'center-b'};
 beacon={id:randomUUID(),hardwareId:'CG-GATE-01',centerId:'center-a',active:true,kind:'GATE',name:'Gate',location:'Entrance',serviceUuid:randomUUID()};events=[];
 parent={id:randomUUID(),role:'PARENT',username:'parent',active:true,centerId:'center-a',passwordHash:hash};teacher={...parent,id:randomUUID(),role:'TEACHER',username:'teacher'};
 const query=({where,select,take=100,skip=0,orderBy})=>{
  let rows=events.map(hydrate).filter(e=>matches(e,where));
  if(orderBy)rows.sort((a,b)=>{for(const o of orderBy){const [key,option]=Object.entries(o)[0],direction=typeof option==='string'?option:option.sort;if(typeof option==='object'&&option.nulls==='last'&&(a[key]==null||b[key]==null)){if(a[key]==null&&b[key]!=null)return 1;if(b[key]==null&&a[key]!=null)return -1;}const cmp=a[key]<b[key]?-1:a[key]>b[key]?1:0;if(cmp)return direction==='desc'?-cmp:cmp;}return 0;});
  return rows.slice(skip,skip+take).map(e=>project(e,select));
 };
 db={user:{findUnique:vi.fn(async({where})=>[f.state.user,parent,teacher].find(u=>where.id?u.id===where.id:u.username===where.username)||null)},
  device:{findFirst:vi.fn(async({where,select})=>project(devices.find(d=>matches(d,where)),select)),findMany:vi.fn(async({where,take,skip})=>devices.filter(d=>matches(d,where)).slice(skip,skip+take))},
  deviceEvent:{findMany:vi.fn(async q=>query(q)),findFirst:vi.fn(async q=>query({...q,take:1})[0]??null)},
  beacon:{findMany:vi.fn(async()=>[{...beacon}]),findFirst:vi.fn(async()=>null)},
  assignment:{findMany:vi.fn(async()=>[{id:'current-assignment',childId:newChild.id,child:{id:newChild.id,name:newChild.name},startedAt:new Date(),endedAt:null}])},
  $transaction:vi.fn(async()=>{throw Error('No monitoring writes allowed');}),
 };
 db.child={findFirst:vi.fn(async({where,select})=>project([oldChild,newChild,otherChild].find(c=>matches(c,where)),select))};
 db.assignment.findFirst=vi.fn(async({where})=>where.childId===newChild.id?{device:devices[0]}:null);
 db.$queryRaw=vi.fn(async()=>[{installed:false}]);
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',logger:{error:vi.fn()}});
 const r=await request(app).post('/api/v1/auth/login').set('Host','localhost:5174').set('Origin','http://localhost:5174').send({username:'admin',password});expect(r.status).toBe(200);auth={cookie:r.headers['set-cookie'][0].split(';')[0]};
});
it('returns actual bounded monitoring, safe fields and current assignment separately from recorded ownership',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8,deviceToken:'never-return',batteryPercent:80}));
 const r=await get('/api/v1/devices?management=true');expect(r.status).toBe(200);const row=r.body.data[0];expect(row.currentAssignment.child.name).toBe(newChild.name);expect(row.gpsMonitoring.lastValidLocation.recordedChild.name).toBe(oldChild.name);expect(row.gpsMonitoring.lastValidLocation.state).toBe('RECENT');expect(row.batteryPercent).toBeNull();expect(r.headers['cache-control']).toBe('no-store');
 expect(JSON.stringify(r.body)).not.toMatch(/deviceToken|tokenHash|never-return|batteryPercent":80/);
 expect(db.deviceEvent.findMany.mock.calls.map(([q])=>q.take)).toEqual([50,1]);expect(db.beacon.findMany).toHaveBeenCalledTimes(1);expect(db.$transaction).not.toHaveBeenCalled();
});
it('retains the latest valid fix outside the recent-event sample when a newer no-fix report exists',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6,longitude:79},120000));
 for(let i=0;i<55;i++)events.push(event({},1000+i));
 const r=await get('/api/v1/devices?management=true');const gps=r.body.data[0].gpsMonitoring;expect(gps.latestStatus).toBe('GPS_NO_FIX');expect(gps.lastValidLocation.latitude).toBe(6);expect(gps.lastValidLocation.state).toBe('HISTORICAL');expect(gps.lastValidLocation.recordedChild.id).toBe(oldChild.id);
});
it('does not replace a newer observed GPS fix with an older queued fix that arrived later',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6.9,longitude:79.8},1000),event({gpsStatus:'GPS_FIX',latitude:7,longitude:80},100,{observedAt:new Date(Date.now()-60000)}));
 const location=(await get('/api/v1/devices?management=true')).body.data[0].gpsMonitoring.lastValidLocation;
 expect(location.latitude).toBe(6.9);expect(location.longitude).toBe(79.8);
});
it.each([{gpsStatus:'GPS_NO_FIX',latitude:0,longitude:0},{gpsStatus:'GPS_FIX',latitude:6},{gpsStatus:'GPS_FIX',latitude:null,longitude:79},{gpsStatus:'GPS_FIX',latitude:'0',longitude:79},{gpsStatus:'GPS_FIX',latitude:91,longitude:79}])('does not fabricate a valid GPS fix from missing/invalid values %j',async payload=>{
 events.push(event(payload));const r=await get('/api/v1/devices?management=true');expect(r.body.data[0].gpsMonitoring.lastValidLocation).toBeNull();expect(r.body.data[0].latestEvent.payload).not.toHaveProperty('latitude');
});
it('preserves explicitly reported numeric zero coordinates instead of treating zero as missing',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:0,longitude:0}));expect((await get('/api/v1/devices?management=true')).body.data[0].gpsMonitoring.lastValidLocation).toMatchObject({latitude:0,longitude:0});
});
it('excludes future/out-of-window GPS and reports UNKNOWN communication for invalid future timestamps',async()=>{
 devices[0].lastSeen=new Date(Date.now()+60000);events.push(event({gpsStatus:'GPS_FIX',latitude:1,longitude:1},-60000),event({gpsStatus:'GPS_FIX',latitude:2,longitude:2},86401000));
 const r=await get('/api/v1/devices?management=true');expect(r.body.data[0].connectionState).toBe('UNKNOWN');expect(r.body.data[0].gpsMonitoring.lastValidLocation).toBeNull();
});
it('shows an invalid observation time as unknown rather than a current position',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6,longitude:79},1000,{observedAt:new Date(Date.now()+60000)}));
 const gps=(await get('/api/v1/devices?management=true')).body.data[0].gpsMonitoring;expect(gps.lastValidLocation.state).toBe('UNKNOWN_TIME');expect(gps.lastValidLocation.observedAt).toBeNull();
});
it('does not label an inactive registration or missing communication as online',async()=>{
 devices[0].lastSeen=null;expect((await get('/api/v1/devices?management=true')).body.data[0].connectionState).toBe('UNKNOWN');
 devices[0].active=false;expect((await get('/api/v1/devices?management=true')).body.data[0].connectionState).toBe('INACTIVE');
});
it('bounds each page, shares beacon configuration once and rejects excessive monitoring page sizes',async()=>{
 for(let i=0;i<4;i++)devices.push({...devices[0],id:randomUUID(),hardwareId:'extra-'+i});
 expect((await get('/api/v1/devices?management=true&limit=25')).body.data).toHaveLength(5);expect(db.beacon.findMany).toHaveBeenCalledTimes(1);expect(db.deviceEvent.findMany).toHaveBeenCalledTimes(10);
 expect((await get('/api/v1/devices?management=true&limit=26')).status).toBe(422);
});
it('keeps rotated danger-zone identities and newer signal-loss records from implying fresh proximity',async()=>{
 beacon.kind='DANGER_ZONE';const previousUuid=randomUUID();
 events.push(event({proximity:'NEAR',rssi:-30,beaconUuid:previousUuid},1000,{eventType:'BLE_PROXIMITY'}),event({proximity:'FAR',rssi:-90,beaconUuid:beacon.serviceUuid},2000,{eventType:'BLE_PROXIMITY'}));
 expect((await get('/api/v1/devices?management=true')).body.data[0].beaconStates[0].proximity).toBe('FAR');
 events.push(event({beaconUuid:beacon.serviceUuid},500,{eventType:'BEACON_SIGNAL_LOST'}));
 expect((await get('/api/v1/devices?management=true')).body.data[0].beaconStates[0].proximity).toBe('UNKNOWN');
});
it('enforces device/child center isolation and never falls back to the newly assigned child',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6,longitude:79},1000,{childId:otherChild.id}),event({gpsStatus:'GPS_FIX',latitude:7,longitude:80},500,{deviceId:devices[1].id,childId:otherChild.id}));
 const r=await history();expect(r.status).toBe(200);expect(r.body.data.events).toHaveLength(1);expect(r.body.data.events[0].attribution).toBe('CHILD_UNAVAILABLE');expect(r.body.data.events[0].recordedChild).toBeNull();expect(JSON.stringify(r.body)).not.toContain(otherChild.name);expect(JSON.stringify(r.body)).not.toContain(newChild.name);
 expect((await get(`/api/v1/events?management=true&deviceId=${devices[1].id}`)).status).toBe(404);expect((await get(`/api/v1/devices/${devices[1].id}?management=true`)).status).toBe(404);
});
it('provides deterministic bounded history pages using a frozen cutoff and a recorded-type filter',async()=>{
 for(let i=0;i<4;i++)events.push(event({},1000+i*1000,{eventType:i===0?'ACTIVITY_SUMMARY':'GPS_STATUS'}));
 const first=await history('&limit=2');expect(first.status).toBe(200);expect(first.body.data.hasMore).toBe(true);expect(first.body.data.events).toHaveLength(2);
 events.push(event({},-1000));
 const second=await history('&limit=2&offset=2&until='+encodeURIComponent(first.body.data.until));expect(second.body.data.events).toHaveLength(2);expect(new Set([...first.body.data.events,...second.body.data.events].map(e=>e.id)).size).toBe(4);
 expect((await history('&eventType=ACTIVITY_SUMMARY')).body.data.events).toHaveLength(1);
 const [q]=db.deviceEvent.findMany.mock.calls[0];expect(q.take).toBe(3);expect(q.orderBy).toEqual([{receivedAt:'desc'},{id:'desc'}]);
});
it('represents unassigned records, stored sensor types and actual alerts without inventing an emergency',async()=>{
 events.push(event({sensorStatus:'PARTIAL',movementIntensity:0.2},1000,{eventType:'ACTIVITY_SUMMARY',childId:null,alerts:[]}),event({proximity:'FAR',rssi:-90},2000,{eventType:'BLE_PROXIMITY',alerts:[{id:'stored-alert',kind:'BEACON_SIGNAL_LOST',createdAt:new Date()}]}));
 const r=await history();expect(r.body.data.events[0].attribution).toBe('UNASSIGNED');expect(r.body.data.events[0].recordedChild).toBeNull();expect(r.body.data.events[0].alerts).toEqual([]);expect(r.body.data.events[1].alerts[0].kind).toBe('BEACON_SIGNAL_LOST');
});
it.each(['deviceId=invalid','limit=51','offset=-1','eventType=EMERGENCY','centerId=center-b','until=2999-01-01T00%3A00%3A00.000Z'])('rejects invalid or injected monitoring query %s',async q=>{
 const path=q.startsWith('deviceId=')?'/api/v1/events?management=true&'+q:`/api/v1/events?management=true&deviceId=${devices[0].id}&${q}`;expect((await get(path)).status).toBe(422);
});
it.each(['PARENT','TEACHER'])('rejects %s monitoring while preserving existing mobile JWT authentication',async role=>{
 const u=role==='PARENT'?parent:teacher;const bearer='Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 expect((await request(app).get(`/api/v1/events?management=true&deviceId=${devices[0].id}`).set('Authorization',bearer)).status).toBe(403);expect((await request(app).get('/api/v1/devices?management=true').set('Authorization',bearer)).status).toBe(403);expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer)).status).toBe(200);
});
it('requires an Admin cookie and never lets repeated background reads extend genuine inactivity',async()=>{
 expect((await http('/api/v1/devices?management=true')).status).toBe(401);const session=structuredClone(f.state.sessions[0]);
 for(let i=0;i<19;i++){f.tick(15000);expect((await history()).status).toBe(200);}
 expect(f.updates).toBe(0);expect(f.state.sessions[0]).toEqual(session);f.tick(15000);expect((await history()).status).toBe(401);expect(db.$transaction).not.toHaveBeenCalled();
});

it('cookie Admin reads only the selected center child and current wearable, never its prior child GPS',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6,longitude:79},1000),event({gpsStatus:'GPS_FIX',latitude:7,longitude:80},500,{childId:newChild.id}));
 const before=JSON.stringify(f.state.sessions);
 const r=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(r.status).toBe(200);expect(r.body.data.child.id).toBe(newChild.id);expect(r.body.data.device.hardwareId).toBe(devices[0].hardwareId);
 expect(r.body.data.gpsMonitoring.lastValidLocation.latitude).toBe(7);expect(r.body.data.gpsMonitoring.lastValidLocation.recordedChildId).toBe(newChild.id);
 expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|synthetic-not-public|latestTelemetry|beaconStates/);
 expect(r.headers['cache-control']).toBe('no-store');expect(JSON.stringify(f.state.sessions)).toBe(before);expect(db.$transaction).not.toHaveBeenCalled();
});
it('Admin child location rejects foreign children, no session and mobile roles without weakening existing JWT APIs',async()=>{
 expect((await get(`/api/v1/admin/children/${otherChild.id}/location`)).status).toBe(404);
 expect((await http(`/api/v1/admin/children/${newChild.id}/location`)).status).toBe(401);
 for(const user of [parent,teacher]){
  const token=jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
  expect((await http(`/api/v1/admin/children/${newChild.id}/location`).set('Authorization','Bearer '+token)).status).toBe(403);
 }
 expect((await get('/api/v1/admin/children/not-a-uuid/location')).status).toBe(422);
});
it('Admin location reports no assignment and never borrows another child fix after reassignment',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:6,longitude:79}));
 const current=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(current.body.data.gpsMonitoring.lastValidLocation).toBeNull();
 db.assignment.findFirst.mockResolvedValueOnce(null);
 const unassigned=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(unassigned.body.data.device).toBeNull();expect(unassigned.body.data.gpsMonitoring.lastValidLocation).toBeNull();
});
it('Admin retains historical current-child GPS across no-fix, offline and the 24-hour window without synthetic fixes',async()=>{
 events.push(event({gpsStatus:'GPS_FIX',latitude:0,longitude:0},2*86400000,{childId:newChild.id}));
 const old=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(old.body.data.gpsMonitoring.lastValidLocation).toMatchObject({latitude:0,longitude:0,state:'HISTORICAL',recordedChildId:newChild.id});
 events.push(event({gpsStatus:'GPS_NO_FIX'},100,{childId:newChild.id}));
 const noFix=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(noFix.body.data.gpsMonitoring.latestStatus).toBe('GPS_NO_FIX');expect(noFix.body.data.gpsMonitoring.lastValidLocation.state).toBe('HISTORICAL');
 devices[0].lastSeen=new Date(Date.now()-300000);
 events.push(event({gpsStatus:'GPS_FIX',latitude:6.8,longitude:79.9},0,{childId:newChild.id}));
 const offline=await get(`/api/v1/admin/children/${newChild.id}/location`);
 expect(offline.body.data.device.connectionState).toBe('OFFLINE');expect(offline.body.data.gpsMonitoring.lastValidLocation.state).toBe('HISTORICAL');
});
