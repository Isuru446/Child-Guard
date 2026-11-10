import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { attendanceDay } from '../src/events.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { attendanceMemory,instrumentAttendanceMemory } from './helpers/attendance-memory.js';
import { pickupMemory } from './helpers/pickup-memory.js';
const secret='synthetic-pickup-tests-secret-at-least-32';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
let f,m,p,app;
const auth=u=>'Bearer '+jwt.sign({},secret,{subject:u.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
const call=(method,path,body={},user=m.parent)=>request(app)[method]('/api/v1/mobile/'+path).set('Authorization',auth(user)).send(body);
const photo=(user=m.parent,child=m.child,bytes=png,mime='image/png')=>request(app).post('/api/v1/mobile/pickups/photos?childId='+child.id).set('Authorization',auth(user)).set('Content-Type',mime).send(bytes);
const personBody=id=>({childId:m.child.id,fullName:'Synthetic Pickup Person',address:'10 Synthetic Road, Colombo',phone:'077 123 4567',relationship:'Grandparent',photoId:id});
async function person(){const image=await photo();expect(image.status).toBe(201);const r=await call('post','pickups/people',personBody(image.body.data.id));expect(r.status).toBe(201);return r.body.data;}
async function issued(){const who=await person();const r=await call('post','pickups/requests',{childId:m.child.id,personId:who.id});expect(r.status).toBe(201);return r.body.data;}
const act=(id,action,body={},user=m.teacher)=>call('post',`pickups/requests/${id}/${action}`,body,user);
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'unused-synthetic-hash',tokenHash:'unused'});p=pickupMemory(m,f,vi);
 vi.spyOn(Date,'now').mockImplementation(()=>f.clock);
 m.data().attendance.push({id:randomUUID(),childId:m.child.id,day:attendanceDay(new Date(f.clock)),status:'PRESENT'});m.data().confirmation.push({attendanceId:m.data().attendance[0].id,userId:m.teacher.id,confirmedAt:new Date(f.clock-1000)});
 app=createApp({db:m.db,jwtSecret:secret,registrationEnabled:false,logger:{error:vi.fn()}});
});
afterEach(()=>vi.restoreAllMocks());
it('stages only additive pickup tables and restricts live deployment to V2',()=>{
 const sql=readFileSync(new URL('../prisma/migrations/202610260001_authorized_pickup/migration.sql',import.meta.url),'utf8');
 expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE FROM|UPDATE "(?:Child|Guardian|Attendance|User)")\b/i);expect(sql.match(/CREATE TABLE/g)).toHaveLength(3);expect(sql).toContain("current_database() <> 'childguard_v2'");expect(sql).toContain('PickupRequest_one_completion');expect(sql).toContain('PickupRequest_one_pending');
});
it('fails closed before deployment without blocking other mobile endpoints',async()=>{
 p.uninstall();expect((await call('get','pickups/requests')).body.error.code).toBe('PICKUP_NOT_INSTALLED');expect((await call('get','children')).status).toBe(200);
 expect((await request(app).get('/api/v1/mobile/pickups/requests')).status).toBe(401);
 m.db.$queryRaw.mockRejectedValueOnce(Error('synthetic database unavailable'));
 expect((await call('get','pickups/requests')).body.error.code).toBe('PICKUP_UNAVAILABLE');
});
it('persists a separate pickup person, private photo, edits and historical deactivation without Guardian changes',async()=>{
 const guardians=structuredClone(m.data().guardian),who=await person();expect(m.data().authorizedPickupPerson[0].fullName).toBe(who.fullName);expect(m.data().pickupPhoto[0].bytes).toEqual(png);
 const r=await call('get',`pickups/people?childId=${m.child.id}`);expect(r.body.data[0].photoId).toBe(who.photoId);expect(JSON.stringify(r.body)).not.toContain('bytes');
 expect((await call('patch','pickups/people/'+who.id,{...personBody(who.photoId),fullName:'Updated pickup'})).status).toBe(200);
 expect((await call('post',`pickups/people/${who.id}/deactivate`)).status).toBe(200);expect(m.data().authorizedPickupPerson[0].active).toBe(false);expect(m.data().guardian).toEqual(guardians);
});
it('denies unrelated Parent, Teacher writes and foreign photos even with known IDs',async()=>{
 const who=await person();expect((await photo(m.teacher)).status).toBe(403);expect((await photo(m.parent,m.unrecorded)).status).toBe(404);
 expect((await call('post','pickups/people',personBody(who.photoId),m.teacher)).status).toBe(403);
 expect((await call('post','pickups/people',{...personBody(who.photoId),childId:m.unrecorded.id})).status).toBe(404);
 expect((await call('get','pickups/photos/'+who.photoId,{},m.otherTeacher)).status).toBe(404);
 const read=await call('get','pickups/photos/'+who.photoId,{},m.teacher);expect(read.status).toBe(200);expect(read.headers['cache-control']).toBe('no-store');expect(read.headers['content-type']).toContain('image/png');
});
it('rejects unsupported, mismatched and oversized photos plus injected person fields',async()=>{
 expect((await photo(m.parent,m.child,Buffer.from('not an image'),'image/svg+xml')).status).toBe(422);
 expect((await photo(m.parent,m.child,png,'image/jpeg')).status).toBe(422);
 expect((await photo(m.parent,m.child,Buffer.alloc(2*1024*1024+1))).status).toBe(413);
 const who=await person();expect((await call('post','pickups/people',{...personBody(who.photoId),userId:m.teacher.id})).status).toBe(422);
 expect((await call('post','pickups/people',{...personBody(who.photoId),phone:'letters only'})).status).toBe(422);
});
it('issues a six-digit backend code once with bound hashes, real message and immutable person/photo snapshot',async()=>{
 const result=await issued(),r=result.request;expect(result.code).toMatch(/^\d{6}$/);expect(result.message).toContain(m.child.name);expect(result.message).toContain('Synthetic School');expect(result.message).toContain(result.code);expect(result.message).toContain('Sri Lanka');
 const stored=m.data().pickupRequest[0];expect(stored.codeHash).toHaveLength(64);expect(stored.codeHash).not.toBe(result.code);expect(+stored.expiresAt-f.clock).toBe(3600000);
 const newPhoto=await photo();await call('patch','pickups/people/'+r.personId,{...personBody(newPhoto.body.data.id),fullName:'Changed after issue'});
 const detail=await call('get','pickups/requests/'+r.id,{},m.teacher);expect(detail.body.data.snapshot.fullName).toBe('Synthetic Pickup Person');expect(detail.body.data.photoId).toBe(r.photoId);expect(JSON.stringify(detail.body)).not.toMatch(/codeHash|codeSalt|handoverHash|"code":|bytes/);
 expect((await call('post','pickups/requests',{childId:m.child.id,personId:r.personId})).status).toBe(409);
});
it('blocks wrong codes persistently, limits attempts and rate limits a Teacher account',async()=>{
 const result=await issued(),wrong=result.code==='000000'?'000001':'000000',id=result.request.id;
 for(let i=0;i<5;i++)expect((await act(id,'verify',{code:wrong})).status).toBe(422);
 expect(m.data().pickupRequest[0].attempts).toBe(5);expect((await act(id,'verify',{code:result.code})).body.error.code).toBe('PICKUP_CODE_LOCKED');
 expect((await act(id,'regenerate',{},m.parent)).status).toBe(409);
 for(let i=0;i<9;i++)await act(id,'verify',{code:wrong});expect((await act(id,'verify',{code:wrong})).status).toBe(429);
});
it('requires eligible attendance and current Guardian authority, not demo codes or an approval tap',async()=>{
 const result=await issued(),id=result.request.id;
 expect((await act(id,'complete',{handoverToken:'a'.repeat(64),identityChecked:true,physicalHandover:true})).body.error.code).toBe('PICKUP_VERIFICATION_REQUIRED');
 m.data().attendance[0].status='CHECKIN_PENDING';expect((await act(id,'verify',{code:result.code})).body.error.code).toBe('PICKUP_NOT_ELIGIBLE');m.data().attendance[0].status='PRESENT';
 m.data().guardian=[];expect((await act(id,'verify',{code:result.code})).body.error.code).toBe('PICKUP_AUTHORITY_REMOVED');
});
it('verifies once, requires the same Teacher and explicit handover, serializes concurrent completion and retains attendance',async()=>{
 const result=await issued(),id=result.request.id;expect((await act(id,'verify',{code:result.code},m.otherTeacher)).status).toBe(404);
 const verified=await act(id,'verify',{code:result.code});expect(verified.status).toBe(200);expect((await act(id,'verify',{code:result.code})).status).toBe(409);
 const body={handoverToken:verified.body.data.handoverToken,identityChecked:true,physicalHandover:true};expect((await act(id,'complete',{...body,physicalHandover:false})).status).toBe(422);
 const second={...m.teacher,id:randomUUID()};m.data().user.push(second);expect((await act(id,'complete',body,second)).status).toBe(409);
 const replies=await Promise.all([act(id,'complete',body),act(id,'complete',body)]);expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
 expect(m.data().attendance[0].status).toBe('PRESENT');expect(m.data().auditLog.filter(a=>a.action==='PICKUP_COMPLETED')).toHaveLength(1);
 const history=await call('get','pickups/requests');expect(history.body.data[0]).toMatchObject({status:'COMPLETED',reviewedBy:{id:m.teacher.id},requestedBy:{id:m.parent.id},snapshot:{fullName:'Synthetic Pickup Person'}});expect(history.body.data[0].completedAt).toBeTruthy();
});
it('invalidates old codes and Teacher proof on regeneration without resetting attempts',async()=>{
 const result=await issued(),id=result.request.id;const verified=await act(id,'verify',{code:result.code});
 const renewed=await act(id,'regenerate',{},m.parent);expect(renewed.status).toBe(200);expect(renewed.body.data.code).not.toBe(result.code);expect(m.data().pickupRequest[0].attempts).toBe(1);
 expect((await act(id,'complete',{handoverToken:verified.body.data.handoverToken,identityChecked:true,physicalHandover:true})).status).toBe(409);
 expect((await act(id,'verify',{code:result.code})).status).toBe(422);expect((await act(id,'verify',{code:renewed.body.data.code})).status).toBe(200);
});
it('persists cancellation and rejection, prevents reuse and inactive person requests',async()=>{
 const result=await issued(),id=result.request.id;expect((await act(id,'cancel',{},m.parent)).body.data.status).toBe('CANCELLED');expect((await act(id,'verify',{code:result.code})).status).toBe(409);
 const again=await call('post','pickups/requests',{childId:m.child.id,personId:result.request.personId});expect(again.status).toBe(201);expect((await act(again.body.data.request.id,'reject',{reason:'Identification does not match'})).body.data.status).toBe('REJECTED');
 await call('post',`pickups/people/${result.request.personId}/deactivate`);expect((await call('post','pickups/requests',{childId:m.child.id,personId:result.request.personId})).status).toBe(422);
});
it('serializes simultaneous requests and limits cancellation/regeneration to the requesting Guardian',async()=>{
 const who=await person(),body={childId:m.child.id,personId:who.id};
 const replies=await Promise.all([call('post','pickups/requests',body),call('post','pickups/requests',body)]);expect(replies.map(r=>r.status).sort()).toEqual([201,409]);
 const id=replies.find(r=>r.status===201).body.data.request.id;
 const coParent={...m.parent,id:randomUUID(),username:'second-guardian'};m.data().user.push(coParent);m.data().guardian.push({userId:coParent.id,childId:m.child.id});
 expect((await call('get','pickups/requests/'+id,{},coParent)).status).toBe(200);
 expect((await act(id,'cancel',{},coParent)).status).toBe(403);expect((await act(id,'regenerate',{},coParent)).status).toBe(403);
 expect((await act(id,'verify',{code:'123456'},m.parent)).status).toBe(403);
 expect((await act(id,'regenerate',{},m.teacher)).status).toBe(403);
});
it('expires requests and short-lived handover proofs, without accepting replay',async()=>{
 const result=await issued(),id=result.request.id;const verified=await act(id,'verify',{code:result.code});f.tick(300001);
 expect((await act(id,'complete',{handoverToken:verified.body.data.handoverToken,identityChecked:true,physicalHandover:true})).status).toBe(409);
 f.tick(3600000);expect((await call('get','pickups/requests')).body.data[0].status).toBe('EXPIRED');expect((await act(id,'verify',{code:result.code})).status).toBe(409);expect(m.data().pickupRequest[0].status).toBe('EXPIRED');
});
it('checks proof expiry after acquiring the child lock, including a delayed lock wait',async()=>{
 const result=await issued(),id=result.request.id,verified=await act(id,'verify',{code:result.code});
 const query=m.db.$queryRaw.getMockImplementation();m.db.$queryRaw.mockImplementation(async(strings,...values)=>{if(strings.join('').includes('FOR UPDATE'))f.tick(300001);return query(strings,...values);});
 const r=await act(id,'complete',{handoverToken:verified.body.data.handoverToken,identityChecked:true,physicalHandover:true});
 expect(r.status).toBe(409);expect(r.body.error.code).toBe('PICKUP_VERIFICATION_REQUIRED');expect(m.data().pickupRequest[0].status).toBe('PENDING');
});
it('caps the pickup window at Sri Lanka midnight and supports a shorter configured code lifetime',async()=>{
 f.tick(Date.parse('2026-10-25T18:25:00Z')-f.clock);
 const late=await issued();expect(late.request.day).toBe('2026-10-25');expect(late.request.expiresAt).toBe('2026-10-25T18:30:00.000Z');
 expect(+new Date(late.request.expiresAt)-f.clock).toBe(300000);
 await act(late.request.id,'cancel',{},m.parent);
 f.tick(3600000);
 vi.stubEnv('PICKUP_CODE_TTL_MINUTES','10');
 try{
  app=createApp({db:m.db,jwtSecret:secret,registrationEnabled:false,logger:{error:vi.fn()}});
  const shortened=await issued();expect(+new Date(shortened.request.expiresAt)-f.clock).toBe(600000);
 }finally{vi.unstubAllEnvs();}
});
it('rolls back private photo/request creation if required audit fails',async()=>{
 const who=await person();m.failAudit();expect((await call('post','pickups/requests',{childId:m.child.id,personId:who.id})).status).toBe(503);expect(m.data().pickupRequest).toHaveLength(0);
 const before=m.data().pickupPhoto.length;expect((await photo()).status).toBe(503);expect(m.data().pickupPhoto).toHaveLength(before);
});
it('returns only selected-child active Guardian saved phone contacts to its center Teacher',async()=>{
 p.profiles.set(m.parent.id,{fullName:'Synthetic Parent',phone:'+94 77 123 4567'});
 const otherParent={...m.parent,id:randomUUID(),username:'unrelated'};m.data().user.push(otherParent);p.profiles.set(otherParent.id,{fullName:'Other Parent',phone:'0700000000'});
 const r=await call('get',`children/${m.child.id}/parent-contacts`,{},m.teacher);expect(r.body.data).toEqual([{id:m.parent.id,name:'Synthetic Parent',relationship:'Linked Parent/Guardian',phone:'+94 77 123 4567',phoneSource:'SAVED_PROFILE'}]);
 expect((await call('get',`children/${m.child.id}/parent-contacts`,{},m.parent)).status).toBe(403);expect((await call('get',`children/${m.child.id}/parent-contacts`,{},m.otherTeacher)).status).toBe(404);
 p.profiles.clear();expect((await call('get',`children/${m.child.id}/parent-contacts`,{},m.teacher)).body.data[0].phone).toBeNull();
 p.uninstall();expect((await call('get',`children/${m.child.id}/parent-contacts`,{},m.teacher)).status).toBe(200);
});
