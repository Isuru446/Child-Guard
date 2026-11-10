import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';

// Real router + service + write facade; only synthetic in-memory repositories.
const password='Synthetic-account-password',secret='synthetic-management-secret-over-32-chars';
const hash=bcrypt.hashSync(password,4);
let f,db,app,teacher,parent,outside,child,foreignChild,auth,auditFailure,expireWrite;
const store=()=>f.state.domain[0];
const matches=(row,where)=>Object.entries(where).every(([k,v])=>{
 if(v===undefined)return true;
 if(k==='OR')return v.some(part=>matches(row,part));
 if(v&&typeof v==='object'){
  if(v.in)return v.in.includes(row?.[k]);
  if(v.contains!==undefined)return (row?.[k]||'').toLowerCase().includes(v.contains.toLowerCase());
  if(v.is)return row?.[k]&&matches(row[k],v.is);
  return row?.[k]&&matches(row[k],v);
 }
 return row?.[k]===v;
});
const project=(row,select)=>!row?null:!select?structuredClone(row):Object.fromEntries(Object.entries(select).map(([k,s])=>[k,s===true?row[k]:Array.isArray(row[k])?row[k].filter(v=>!s.where||matches(v,s.where)).map(v=>project(v,s.select)):project(row[k],s.select)]));
const users=()=>[f.state.user,...store().users];
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const get=path=>http('get',path).set('Cookie',auth.cookie);
const patch=(path,body)=>http('patch',path).set('Cookie',auth.cookie).set('X-CSRF-Token',auth.csrf).send(body);
const details={fullName:'Updated Teacher',email:'updated@example.invalid',phone:'+94 771234567'};
beforeEach(async()=>{
 f=sessionFixture();f.state.user.passwordHash=hash;auditFailure=false;expireWrite=false;
 const account=(role,centerId='center-a')=>({id:randomUUID(),username:role.toLowerCase()+'-'+centerId,passwordHash:hash,role,active:true,centerId,profile:{fullName:role+' Person',email:role.toLowerCase()+centerId+'@example.invalid',phone:'0771234567',emergencyContacts:[{name:'Preserved'}]},guardians:[]});
 teacher=account('TEACHER');parent=account('PARENT');outside=account('PARENT','center-b');
 child={id:randomUUID(),name:'Existing child',centerId:'center-a'};foreignChild={id:randomUUID(),name:'Outside child',centerId:'center-b'};
 parent.guardians=[{child},{child:foreignChild}];
 f.state.domain.push({users:[teacher,parent,outside],children:[child,foreignChild],audits:[],links:[]});
 db={user:{
  findUnique:vi.fn(async({where,select})=>project(users().find(u=>matches(u,where)),select)),
  findFirst:vi.fn(async({where,select})=>project(users().find(u=>matches(u,where)),select)),
  findMany:vi.fn(async({where,select,skip=0,take=25})=>users().filter(u=>matches(u,where)).slice(skip,skip+take).map(u=>project(u,select))),
  create:vi.fn(async({data})=>{const u={id:randomUUID(),...data,profile:null,guardians:[]};store().users.push(u);return structuredClone(u);}),
  update:vi.fn(async({where,data,select})=>{const u=users().find(u=>matches(u,where));Object.assign(u,data);return project(u,select);}),
 },userProfile:{upsert:vi.fn(async({where,create,update,select})=>{
  if(store().users.some(u=>u.id!==where.userId&&u.profile?.email===update.email))throw Object.assign(Error('private-engine-text'),{code:'P2002'});
  const u=users().find(u=>u.id===where.userId);u.profile=u.profile?{...u.profile,...update}:{...create};
  if(expireWrite)f.tick(300000);return project(u.profile,select);
 })},registrationApplication:{findUnique:vi.fn(async()=>null)},
 child:{findMany:vi.fn(async({where,select})=>store().children.filter(c=>matches(c,where)).map(c=>project(c,select)))},
 guardian:{create:vi.fn(async({data})=>{store().links.push(data);return data;})},
 auditLog:{create:vi.fn(async({data})=>{if(auditFailure)throw Error('private-audit-error');store().audits.push(data);return data;})},
 $transaction:vi.fn(async()=>{throw Error('Unscoped transaction prohibited');}),
 };
 const original=f.repository.forCredential;
 f.repository.forCredential=(key,work,level)=>original(key,tx=>{tx.db=db;return work(tx);},level);
 const prepared=prepareAdminSessionCutover({db,service:f.service,jwtSecret:secret,transport:adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'}),absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 // Public registration may be off; managing deployed accounts remains available.
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,environment:'test',registrationEnabled:false,logger:{error:vi.fn()}});
 const r=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(r.status).toBe(200);
 auth={cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.data.csrfToken};
});
it.each(['TEACHER','PARENT'])('lists and filters only %s accounts in the session center',async role=>{
 const r=await get(`/api/v1/admin/users?role=${role}&search=person&status=ACTIVE`);
 expect(r.status).toBe(200);expect(r.body.data).toHaveLength(1);expect(r.body.data[0].role).toBe(role);
 expect(r.headers['cache-control']).toBe('no-store');expect(JSON.stringify(r.body)).not.toContain('passwordHash');
 expect(db.user.findMany.mock.calls[0][0].where).toMatchObject({centerId:'center-a',role,active:true});
 expect((await get(`/api/v1/admin/users?role=${role}&status=INACTIVE`)).body.data).toEqual([]);
});
it('returns safe details and only same-center existing child relationships',async()=>{
 const r=await get(`/api/v1/admin/users/${parent.id}`);expect(r.status).toBe(200);
 expect(r.body.data.guardians).toEqual([{child:{id:child.id,name:child.name}}]);
 expect(r.body.data.profile).toEqual({fullName:parent.profile.fullName,email:parent.profile.email,phone:parent.profile.phone});
 expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|authVersion|emergencyContacts|Outside child/);
});
it('lists zero, one and multiple real Guardian children with only safe same-center fields',async()=>{
 const second={id:randomUUID(),name:'Second linked child',centerId:'center-a',gps:{private:true},medical:'private'};
 parent.guardians.push({child:second});
 const empty={...parent,id:randomUUID(),username:'empty-parent',guardians:[]};
 const single={...parent,id:randomUUID(),username:'single-parent',guardians:[{child}]};
 store().users.push(empty,single);
 const r=await get('/api/v1/admin/users?role=PARENT');expect(r.status).toBe(200);
 expect(r.body.data.find(u=>u.id===parent.id).guardians).toEqual([{child:{id:child.id,name:child.name}},{child:{id:second.id,name:second.name}}]);
 expect(r.body.data.find(u=>u.id===empty.id).guardians).toEqual([]);
 expect(r.body.data.find(u=>u.id===single.id).guardians).toEqual([{child:{id:child.id,name:child.name}}]);
 expect(r.body.data.some(u=>u.id===outside.id)).toBe(false);
 expect(JSON.stringify(r.body)).not.toMatch(/Outside child|medical|gps|passwordHash|emergencyContacts|uidHash/);
 expect(db.user.findMany).toHaveBeenCalledTimes(1);expect(db.child.findMany).not.toHaveBeenCalled();
 expect(db.user.findMany.mock.calls[0][0].select.guardians.where).toEqual({child:{centerId:'center-a'}});
});
it('reflects removed Guardian links on the next list read without changing Teacher projections or pagination',async()=>{
 let r=await get('/api/v1/admin/users?role=PARENT&limit=1&offset=0');expect(r.body.data[0].guardians).toHaveLength(1);
 parent.guardians=[];
 r=await get('/api/v1/admin/users?role=PARENT&limit=1&offset=0');expect(r.body.data[0].guardians).toEqual([]);
 expect(r.body.page).toEqual({limit:1,offset:0});
 expect((await get('/api/v1/admin/users?role=PARENT&limit=1&offset=1')).body.data).toEqual([]);
 const teachers=await get('/api/v1/admin/users?role=TEACHER');expect(teachers.body.data[0]).not.toHaveProperty('guardians');
});
it.each(['outside','admin','missing'])('rejects %s IDs for details, edits and status',async kind=>{
 const id=kind==='outside'?outside.id:kind==='admin'?randomUUID():randomUUID();
 if(kind==='admin')store().users.push({id,role:'ADMIN',centerId:'center-a',active:true});
 expect((await get(`/api/v1/admin/users/${id}`)).status).toBe(404);
 expect((await patch(`/api/v1/admin/users/${id}/profile`,details)).status).toBe(404);
 expect((await patch(`/api/v1/admin/users/${id}/status`,{active:false})).status).toBe(404);
 expect(db.userProfile.upsert).not.toHaveBeenCalled();expect(db.user.update).not.toHaveBeenCalled();
});
it.each(['TEACHER','PARENT'])('updates only permitted %s profile fields within the cookie transaction',async role=>{
 const u=role==='TEACHER'?teacher:parent;
 const r=await patch(`/api/v1/admin/users/${u.id}/profile`,details);expect(r.status).toBe(200);expect(r.body.data).toEqual(details);
 const saved=store().users.find(v=>v.id===u.id);expect(saved.profile.emergencyContacts).toEqual([{name:'Preserved'}]);expect(saved.role).toBe(role);expect(saved.passwordHash).toBe(hash);
 expect(store().audits).toContainEqual({userId:f.state.user.id,resourceId:u.id,action:'MANAGED_PROFILE_UPDATED'});
 expect(db.$transaction).not.toHaveBeenCalled();expect(f.updates).toBe(0);
});
it.each([{role:'ADMIN'},{centerId:'center-b'},{active:false},{passwordHash:'injected'},{password:'injected'},{username:'changed'},{fullName:'x'},{email:'not-email'},{phone:'abc'}])('rejects invalid or escalated profile input %j',async extra=>{
 expect((await patch(`/api/v1/admin/users/${teacher.id}/profile`,{...details,...extra})).status).toBe(422);
 expect(db.userProfile.upsert).not.toHaveBeenCalled();
});
it('rejects conflicting profile identities without exposing Prisma errors',async()=>{
 db.registrationApplication.findUnique.mockResolvedValue({userId:outside.id});
 expect((await patch(`/api/v1/admin/users/${teacher.id}/profile`,details)).status).toBe(409);
 db.registrationApplication.findUnique.mockResolvedValue(null);
 const r=await patch(`/api/v1/admin/users/${teacher.id}/profile`,{...details,email:parent.profile.email});
 expect(r.status).toBe(409);expect(JSON.stringify(r.body)).not.toContain('private-engine');
});
it.each(['audit','expiry'])('rolls back profile and audit after %s failure',async kind=>{
 auditFailure=kind==='audit';expireWrite=kind==='expiry';
 const r=await patch(`/api/v1/admin/users/${teacher.id}/profile`,details);expect(r.status).toBe(kind==='expiry'?401:503);
 expect(store().users.find(u=>u.id===teacher.id).profile.fullName).toBe('TEACHER Person');expect(store().audits).toEqual([]);
});
it.each(['TEACHER','PARENT'])('deactivates/reactivates %s and preserves mobile authentication checks',async role=>{
 const u=role==='TEACHER'?teacher:parent;
 const r=await request(app).post('/api/v1/auth/login').send({username:u.username,password});expect(r.status).toBe(200);
 const bearer='Bearer '+r.body.data.token;
 expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer)).status).toBe(200);
 expect((await patch(`/api/v1/admin/users/${u.id}/status`,{active:false})).status).toBe(200);
 expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer)).status).toBe(401);
 expect((await patch(`/api/v1/admin/users/${u.id}/status`,{active:true})).status).toBe(200);
 expect((await request(app).get('/api/v1/auth/me').set('Authorization',bearer)).status).toBe(200);
 expect((await request(app).get('/api/v1/admin/users').set('Authorization',bearer)).status).toBe(403);
 expect((await request(app).get(`/api/v1/admin/users/${teacher.id}`).set('Authorization',bearer)).status).toBe(403);
 expect((await request(app).patch(`/api/v1/admin/users/${teacher.id}/profile`).set('Authorization',bearer).send(details)).status).toBe(403);
 expect((await request(app).patch(`/api/v1/admin/users/${teacher.id}/status`).set('Authorization',bearer).send({active:false})).status).toBe(403);
});
it('requires cookie admission, CSRF and Origin; refuses legacy Admin JWT',async()=>{
 expect((await http('get','/api/v1/admin/users')).status).toBe(401);
 expect((await http('patch',`/api/v1/admin/users/${teacher.id}/profile`).set('Cookie',auth.cookie).send(details)).status).toBe(403);
 expect((await patch(`/api/v1/admin/users/${teacher.id}/profile`,details).set('Origin','http://evil.invalid')).status).toBe(403);
 const token=jwt.sign({},secret,{subject:f.state.user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
 expect((await request(app).get('/api/v1/admin/users').set('Authorization','Bearer '+token)).status).toBe(401);
 expect(db.userProfile.upsert).not.toHaveBeenCalled();
});
it('rejects invalid list queries and manipulated identifiers',async()=>{
 for(const query of ['role=ADMIN','centerId=center-b','status=anything','limit=101','offset=-1','search='+('x'.repeat(101))])expect((await get('/api/v1/admin/users?'+query)).status).toBe(422);
 expect((await get('/api/v1/admin/users/not-a-uuid')).status).toBe(422);
});
it('reuses provisioning with cookie CSRF and explicit same-center Parent links only',async()=>{
 const provision=body=>http('post','/api/v1/admin/users').set('Cookie',auth.cookie).set('X-CSRF-Token',auth.csrf).send(body);
 const body={username:'new-parent',password,role:'PARENT',childIds:[foreignChild.id]};
 expect((await provision(body)).status).toBe(404);expect(store().links).toEqual([]);
 const r=await provision({...body,childIds:[child.id]});expect(r.status).toBe(201);expect(r.body.data.role).toBe('PARENT');
 expect(store().links).toEqual([{userId:r.body.data.id,childId:child.id}]);expect(JSON.stringify(r.body)).not.toContain(password);
 expect(bcrypt.getRounds(store().users.find(u=>u.id===r.body.data.id).passwordHash)).toBe(12);
 expect(db.$transaction).not.toHaveBeenCalled();
});
