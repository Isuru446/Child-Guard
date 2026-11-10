import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp, tokenHash } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { managementCommunicationState } from '../src/wearable-management.js';
import { zoneSessionKey } from '../src/zone-monitoring.js';
const password='Synthetic-wearable-password',hash=bcrypt.hashSync(password,4),secret='synthetic-wearable-session-secret-over-32';
let f,app,db,a,b,foreign,child,otherChild,foreignChild,parent,teacher,auth,privateToken,newToken,gate,expire,auditFailure,levels;
const state=()=>f.state.domain[0];
function matches(row,where={}) {
 return Object.entries(where).every(([k,v])=>{
  if(v===undefined)return true;if(k==='OR')return v.some(part=>matches(row,part));if(k==='AND')return v.every(part=>matches(row,part));
  if(k==='childId_day'||k==='userId_childId')return matches(row,v);
  const value=row?.[k];
  if(v===null||typeof v!=='object'||v instanceof Date)return v instanceof Date?+value===+v:value===v;
  if(v.in)return v.in.includes(value);if(v.some)return value?.some(r=>matches(r,v.some));if(v.none)return !value?.some(r=>matches(r,v.none));
  if(Object.hasOwn(v,'contains'))return String(value||'').toLowerCase().includes(v.contains.toLowerCase());
  if(Object.hasOwn(v,'equals'))return value===v.equals;
  return matches(value,v);
 });
}
function project(row,select){if(!row)return null;if(!select)return structuredClone(row);return Object.fromEntries(Object.entries(select).map(([k,s])=>[k,s===true?row[k]:Array.isArray(row[k])?row[k].filter(r=>matches(r,s.where)).map(r=>project(r,s.select)):project(row[k],s.select)]));}
const allUsers=()=>[f.state.user,...state().user];
function hydrate(model,r){
 if(!r)return null;const row={...r};
 if(model==='device')row.assignments=state().assignment.filter(a=>a.deviceId===r.id);
 if(model==='assignment'){row.child=state().child.find(c=>c.id===r.childId);row.device=state().device.find(d=>d.id===r.deviceId);}
 if(model==='child'){row.guardians=state().guardian.filter(g=>g.childId===r.id).map(g=>({...g,user:allUsers().find(u=>u.id===g.userId)}));row.assignments=state().assignment.filter(a=>a.childId===r.id).map(a=>hydrate('assignment',a));row.enrollmentRequests=[];}
 return row;
}
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const get=path=>http('get',path).set('Cookie',auth.cookie);
const write=(method,path,body)=>http(method,path).set('Cookie',auth.cookie).set('X-CSRF-Token',auth.csrf).send(body);
const enroll=(body={})=>write('post','/api/v1/admin/devices',{hardwareId:'CG-NEW-BELT',deviceToken:newToken,...body});
const assign=(deviceId=a.id,childId=child.id)=>write('post',`/api/v1/admin/devices/${deviceId}/assignment`,{childId,assignmentAcknowledged:true});
const current=(deviceId=a.id)=>state().assignment.find(r=>r.deviceId===deviceId&&!r.endedAt);
const unassign=(deviceId=a.id,id=current(deviceId)?.id)=>write('post',`/api/v1/admin/devices/${deviceId}/unassign`,{expectedAssignmentId:id,unassignAcknowledged:true});
const transfer=(id,childId,previous)=>write('post',`/api/v1/admin/devices/${id}/transfer`,{childId,expectedAssignmentId:previous,transferAcknowledged:true});
beforeEach(async()=>{
 f=sessionFixture();f.state.user.passwordHash=hash;expire=null;auditFailure=false;levels=[];privateToken=randomBytes(32).toString('hex');newToken=randomBytes(32).toString('hex');
 const belt=(hardwareId,centerId='center-a',credential=randomBytes(32).toString('hex'))=>({id:randomUUID(),hardwareId,centerId,tokenHash:tokenHash(credential),active:true,lastSeen:null});
 a=belt('CG-BELT-A','center-a',privateToken);b=belt('CG-BELT-B');foreign=belt('CG-FOREIGN','center-b');
 child={id:randomUUID(),name:'Verified child',centerId:'center-a',dateOfBirth:null,groupName:null};otherChild={...child,id:randomUUID(),name:'Other verified child'};foreignChild={...child,id:randomUUID(),name:'Foreign child',centerId:'center-b'};
 parent={id:randomUUID(),username:'synthetic-parent',passwordHash:hash,role:'PARENT',active:true,centerId:'center-a'};teacher={...parent,id:randomUUID(),username:'synthetic-teacher',role:'TEACHER'};
 gate={id:randomUUID(),hardwareId:'CG-GATE-01',serviceUuid:'7b700001-24a6-4a25-9d3b-21c547a10001',centerId:'center-a',kind:'GATE',active:true,name:'',location:'',entryRssi:-63,exitRssi:-69};
 f.state.domain.push({user:[parent,teacher],device:[a,b,foreign],child:[child,otherChild,foreignChild],guardian:[{userId:parent.id,childId:child.id},{userId:parent.id,childId:otherChild.id}],assignment:[],beacon:[gate],deviceEvent:[],attendance:[],observation:[],auditLog:[],alert:[],confirmation:[]});
 db={};for(const model of Object.keys(state())){
  const rows=()=>model==='user'?allUsers():state()[model];
  const find=where=>rows().map(r=>hydrate(model,r)).find(r=>matches(r,where));
  db[model]={findUnique:vi.fn(async({where,select})=>project(find(where),select)),findFirst:vi.fn(async({where,select})=>project(find(where),select)),findMany:vi.fn(async({where,select,take=100,skip=0}={})=>rows().map(r=>hydrate(model,r)).filter(r=>matches(r,where)).slice(skip,skip+take).map(r=>project(r,select))),count:vi.fn(async({where}={})=>rows().map(r=>hydrate(model,r)).filter(r=>matches(r,where)).length),
   create:vi.fn(async({data,select})=>{
    if(model==='auditLog'&&auditFailure)throw Error('private-audit-engine-error');
    if(model==='assignment'&&state().assignment.some(a=>!a.endedAt&&(a.deviceId===data.deviceId||a.childId===data.childId)))throw Object.assign(Error('private-index-error'),{code:'P2002'});
    const row={id:randomUUID(),...(model==='assignment'?{endedAt:null}:{}),...(model==='device'?{lastSeen:null}:{}),...data};state()[model].push(row);
    if((expire==='register'&&model==='device')||(expire==='assign'&&model==='assignment'))f.tick(300000);
    return project(hydrate(model,row),select);
   }),update:vi.fn(async({where,data,select})=>{
    const row=rows().find(r=>matches(r,where));Object.assign(row,data);
    if((expire==='status'&&model==='device')||(['unassign','transfer'].includes(expire)&&model==='assignment'))f.tick(300000);
    return project(hydrate(model,row),select);
   }),
  };
  db[model].upsert=vi.fn(async({where,create,update})=>find(where)?db[model].update({where,data:update}):db[model].create({data:create}));
 }
 db.$queryRaw=vi.fn(async()=>[{now:new Date(f.clock)}]);
 db.$transaction=vi.fn(async work=>{const saved=structuredClone(f.state.domain);try{return await work(db);}catch(e){f.state.domain.splice(0,f.state.domain.length,...saved);throw e;}});
 const original=f.repository.forCredential;f.repository.forCredential=(key,work,level)=>original(key,tx=>{levels.push(level);tx.db=db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',logger:{error:vi.fn()}});
 const r=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(r.status).toBe(200);auth={cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.data.csrfToken};
});
it('registers only in the Admin center, stores the existing SHA-256 format and returns no credential',async()=>{
 const r=await enroll();expect(r.status).toBe(201);expect(r.body.data).toMatchObject({hardwareId:'CG-NEW-BELT',active:true,lastSeen:null});
 expect(r.body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);expect(r.body.data.centerId).toBe(f.state.user.centerId);
 expect(state().device.at(-1)).toMatchObject({centerId:'center-a',tokenHash:tokenHash(newToken)});expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|deviceToken/);expect(JSON.stringify(r.body)).not.toContain(newToken);expect(state().assignment).toEqual([]);
 expect(state().auditLog).toContainEqual(expect.objectContaining({userId:f.state.user.id,resourceId:r.body.data.id,action:'DEVICE_REGISTERED'}));expect(db.$transaction).not.toHaveBeenCalled();expect(levels).toContain('Serializable');
});
it('rejects existing hardware and reused credentials across centers without takeover',async()=>{
 const before=structuredClone(state().device);
 expect((await enroll({hardwareId:a.hardwareId})).status).toBe(409);expect((await enroll({hardwareId:foreign.hardwareId})).status).toBe(409);expect((await enroll({deviceToken:privateToken})).status).toBe(409);expect(state().device).toEqual(before);
});
it('binds the privately supplied token to the returned device UUID/public ID and rejects it while deactivated',async()=>{
 const created=await enroll();expect(created.status).toBe(201);
 const target=created.body.data,gateRead=token=>request(app).get(`/api/gate/state?deviceId=${target.hardwareId}&gateId=${gate.hardwareId}`).set('X-Device-Token',token);
 expect((await gateRead(newToken)).status).toBe(200);
 expect((await gateRead(privateToken)).status).toBe(401);
 expect((await write('patch',`/api/v1/admin/devices/${target.id}/status`,{active:false,expectedActive:true})).status).toBe(200);
 expect((await gateRead(newToken)).status).toBe(401);
 expect((await write('patch',`/api/v1/admin/devices/${target.id}/status`,{active:true,expectedActive:false})).status).toBe(200);
 expect((await gateRead(newToken)).status).toBe(200);
 expect(state().device.find(d=>d.id===target.id).tokenHash).toBe(tokenHash(newToken));
});
it('serializes concurrent duplicate hardware registrations',async()=>{const results=await Promise.all([enroll(),enroll()]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(state().device.filter(d=>d.hardwareId==='CG-NEW-BELT')).toHaveLength(1);});
it.each([{hardwareId:''},{hardwareId:'AA:BB:CC'},{hardwareId:'has space'},{hardwareId:'x'.repeat(151)},{deviceToken:'short'},{deviceToken:'x'.repeat(31)+'\n'},{centerId:'center-b'},{tokenHash:'injected'},{active:false}])('validates registration and refuses injected fields %j',async body=>{expect((await enroll(body)).status).toBe(422);expect(db.device.create).not.toHaveBeenCalled();});
it('reuses existing inventory/detail routes with safe assignment metadata and center filters',async()=>{
 await assign();const r=await get('/api/v1/devices?management=true&search=CG-BELT-A&assignment=ASSIGNED&state=ACTIVE');expect(r.status).toBe(200);expect(r.body.data).toHaveLength(1);expect(r.body.data[0].currentAssignment.child.name).toBe(child.name);expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|deviceToken/);
 const detail=await get(`/api/v1/devices/${a.id}?management=true`);expect(detail.status).toBe(200);expect(detail.body.data.assignmentHistory).toHaveLength(1);expect(detail.body.data.batteryPercent).toBeNull();
 expect(detail.body.data).toMatchObject({id:a.id,hardwareId:a.hardwareId,centerId:f.state.user.centerId,active:true});expect(JSON.stringify(detail.body)).not.toMatch(/tokenHash|deviceToken/);expect(JSON.stringify(detail.body)).not.toContain(privateToken);
 expect((await get(`/api/v1/devices/${foreign.id}?management=true`)).status).toBe(404);expect((await get('/api/v1/devices?management=true&centerId=center-b')).status).toBe(422);
 expect((await get(`/api/v1/admin/children/${child.id}`)).body.data.assignments[0].device.hardwareId).toBe(a.hardwareId);
});
it('assigns only an active, free same-center belt to a child with a verified active Parent',async()=>{
 const r=await assign();expect(r.status).toBe(201);expect(current().childId).toBe(child.id);expect(state().auditLog.at(-1).action).toBe('WEARABLE_ASSIGNED:'+child.id);
 expect((await assign(b.id,foreignChild.id)).status).toBe(404);expect((await assign(foreign.id,otherChild.id)).status).toBe(404);
 state().device.find(d=>d.id===b.id).active=false;expect((await assign(b.id,otherChild.id)).status).toBe(404);
 state().user[0].active=false;expect((await assign(a.id,otherChild.id)).status).toBe(404);
});
it('rejects conflicting, duplicate and concurrent assignments',async()=>{
 const results=await Promise.all([assign(),assign(b.id)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
 const assigned=current(a.id)||current(b.id);expect((await assign(assigned.deviceId,otherChild.id)).status).toBe(409);expect(state().assignment).toHaveLength(1);
});
it('unassigns only the exact current assignment and preserves all event/attendance/history records',async()=>{
 await assign();state().deviceEvent.push({id:'past-location',childId:child.id});state().attendance.push({id:'past-attendance',childId:child.id});const history=structuredClone({events:state().deviceEvent,attendance:state().attendance});const previous=current().id;
 expect((await unassign(a.id,randomUUID())).status).toBe(409);const r=await unassign();expect(r.status).toBe(200);expect(current()).toBeUndefined();expect(state().assignment).toHaveLength(1);expect(state().assignment[0].endedAt).toBeInstanceOf(Date);expect((await unassign(a.id,previous)).status).toBe(409);expect({events:state().deviceEvent,attendance:state().attendance}).toEqual(history);
});
it('transfers a currently assigned belt to a free child with the original API contract',async()=>{
 await assign();const previous=current().id;expect((await transfer(a.id,otherChild.id,previous)).status).toBe(200);expect(current().childId).toBe(otherChild.id);expect(state().assignment).toHaveLength(2);expect(state().assignment[0].endedAt).toBeInstanceOf(Date);expect((await transfer(a.id,child.id,previous)).status).toBe(409);
});
it('refuses an unrelated assignment precondition, a same-child move and a self-replacement without ending history',async()=>{
 await assign();const previous=current().id;
 const before=structuredClone(state().assignment);
 expect((await transfer(a.id,child.id,previous)).status).toBe(409);
 expect((await transfer(b.id,otherChild.id,previous)).status).toBe(409);
 expect(state().assignment).toEqual(before);
});
it('rolls back an ended source assignment when replacement creation or audit fails',async()=>{
 await assign();const previous=current().id,before=structuredClone(state());
 const create=db.assignment.create.getMockImplementation();
 db.assignment.create.mockRejectedValue(Object.assign(Error('private-index-error'),{code:'P2002'}));
 const rejected=await transfer(b.id,child.id,previous);
 // Exhausted serialization/unique retries use the existing safe 503 response.
 expect(rejected.status).toBe(503);expect(JSON.stringify(rejected.body)).not.toContain('private-index');expect(state()).toEqual(before);
 db.assignment.create.mockImplementation(create);
 auditFailure=true;expect((await transfer(b.id,child.id,previous)).status).toBe(503);expect(state()).toEqual(before);
});
it('rejects inactive replacements and inactive, foreign-center or Teacher-only guardian eligibility',async()=>{
 await assign();const previous=current().id;
 state().device.find(d=>d.id===b.id).active=false;
 expect((await transfer(b.id,child.id,previous)).status).toBe(404);
 for(const change of [{active:false},{role:'TEACHER'},{centerId:'center-b'}]){
  Object.assign(state().user[0],{active:true,role:'PARENT',centerId:'center-a'},change);
  expect((await transfer(a.id,otherChild.id,previous)).status).toBe(404);
 }
 expect(current().id).toBe(previous);expect(state().assignment).toHaveLength(1);
});
it('commits one concurrent move, rejects its replay and preserves device identity and previous monitoring records',async()=>{
 await assign();const previous=current().id;
 state().deviceEvent.push({id:'historical-event',deviceId:a.id,childId:child.id});state().attendance.push({id:'historical-present',childId:child.id,status:'PRESENT'});
 const identity=structuredClone(state().device),history=structuredClone({events:state().deviceEvent,attendance:state().attendance});
 const results=await Promise.all([transfer(a.id,otherChild.id,previous),transfer(a.id,otherChild.id,previous)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect((await transfer(a.id,otherChild.id,previous)).status).toBe(409);
 expect(state().assignment).toHaveLength(2);expect(state().assignment.filter(a=>!a.endedAt)).toHaveLength(1);
 expect(state().device).toEqual(identity);expect({events:state().deviceEvent,attendance:state().attendance}).toEqual(history);
 expect(state().auditLog.filter(a=>a.action.startsWith('DEVICE_TRANSFERRED:'))).toHaveLength(1);
 const context={device:a,assignment:{id:previous,childId:child.id},attendance:history.attendance[0],confirmation:{id:'confirmation',userId:teacher.id,confirmedAt:new Date()},boot:'same-boot'};
 expect(zoneSessionKey({...context,assignment:current()})).not.toBe(zoneSessionKey(context));
});
it('replaces a child’s belt using a free belt and rejects an implicit two-belt swap',async()=>{
 await assign();const previous=current().id;expect((await transfer(b.id,child.id,previous)).status).toBe(200);expect(current(a.id)).toBeUndefined();expect(current(b.id).childId).toBe(child.id);
 await assign(a.id,otherChild.id);expect((await transfer(a.id,child.id,current(a.id).id)).status).toBe(409);
});
it('rejects foreign transfers and unassignments even with manipulated valid IDs',async()=>{
 await assign();const previous=current().id;
 expect((await transfer(foreign.id,otherChild.id,previous)).status).toBe(404);expect((await transfer(a.id,foreignChild.id,previous)).status).toBe(404);expect((await unassign(foreign.id,previous)).status).toBe(404);
});
it('protects status changes against stale edits and refuses deactivation of an assigned belt',async()=>{
 const status=body=>write('patch',`/api/v1/admin/devices/${a.id}/status`,body);
 await assign();expect((await status({active:false,expectedActive:true})).status).toBe(409);await unassign();expect((await status({active:false,expectedActive:true})).status).toBe(200);expect((await status({active:true,expectedActive:true})).status).toBe(409);expect((await status({active:true,expectedActive:false})).status).toBe(200);
});
it('does not permit metadata edits to replace hardware identity, credentials or center',async()=>{
 for(const extra of [{hardwareId:'TAKEN'},{tokenHash:'injected'},{deviceToken:newToken},{centerId:'center-b'}])expect((await write('patch',`/api/v1/admin/devices/${a.id}/status`,{active:false,expectedActive:true,...extra})).status).toBe(422);
 expect(db.device.update).not.toHaveBeenCalled();
});
it('derives communication freshness conservatively without invented online or battery data',()=>{
 const now=Date.now();
 for(const [lastSeen,result] of [[null,'UNKNOWN'],['invalid','UNKNOWN'],[new Date(now+1000),'UNKNOWN'],[new Date(now-1000),'ONLINE'],[new Date(now-61000),'STALE'],[new Date(now-300001),'OFFLINE']])expect(managementCommunicationState({active:true,lastSeen},now)).toBe(result);
 expect(managementCommunicationState({active:false,lastSeen:new Date(now)},now)).toBe('INACTIVE');
});
it.each(['register','assign','unassign','transfer','status'])('rolls back %s on session expiry during the write',async kind=>{
 if(['unassign','transfer'].includes(kind))await assign();const before=structuredClone(state());expire=kind;
 const r=kind==='register'?await enroll():kind==='assign'?await assign():kind==='unassign'?await unassign():kind==='transfer'?await transfer(a.id,otherChild.id,current().id):await write('patch',`/api/v1/admin/devices/${a.id}/status`,{active:false,expectedActive:true});
 expect(r.status).toBe(401);expect(state()).toEqual(before);
});
it('rolls back on auditing or uniqueness failure without leaking engine details',async()=>{
 auditFailure=true;const r=await enroll();expect(r.status).toBe(503);expect(state().device).toHaveLength(3);expect(JSON.stringify(r.body)).not.toContain('private-audit');
 auditFailure=false;db.device.create.mockRejectedValue(Object.assign(Error('private-index-message'),{code:'P2002'}));const duplicate=await enroll();expect(duplicate.status).toBe(409);expect(JSON.stringify(duplicate.body)).not.toContain('private-index');
});
it('requires cookie, Origin, CSRF, UUIDs and explicit assignment acknowledgement',async()=>{
 expect((await http('post','/api/v1/admin/devices').send({})).status).toBe(401);expect((await http('post','/api/v1/admin/devices').set('Cookie',auth.cookie).send({})).status).toBe(403);expect((await enroll().set('Origin','http://evil.invalid')).status).toBe(403);
 expect((await write('post',`/api/v1/admin/devices/${a.id}/assignment`,{childId:child.id})).status).toBe(422);expect((await assign('not-uuid')).status).toBe(422);
});
it.each(['PARENT','TEACHER'])('preserves %s JWT login but rejects Admin device management',async role=>{
 const u=role==='PARENT'?parent:teacher;const r=await request(app).post('/api/v1/auth/login').send({username:u.username,password});expect(r.status).toBe(200);const bearer='Bearer '+r.body.data.token;
 expect((await request(app).get('/api/v1/devices?management=true').set('Authorization',bearer)).status).toBe(403);
 for(const [method,path,body] of [['post','/api/v1/admin/devices',{}],['post',`/api/v1/admin/devices/${a.id}/assignment`,{childId:child.id,assignmentAcknowledged:true}],['post',`/api/v1/admin/devices/${a.id}/unassign`,{}],['post',`/api/v1/admin/devices/${a.id}/transfer`,{}],['patch',`/api/v1/admin/devices/${a.id}/status`,{}]])expect((await request(app)[method](path).set('Authorization',bearer).send(body)).status).toBe(403);
 if(role==='TEACHER')expect((await request(app).get('/api/v1/devices?limit=25').set('Authorization',bearer)).status).toBe(200);
});
it('preserves firmware token authentication, arrival attendance, batch BLE and unassignment event ownership',async()=>{
 await assign();const event={deviceId:a.hardwareId,eventId:'synthetic-arrival',eventType:'CHILD_NEAR_GATE',gateId:gate.hardwareId,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1,rssi:-40};
 expect((await request(app).post('/api/events').set('X-Device-Token',newToken).send(event)).status).toBe(401);
 expect((await request(app).post('/api/events').set('X-Device-Token',privateToken).send(event)).status).toBe(201);expect(state().attendance[0].status).toBe('CHECKIN_PENDING');expect(state().deviceEvent[0].childId).toBe(child.id);
 const gateState=()=>request(app).get(`/api/gate/state?deviceId=${a.hardwareId}&gateId=${gate.hardwareId}`).set('X-Device-Token',privateToken);
 expect((await gateState()).body.attendanceStatus).toBe('CHECKIN_PENDING');
 const ble={deviceId:a.hardwareId,eventId:'synthetic-ble',eventType:'BLE_PROXIMITY',beaconId:gate.hardwareId,beaconUuid:gate.serviceUuid,gpsStatus:'GPS_NO_FIX',deviceUptimeMs:2,proximity:'FAR',rssi:-90,queueAgeMs:0};
 expect((await request(app).post('/api/events/batch').set('X-Device-Token',privateToken).send({deviceId:a.hardwareId,events:[ble]})).status).toBe(200);
 await unassign();expect((await request(app).post('/api/events').set('X-Device-Token',privateToken).send({...event,eventId:'synthetic-unassigned-event',deviceUptimeMs:3})).status).toBe(201);expect(state().deviceEvent.at(-1).childId).toBeUndefined();expect(state().deviceEvent[0].childId).toBe(child.id);expect(state().attendance).toHaveLength(1);
 await write('patch',`/api/v1/admin/devices/${a.id}/status`,{active:false,expectedActive:true});expect((await gateState()).status).toBe(401);
});
