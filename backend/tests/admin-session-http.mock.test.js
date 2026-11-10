import { beforeEach, expect, it } from 'vitest';
import express from 'express';
import { vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createAdminSessionRouter, adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
let f,app;
const password='Synthetic-admin-password',passwordHash=bcrypt.hashSync(password,4);
const transport=adminCookieTransport({mode:'local-development',environment:'development',origin:'http://localhost:5174'});
const http=(method,path)=>request(app)[method](path).set('Host','localhost:5174').set('Origin','http://localhost:5174');
async function login(){const response=await http('post','/api/v1/auth/login').send({username:'admin',password});expect(response.status).toBe(200);return {response,cookie:response.headers['set-cookie'][0].split(';')[0],csrf:response.body.data.csrfToken};}
beforeEach(()=>{
 f=sessionFixture();f.state.user.passwordHash=passwordHash;
 app=express();app.use(express.json());
 app.use(createAdminSessionRouter({db:{user:{findUnique:async({where})=>where.username===f.state.user.username?f.state.user:null}},service:f.service,transport}));
 app.get('/api/v1/private',(req,res)=>res.json({data:{centerId:req.user.centerId,role:req.user.role}}));
 app.post('/api/v1/private',(req,res,next)=>req.withAdminMutation(async(db,user)=>{db.domain.push(user.centerId);return {created:true};}).then(data=>res.json({data})).catch(next));
 app.use((e,req,res,next)=>res.status(e.status||503).json({error:{code:e.code||'SERVICE_UNAVAILABLE'}}));
});
it('cookie login exposes no bearer/hash and read-only /me restores CSRF without renewing idle',async()=>{
 const {response,cookie,csrf}=await login();const header=response.headers['set-cookie'][0];
 expect(header).toContain('HttpOnly');expect(header).toContain('SameSite=Strict');expect(header).toContain('Path=/');expect(header).not.toContain('Domain=');expect(header).not.toContain('Secure');
 expect(JSON.stringify(response.body)).not.toContain(cookie.split('=')[1]);expect(response.body.data).not.toHaveProperty('token');expect(response.body.data).not.toHaveProperty('credential');expect(JSON.stringify(response.body)).not.toMatch(/credentialHash|passwordHash|csrfHash/);
 f.tick(100000);const me=await http('get','/api/v1/auth/me').set('Cookie',cookie);
 expect(me.status).toBe(200);expect(me.body.data.csrfToken).toBe(csrf);expect(me.body.data.session.idleExpiresAt).toBe(response.body.data.session.idleExpiresAt);expect(f.updates).toBe(0);expect(me.headers['cache-control']).toBe('no-store');
});
it('private polling and media-style requests expire at exactly five minutes and clear cookie',async()=>{
 const {cookie}=await login();f.tick(299999);expect((await http('get','/api/v1/private').set('Cookie',cookie)).status).toBe(200);
 f.tick(1);const expired=await http('get','/api/v1/account/photos/synthetic').set('Cookie',cookie);expect(expired.status).toBe(401);expect(expired.body.error.code).toBe('SESSION_EXPIRED');expect(expired.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');expect(f.updates).toBe(0);
});
it('valid dedicated activity renews; unknown fields and caller timestamps do not',async()=>{
 const {cookie,csrf}=await login();f.tick(15000);
 const active=await http('post','/api/v1/auth/activity').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({interactionId:randomUUID()});
 expect(active.status).toBe(200);expect(Date.parse(active.body.data.idleExpiresAt)).toBe(f.clock+300000);
 const invalid=await http('post','/api/v1/auth/activity').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({interactionId:randomUUID(),timestamp:999999999});expect(invalid.status).toBe(422);expect(f.updates).toBe(1);
});
it.each(['missing','wrong','foreign-origin'])('rejects %s CSRF/origin without any mutation',async kind=>{
 const {cookie,csrf}=await login();let req=http('post','/api/v1/private').set('Cookie',cookie);
 if(kind==='wrong')req=req.set('X-CSRF-Token','A'.repeat(43));
 if(kind==='foreign-origin')req=req.set('X-CSRF-Token',csrf).set('Origin','http://evil.invalid');
 const response=await req.send({});expect(response.status).toBe(403);expect(f.state.domain).toEqual([]);expect(f.updates).toBe(0);
});
it('preserves server center scope and mutation does not renew idle',async()=>{
 const {cookie,csrf}=await login();const privateData=await http('get','/api/v1/private?centerId=outside').set('Cookie',cookie);expect(privateData.body.data.centerId).toBe('center-a');
 const changed=await http('post','/api/v1/private').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});expect(changed.status).toBe(200);expect(f.state.domain).toEqual(['center-a']);expect(f.updates).toBe(0);
});
it('logout revokes and clears cookie; rejected logout clears cookie but never claims success',async()=>{
 const {cookie,csrf}=await login();const denied=await http('post','/api/v1/auth/logout').set('Cookie',cookie).send({});expect(denied.status).toBe(403);expect(denied.headers['set-cookie']).toBeTruthy();expect(f.state.sessions[0].revokedAt).toBeNull();
 const out=await http('post','/api/v1/auth/logout').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});expect(out.status).toBe(200);expect(out.body.data.revoked).toBe(true);expect(out.headers['set-cookie']).toBeTruthy();
 expect((await http('get','/api/v1/private').set('Cookie',cookie)).body.error.code).toBe('SESSION_REVOKED');
});
it('refuses missing cookies, duplicate cookies and legacy bearer credentials with no fallback',async()=>{
 const {cookie}=await login();const bearer=jwt.sign({sub:'user-a'},'synthetic-private-jwt-key-32-characters');
 for(const headers of [{},{Cookie:cookie+'; '+cookie},{Cookie:cookie,Authorization:'Bearer '+bearer}])expect((await http('get','/api/v1/private').set(headers)).status).toBe(401);
});
it('clientKind cannot select policy; non-admin roles cannot create an Admin session',async()=>{
 expect((await http('post','/api/v1/auth/login').send({username:'admin',password,clientKind:'MOBILE'})).status).toBe(422);
 f.state.user.role='TEACHER';expect((await http('post','/api/v1/auth/login').send({username:'admin',password})).status).toBe(401);expect(f.state.sessions).toEqual([]);
});
it('login CSRF and direct/cross-host cookie deployments are refused',async()=>{
 for(const overrides of [{Origin:'http://evil.invalid'},{Host:'localhost:3100'},{Host:'127.0.0.1:5174'},{'Sec-Fetch-Site':'same-site'}])expect((await http('post','/api/v1/auth/login').set(overrides).send({username:'admin',password})).status).toBe(403);
 expect(f.state.sessions).toEqual([]);
});
it('secure transport requires HTTPS and uses the __Host cookie; local exception is dev localhost only',()=>{
 expect(adminCookieTransport({mode:'https',environment:'production',origin:'https://childguard.example'})).toEqual({origin:'https://childguard.example',secure:true,name:'__Host-childguard_admin',host:'childguard.example'});
 for(const config of [{mode:'https',environment:'production',origin:'http://localhost:5174'},{mode:'local-development',environment:'production',origin:'http://localhost:5174'},{mode:'local-development',environment:'development',origin:'http://127.0.0.1:5174'}])expect(()=>adminCookieTransport(config)).toThrow();
});
it('serializes the production cookie with Secure/HttpOnly/Strict and no Domain under a trusted TLS proxy simulation',async()=>{
 const secure=adminCookieTransport({mode:'https',environment:'production',origin:'https://childguard.example'});
 app=express();app.set('trust proxy','loopback');app.use(express.json());
 app.use(createAdminSessionRouter({db:{user:{findUnique:async()=>f.state.user}},service:f.service,transport:secure}));
 const response=await request(app).post('/api/v1/auth/login').set('Host','childguard.example').set('Origin','https://childguard.example').set('X-Forwarded-Proto','https').send({username:'admin',password});
 expect(response.status).toBe(200);const cookie=response.headers['set-cookie'][0];
 for(const flag of ['__Host-childguard_admin=','HttpOnly','Secure','SameSite=Strict','Path=/'])expect(cookie).toContain(flag);expect(cookie).not.toContain('Domain=');
});
it('database unavailability stays 503, with no engine details or false revocation success',async()=>{
 const {cookie,csrf}=await login();vi.spyOn(f.service,'revoke').mockRejectedValueOnce(Error('synthetic-engine-private-details'));
 const response=await http('post','/api/v1/auth/logout').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});
 expect(response.status).toBe(503);expect(response.body).toEqual({error:{code:'SERVICE_UNAVAILABLE',message:'Session service temporarily unavailable'}});expect(response.headers['set-cookie']).toBeTruthy();
});
