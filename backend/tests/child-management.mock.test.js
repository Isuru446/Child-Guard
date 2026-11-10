import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';

// Real HTTP authorization/session/transaction composition. No Prisma or network DB.
const password='Synthetic-child-test-password',hash=bcrypt.hashSync(password,4),secret='synthetic-child-management-secret-32-characters';
let f,app,db,child,outsideChild,parent,outsideParent,teacher,auth,expire,auditFailure,levels;
const state=()=>f.state.domain[0];
const equals=(a,b)=>a instanceof Date||b instanceof Date?+new Date(a)===+new Date(b):a===b;
function matches(row,where={}) {
 return Object.entries(where).every(([k,v])=>{
  if(v===undefined)return true;
  if(k==='OR')return v.some(w=>matches(row,w));
  const value=row?.[k];
  if(v instanceof Date||v===null||typeof v!=='object')return equals(value,v);
  if(v.in)return v.in.includes(value);
  if(Object.hasOwn(v,'not'))return !equals(value,v.not);
  if(Object.hasOwn(v,'equals'))return v.mode==='insensitive'?String(value).toLowerCase()===String(v.equals).toLowerCase():equals(value,v.equals);
  if(Object.hasOwn(v,'contains'))return String(value||'').toLowerCase().includes(v.contains.toLowerCase());
  if(v.some)return value?.some(r=>matches(r,v.some));
  if(v.none)return !value?.some(r=>matches(r,v.none));
  if(v.is)return matches(value,v.is);
  return matches(value,v);
 });
}
function project(row,select) {
 if(!row)return null;if(!select)return structuredClone(row);
 return Object.fromEntries(Object.entries(select).map(([k,s])=>[k,s===true?row[k]:Array.isArray(row[k])?row[k].filter(r=>matches(r,s.where)).slice(0,s.take??Infinity).map(r=>project(r,s.select)):project(row[k],s.select)]));
}
const users=()=>[f.state.user,...state().users];
const decorate=c=>({...c,guardians:state().guardians.filter(g=>g.childId===c.id).map(g=>({...g,user:users().find(u=>u.id===g.userId)})),assignments:state().assignments.filter(a=>a.childId===c.id),enrollmentRequests:[]});
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const get=path=>http('get',path).set('Cookie',auth.cookie);
const write=(method,path,body)=>http(method,path).set('Cookie',auth.cookie).set('X-CSRF-Token',auth.csrf).send(body);
const expected=c=>({name:c.name,dateOfBirth:c.dateOfBirth?.toISOString().slice(0,10)||null,groupName:c.groupName??null});
const link=(userId=parent.id,childId=child.id)=>write('post',`/api/v1/admin/users/${userId}/guardians`,{childIds:[childId]});
const unlink=(userId=parent.id,childId=child.id)=>write('delete',`/api/v1/admin/users/${userId}/guardians`,{childId,removalAcknowledged:true});
beforeEach(async()=>{
 f=sessionFixture();f.state.user.passwordHash=hash;expire=null;auditFailure=false;levels=[];
 child={id:randomUUID(),name:'Existing child',dateOfBirth:new Date('2021-02-03T00:00:00Z'),groupName:'Blue',centerId:'center-a'};
 outsideChild={...child,id:randomUUID(),name:'Outside child',centerId:'center-b'};
 const user=(role,centerId='center-a')=>({id:randomUUID(),username:role.toLowerCase()+'-'+centerId,passwordHash:hash,role,active:true,centerId,profile:{fullName:role+' Person'}});
 parent=user('PARENT');outsideParent=user('PARENT','center-b');teacher=user('TEACHER');
 f.state.domain.push({children:[child,outsideChild],users:[parent,outsideParent,teacher],guardians:[],audits:[],assignments:[{id:randomUUID(),childId:child.id,startedAt:new Date('2026-01-01'),endedAt:null,device:{id:randomUUID(),hardwareId:'existing-wearable',active:true,centerId:'center-a',tokenHash:'never-expose'}}],attendance:[{id:'preserved-attendance'}],events:[{id:'preserved-location'}]});
 const tick=kind=>{if(expire===kind)f.tick(300000);};
 db={deviceEvent:{findFirst:vi.fn(async()=>null)},child:{
  findFirst:vi.fn(async({where,select})=>project(state().children.map(decorate).find(c=>matches(c,where)),select)),
  findMany:vi.fn(async({where,select,take=25,skip=0})=>state().children.map(decorate).filter(c=>matches(c,where)).slice(skip,skip+take).map(c=>project(c,select))),
  count:vi.fn(async({where})=>state().children.filter(c=>matches(c,where)).length),
  create:vi.fn(async({data,select})=>{const c={id:randomUUID(),...data};state().children.push(c);tick('create');return project(c,select);}),
  update:vi.fn(async({where,data,select})=>{const c=state().children.find(c=>matches(c,where));Object.assign(c,data);tick('update');return project(c,select);}),
 },user:{
  findUnique:vi.fn(async({where,select})=>project(users().find(u=>matches(u,where)),select)),
  findFirst:vi.fn(async({where,select})=>{
   const user=users().find(u=>matches(u,where));
   return project(user?{...user,guardians:state().guardians.filter(g=>g.userId===user.id).map(g=>({child:state().children.find(c=>c.id===g.childId)}))}:null,select);
  }),
 },guardian:{
  findUnique:vi.fn(async({where})=>state().guardians.find(g=>matches(g,where.userId_childId))||null),
  create:vi.fn(async({data})=>{state().guardians.push(data);tick('link');return data;}),
  deleteMany:vi.fn(async({where})=>{const before=state().guardians.length;state().guardians=state().guardians.filter(g=>!matches(g,where));tick('unlink');return {count:before-state().guardians.length};}),
 },auditLog:{create:vi.fn(async({data})=>{if(auditFailure)throw Error('private-audit-error');state().audits.push(data);return data;})},
 $transaction:vi.fn(async()=>{throw Error('Unscoped write refused');}),
 };
 const original=f.repository.forCredential;
 f.repository.forCredential=(key,work,level)=>original(key,tx=>{levels.push(level);tx.db=db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,registrationEnabled:false,environment:'test',logger:{error:vi.fn()}});
 const r=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(r.status).toBe(200);auth={cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.data.csrfToken};
});
it('lists, searches and filters center children with only safe wearable/guardian information',async()=>{
 state().guardians.push({userId:parent.id,childId:child.id});
 const r=await get('/api/v1/admin/children?search=existing&group=blue&guardian=LINKED');expect(r.status).toBe(200);expect(r.body.data).toHaveLength(1);
 expect(r.body.data[0].assignments[0].device.hardwareId).toBe('existing-wearable');expect(r.headers['cache-control']).toBe('no-store');
 expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|tokenHash|Outside child/);
 expect((await get('/api/v1/admin/children?guardian=UNLINKED')).body.data).toEqual([]);
});
it('details reject foreign IDs and filter inconsistent cross-center relations defensively',async()=>{
 state().guardians.push({userId:outsideParent.id,childId:child.id});
 state().assignments.push({id:randomUUID(),childId:child.id,endedAt:null,device:{id:'foreign',centerId:'center-b'}});
 const r=await get(`/api/v1/admin/children/${child.id}`);expect(r.status).toBe(200);expect(r.body.data.guardians).toEqual([]);expect(r.body.data.assignments).toHaveLength(1);
 expect((await get(`/api/v1/admin/children/${outsideChild.id}`)).status).toBe(404);
 expect((await get('/api/v1/admin/children/not-a-uuid')).status).toBe(422);
});
it('enrolls a child atomically, assigns no guardian/device, and records the Admin audit',async()=>{
 const history=structuredClone({assignments:state().assignments,attendance:state().attendance,events:state().events});
 const r=await write('post','/api/v1/admin/children',{name:'New child',dateOfBirth:'2022-03-04',groupName:'Green'});
 expect(r.status).toBe(201);expect(r.body.data.name).toBe('New child');expect(state().children.at(-1).centerId).toBe('center-a');expect(state().guardians).toEqual([]);
 expect((await get(`/api/v1/admin/children/${r.body.data.id}`)).body.data).toMatchObject({name:'New child',groupName:'Green'});
 expect(state().audits).toContainEqual({userId:f.state.user.id,resourceId:r.body.data.id,action:'CHILD_ENROLLED'});
 expect({assignments:state().assignments,attendance:state().attendance,events:state().events}).toEqual(history);expect(levels).toContain('Serializable');expect(db.$transaction).not.toHaveBeenCalled();
});
it('blocks duplicate enrollment including unknown birth dates and simultaneous requests',async()=>{
 expect((await write('post','/api/v1/admin/children',{name:'EXISTING CHILD',dateOfBirth:'2021-02-03'})).status).toBe(409);
 expect((await write('post','/api/v1/admin/children',{name:'Existing child'})).status).toBe(409);
 const results=await Promise.all([1,2].map(()=>write('post','/api/v1/admin/children',{name:'Concurrent child',dateOfBirth:'2022-03-04'})));
 expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(state().children.filter(c=>c.name==='Concurrent child')).toHaveLength(1);
});
it.each([{name:'x'},{name:'Valid',dateOfBirth:'2999-01-01'},{name:'Valid',dateOfBirth:'2024-02-30'},{name:'Valid',centerId:'center-b'},{name:'Valid',guardians:[{userId:'guessed'}]},{name:'Valid',groupName:'x'.repeat(81)}])('rejects invalid/privileged child input %j',async body=>{
 expect((await write('post','/api/v1/admin/children',body)).status).toBe(422);expect(db.child.create).not.toHaveBeenCalled();
});
it('edits only permitted details, supports clearing optional fields and rejects stale writes',async()=>{
 const prior=expected(child),history=structuredClone(state().assignments);
 const r=await write('patch',`/api/v1/admin/children/${child.id}`,{name:'Updated child',dateOfBirth:null,groupName:null,expected:prior});expect(r.status).toBe(200);expect(r.body.data.dateOfBirth).toBeNull();
 expect((await write('patch',`/api/v1/admin/children/${child.id}`,{name:'Overwritten child',expected:prior})).status).toBe(409);
 expect(state().children[0].name).toBe('Updated child');expect(state().assignments).toEqual(history);
 expect((await get(`/api/v1/admin/children/${child.id}`)).body.data).toMatchObject({name:'Updated child',dateOfBirth:null,groupName:null});
 expect((await write('patch',`/api/v1/admin/children/${child.id}`,{name:'No snapshot'})).status).toBe(422);
});
it('rejects edits targeting foreign centers and conflicting child identities',async()=>{
 expect((await write('patch',`/api/v1/admin/children/${outsideChild.id}`,{name:'Outside edit',expected:expected(outsideChild)})).status).toBe(404);
 state().children.push({...child,id:randomUUID(),name:'Second child'});
 expect((await write('patch',`/api/v1/admin/children/${child.id}`,{name:'Second child',expected:expected(child)})).status).toBe(409);
});
it('distinguishes an epoch birth date from a cleared date during duplicate review',async()=>{
 state().children[0].dateOfBirth=new Date('1970-01-01T00:00:00Z');
 state().children.push({...child,id:randomUUID(),dateOfBirth:new Date('2020-01-01T00:00:00Z')});
 const r=await write('patch',`/api/v1/admin/children/${child.id}`,{name:child.name,dateOfBirth:null,expected:expected(state().children[0])});
 expect(r.status).toBe(409);expect(state().children[0].dateOfBirth.toISOString()).toBe('1970-01-01T00:00:00.000Z');
});
it('explicit linking is idempotent even concurrently, and never guesses other relationships',async()=>{
 const results=await Promise.all([link(),link()]);expect(results.every(r=>r.status===200)).toBe(true);expect(results.map(r=>r.body.data.linked).sort()).toEqual([0,1]);
 expect(state().guardians).toEqual([{userId:parent.id,childId:child.id}]);expect(state().audits.filter(a=>a.action.startsWith('GUARDIAN_LINK_CREATED'))).toHaveLength(1);
});
it('refuses foreign, Teacher and inactive Parent links and invalid identifiers',async()=>{
 for(const id of [outsideParent.id,teacher.id])expect((await link(id)).status).toBe(404);
 expect((await link(parent.id,outsideChild.id)).status).toBe(404);
 state().users[0].active=false;expect((await link()).status).toBe(404);
 expect((await link('invalid')).status).toBe(422);expect(state().guardians).toEqual([]);
});
it('removes only the acknowledged relationship, idempotently, preserving all history and Parent records',async()=>{
 await link();const before=structuredClone(state());
 expect((await get(`/api/v1/admin/users/${parent.id}`)).body.data.guardians).toEqual([{child:{id:child.id,name:child.name}}]);
 expect((await write('delete',`/api/v1/admin/users/${parent.id}/guardians`,{childId:child.id})).status).toBe(422);
 expect((await unlink()).body.data.removed).toBe(1);expect((await unlink()).body.data.removed).toBe(0);
 expect(state().guardians).toEqual([]);for(const key of ['children','users','assignments','attendance','events'])expect(state()[key]).toEqual(before[key]);
 expect((await get(`/api/v1/admin/users/${parent.id}`)).body.data.guardians).toEqual([]);
 expect(state().audits.filter(a=>a.action.startsWith('GUARDIAN_LINK_REMOVED'))).toHaveLength(1);
});
it('refuses foreign relationship removal without touching existing links',async()=>{
 await link();expect((await unlink(outsideParent.id)).status).toBe(404);expect((await unlink(parent.id,outsideChild.id)).status).toBe(404);expect(state().guardians).toHaveLength(1);
});
it.each(['create','update','link','unlink'])('rolls back %s when the Admin session expires during the write',async kind=>{
 if(kind==='unlink')await link();const before=structuredClone(state());expire=kind;
 const r=kind==='create'?await write('post','/api/v1/admin/children',{name:'Rollback child'}):kind==='update'?await write('patch',`/api/v1/admin/children/${child.id}`,{name:'Rollback name',expected:expected(child)}):kind==='link'?await link():await unlink();
 expect(r.status).toBe(401);expect(state()).toEqual(before);
});
it('rolls back enrollment when required auditing fails without leaking engine errors',async()=>{
 auditFailure=true;const before=structuredClone(state());const r=await write('post','/api/v1/admin/children',{name:'Audit rollback'});expect(r.status).toBe(503);expect(state()).toEqual(before);expect(JSON.stringify(r.body)).not.toContain('private-audit');
});
it('requires cookie, Origin and CSRF and never offers a child deletion endpoint',async()=>{
 expect((await http('get','/api/v1/admin/children')).status).toBe(401);
 expect((await http('post','/api/v1/admin/children').set('Cookie',auth.cookie).send({name:'Forbidden child'})).status).toBe(403);
 expect((await write('post','/api/v1/admin/children',{name:'Forbidden child'}).set('Origin','http://evil.invalid')).status).toBe(403);
 expect((await write('delete',`/api/v1/admin/children/${child.id}`,{})).status).toBe(404);expect(db.child.create).not.toHaveBeenCalled();
});
it.each(['PARENT','TEACHER'])('preserves %s mobile authentication but refuses child/guardian administration',async role=>{
 const user=role==='PARENT'?parent:teacher;
 const r=await request(app).post('/api/v1/auth/login').send({username:user.username,password});expect(r.status).toBe(200);const bearer='Bearer '+r.body.data.token;
 for(const [method,path,body] of [['get','/api/v1/admin/children'],['post','/api/v1/admin/children',{name:'Forbidden child'}],['patch',`/api/v1/admin/children/${child.id}`,{name:'Forbidden child',expected:expected(child)}],['post',`/api/v1/admin/users/${parent.id}/guardians`,{childIds:[child.id]}],['delete',`/api/v1/admin/users/${parent.id}/guardians`,{childId:child.id,removalAcknowledged:true}]])expect((await request(app)[method](path).set('Authorization',bearer).send(body)).status).toBe(403);
 if(role==='PARENT'){
  await link();expect((await request(app).get(`/api/v1/mobile/children/${child.id}`).set('Authorization',bearer)).status).toBe(200);
  await unlink();expect((await request(app).get(`/api/v1/mobile/children/${child.id}`).set('Authorization',bearer)).status).toBe(404);
 }
});
it('validates list filters rather than accepting a caller-provided center',async()=>{
 for(const q of ['centerId=center-b','limit=101','offset=-1','guardian=anything'])expect((await get('/api/v1/admin/children?'+q)).status).toBe(422);
});
