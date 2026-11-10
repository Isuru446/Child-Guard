import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { createApp } from '../src/app.js';
import { prepareAdminSessionCutover } from '../src/admin-session-cutover.js';
import { adminCookieTransport } from '../src/admin-session-http.js';
const secret='synthetic-application-cookie-secret-32-chars',password='Synthetic-cookie-password',passwordHash=bcrypt.hashSync(password,4);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
const transport=adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'});
const mediaPrefix=fileURLToPath(new URL('./.wp02d-media-',import.meta.url));
let f,app,base,mobile,expirePhoto,isolation,mediaRoot,photo;
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
const login=async()=>{const r=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(r.status).toBe(200);return {body:r.body.data,cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.data.csrfToken};};
beforeEach(()=>{
 vi.clearAllMocks();mediaRoot=mkdtempSync(mediaPrefix);
 f=sessionFixture();f.state.user.passwordHash=passwordHash;expirePhoto=false;isolation=[];photo=null;
 mobile=['PARENT','TEACHER'].map(role=>({id:randomUUID(),username:role.toLowerCase(),passwordHash,active:true,role,centerId:'mobile-center'}));
 base={privatePhoto:{findUnique:async()=>photo},user:{findUnique:async({where})=>[f.state.user,...mobile].find(u=>where.id?u.id===where.id:u.username===where.username)||null},$queryRaw:async()=>[{value:1}],$transaction:vi.fn(async()=>{throw Error('Unscoped database write');})};
 const original=f.repository.forCredential;
 f.repository.forCredential=(hash,work,level)=>{isolation.push(level);return original(hash,tx=>{
  tx.db={
   user:{findUnique:async({where})=>where.id===f.state.user.id?f.state.user:null,create:async({data})=>{const row={id:randomUUID(),...data};f.state.domain.push(row);return row;}},
   auditLog:{create:async({data})=>{f.state.domain.push({audit:data});return data;}},
   userProfile:{findUnique:async()=>({userId:f.state.user.id})},
   privatePhoto:{findUnique:async()=>null,upsert:async({create})=>{const p={id:randomUUID(),...create};f.state.domain.push({photo:p});if(expirePhoto)f.tick(300000);return p;}}
  };return work(tx);
 },level);};
 const prepared=prepareAdminSessionCutover({db:base,service:f.service,transport,jwtSecret:secret,absoluteAdminPolicy:'OWNER_ACCEPTED_ADMIN_8H_CEILING'});
 app=createApp({db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:secret,environment:'test',registrationEnabled:true,mediaRoot,logger:{error:vi.fn()}});
});
it('actual application selects cookie login and session /me before legacy handlers, without a bearer',async()=>{
 const a=await login();expect(a.body.user.role).toBe('ADMIN');expect(a.body).not.toHaveProperty('token');expect(Date.parse(a.body.session.absoluteExpiresAt)-f.clock).toBe(28800000);
 const me=await http('get','/api/v1/auth/me').set('Cookie',a.cookie);expect(me.status).toBe(200);expect(me.body.data.role).toBe('ADMIN');expect(me.body.data.user.role).toBe('ADMIN');expect(me.body.data.csrfToken).toBe(a.csrf);
 const hidden=await http('get','/api/v1/auth/me');expect(hidden.status).toBe(401);
 const legacy=jwt.sign({},secret,{subject:f.state.user.id,expiresIn:'1h',issuer:'childguard',audience:'childguard-app'});expect((await request(app).get('/api/v1/auth/me').set('Authorization','Bearer '+legacy)).status).toBe(401);
});
it.each(['parent','teacher'])('actual application keeps %s bearer login /me and denies Admin access',async username=>{
 const r=await request(app).post('/api/v1/auth/login').send({username,password});expect(r.status).toBe(200);expect(r.body.data.expiresIn).toBe(3600);expect(r.headers['set-cookie']).toBeUndefined();
 const me=await request(app).get('/api/v1/auth/me').set('Authorization','Bearer '+r.body.data.token);expect(me.status).toBe(200);expect(me.body.data.role).toBe(username.toUpperCase());
 expect((await request(app).get('/api/v1/admin/users').set('Authorization','Bearer '+r.body.data.token)).status).toBe(403);
});
it('raw private image upload retains the session boundary across body parsing and never uses unscoped writes',async()=>{
 const a=await login();const r=await http('put','/api/v1/account/photo').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).set('Content-Type','image/png').send(png);
 expect(r.status).toBe(200);expect(f.state.domain).toHaveLength(1);expect(f.state.domain[0].photo.mime).toBe('image/png');expect(base.$transaction).not.toHaveBeenCalled();expect(isolation).toContain('Serializable');expect(readdirSync(mediaRoot)).toHaveLength(1);expect(readFileSync(resolve(mediaRoot,readdirSync(mediaRoot)[0])).equals(png)).toBe(true);
});
it('private image expiry rolls back metadata and compensates the staged file',async()=>{
 const a=await login();expirePhoto=true;const r=await http('put','/api/v1/account/photo').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).set('Content-Type','image/png').send(png);
 expect(r.status).toBe(401);expect(f.state.domain).toEqual([]);expect(readdirSync(mediaRoot)).toHaveLength(0);expect(base.$transaction).not.toHaveBeenCalled();
});
it('unsupported multipart and invalid CSRF cannot write private photos',async()=>{
 const a=await login();const multipart=await http('put','/api/v1/account/photo').set('Cookie',a.cookie).set('X-CSRF-Token',a.csrf).attach('photo',png,'synthetic.png');
 expect(multipart.status).toBe(422);expect(readdirSync(mediaRoot)).toHaveLength(0);
 const csrf=await http('put','/api/v1/account/photo').set('Cookie',a.cookie).set('Content-Type','image/png').send(png);expect(csrf.status).toBe(403);expect(readdirSync(mediaRoot)).toHaveLength(0);
});
it('actual application polling expires at 300 seconds; logout revokes and rejects further requests',async()=>{
 const a=await login();for(let i=0;i<19;i++){f.tick(15000);expect((await http('get','/api/v1/auth/me').set('Cookie',a.cookie)).status).toBe(200);}expect(f.updates).toBe(0);f.tick(15000);expect((await http('get','/api/v1/auth/me').set('Cookie',a.cookie)).status).toBe(401);
 const b=await login();const r=await http('post','/api/v1/auth/logout').set('Cookie',b.cookie).set('X-CSRF-Token',b.csrf).send({});expect(r.status).toBe(200);expect((await http('get','/api/v1/auth/me').set('Cookie',b.cookie)).status).toBe(401);
});

afterEach(()=>{
 if(!mediaRoot)return;
 if(!mediaRoot.startsWith(mediaPrefix)||realpathSync.native(mediaRoot)!==mediaRoot)throw Error('Fixture cleanup refused');
 for(const name of readdirSync(mediaRoot)){if(!/^[a-f0-9-]{36}$/.test(name))throw Error('Unknown fixture artifact');unlinkSync(resolve(mediaRoot,name));}
 rmdirSync(mediaRoot);
});

it('private image reads require a current Admin session and enforce center scope without renewal',async()=>{
 const a=await login();photo={id:randomUUID(),storageKey:randomUUID(),mime:'image/png',userId:'other-user',profile:{user:{centerId:'center-a'}}};
 writeFileSync(resolve(mediaRoot,photo.storageKey),png);
 const valid=await http('get','/api/v1/account/photos/'+photo.id).set('Cookie',a.cookie);expect(valid.status).toBe(200);expect(valid.headers['content-type']).toContain('image/png');expect(f.updates).toBe(0);
 photo.profile.user.centerId='outside';expect((await http('get','/api/v1/account/photos/'+photo.id).set('Cookie',a.cookie)).status).toBe(404);
});
