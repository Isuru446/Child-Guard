import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// HTTP requests target an in-memory Express app only. No Prisma/env/database.
const secret=randomUUID()+randomUUID();
const password='Synthetic-login-password';
const passwordHash=bcrypt.hashSync(password,4);
let app,user,findUnique;
beforeEach(()=>{
 user={id:randomUUID(),username:'synthetic-admin',passwordHash,active:true,role:'ADMIN',centerId:randomUUID()};
 findUnique=vi.fn(async({where})=>where.username===user.username||where.id===user.id?user:null);
 app=createApp({db:{user:{findUnique}},jwtSecret:secret,environment:'test',logger:{error:vi.fn()}});
});
it('keeps successful ADMIN login and protected identity response compatible, without password fields',async()=>{
 const login=await request(app).post('/api/v1/auth/login').send({username:user.username,password});
 expect(login.status).toBe(200);expect(login.body.data.user).toEqual({id:user.id,username:user.username,role:'ADMIN',centerId:user.centerId});
 expect(login.body.data.expiresIn).toBe(3600);expect(login.body.data.token).toEqual(expect.any(String));
 const me=await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${login.body.data.token}`);
 expect(me.status).toBe(200);expect(me.body.data.role).toBe('ADMIN');
 expect(JSON.stringify([login.body,me.body])).not.toContain(passwordHash);
});
it('rejects wrong passwords and inactive accounts with the same credential response',async()=>{
 const wrong=await request(app).post('/api/v1/auth/login').send({username:user.username,password:'wrong'});
 user.active=false;
 const inactive=await request(app).post('/api/v1/auth/login').send({username:user.username,password});
 expect(wrong.status).toBe(401);expect(inactive.status).toBe(401);
 expect(wrong.body).toEqual({error:{code:'INVALID_CREDENTIALS',message:'Invalid credentials'}});expect(inactive.body).toEqual(wrong.body);
});
it('rejects missing, invalid and expired sessions before reading any private user data',async()=>{
 const expired=jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:-1});
 for(const token of ['', 'invalid',expired]) {
  const response=await request(app).get('/api/v1/auth/me').set('Authorization',`Bearer ${token}`);
  expect(response.status).toBe(401);expect(response.body.error.code).toBe('UNAUTHENTICATED');
 }
 expect(findUnique).not.toHaveBeenCalled();
});
it('enforces ADMIN-only account management for authenticated non-admins',async()=>{
 for(const role of ['TEACHER','PARENT']) {
  user.role=role;
  const token=jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'});
  const response=await request(app).get('/api/v1/admin/users').set('Authorization',`Bearer ${token}`);
  expect(response.status).toBe(403);expect(response.body.error.code).toBe('FORBIDDEN');
 }
});
it('returns the existing JSON rate-limit response and Retry-After without further credential lookups',async()=>{
 for(let i=0;i<10;i++) expect((await request(app).post('/api/v1/auth/login').send({username:user.username,password:'wrong'})).status).toBe(401);
 const blocked=await request(app).post('/api/v1/auth/login').send({username:user.username,password});
 expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe('RATE_LIMITED');expect(blocked.headers['retry-after']).toBeTruthy();
 expect(findUnique).toHaveBeenCalledTimes(10);
});
