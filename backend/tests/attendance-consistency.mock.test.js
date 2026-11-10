import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { attendanceDay } from '../src/events.js';

// Exercise the existing shared HTTP handlers with a memory-only persistence
// adapter. No real child, attendance record, token or database connection.
const secret=randomUUID()+randomUUID(),now=new Date('2026-10-23T06:00:00Z');
let app, state, users, child;
const auth=user=>`Bearer ${jwt.sign({},secret,{subject:user.id,issuer:'childguard',audience:'childguard-app',expiresIn:'1h'})}`;
const confirm=(user,body={})=>request(app).post('/api/v1/attendance/arrival/confirm').set('Authorization',auth(user)).send(body);
beforeEach(()=>{
 users=Object.fromEntries(['ADMIN','TEACHER','PARENT'].map(role=>[role,{id:randomUUID(),username:`synthetic-${role}`,role,centerId:'center-a',active:true}]));
 users.OUTSIDE={id:randomUUID(),username:'synthetic-outside',role:'TEACHER',centerId:'center-b',active:true};
 child={id:randomUUID(),name:'Synthetic child',centerId:'center-a'};
 state={attendance:{id:'arrival',childId:child.id,day:attendanceDay(now),status:'CHECKIN_PENDING',gatePassAuthorized:false},confirmations:[],audits:[],sessions:[]};
 const auditMatches=(row,where)=>where.action?.in ? where.action.in.includes(row.action) : where.action?.startsWith ? row.action.startsWith(where.action.startsWith) : row.action===where.action;
 const db={
  user:{findUnique:vi.fn(async({where})=>Object.values(users).find(u=>u.id===where.id)??null)},
  child:{findFirst:vi.fn(async({where})=>where.id===child.id&&where.centerId===child.centerId&&(!where.guardians||where.guardians.some.userId===users.PARENT.id)?child:null)},
  $queryRaw:vi.fn(async()=>[{now}]),
  attendance:{
   findFirst:vi.fn(async({where})=>where.id===state.attendance.id&&where.child.centerId===child.centerId?{...state.attendance}:null),
   findUnique:vi.fn(async()=>({...state.attendance})),
   findMany:vi.fn(async({where})=>(where.childId&&where.childId!==child.id)||(where.child&&where.child.centerId!==child.centerId)?[]:[{...state.attendance,child:{id:child.id,name:child.name},observations:[],confirmations:state.confirmations.map(c=>({...c,user:users.TEACHER}))}]),
   update:vi.fn(async({data})=>Object.assign(state.attendance,data)),
  },
  confirmation:{findUnique:vi.fn(async()=>state.confirmations[0]??null),upsert:vi.fn(async({create})=>{state.confirmations.push(create);return create;})},
  auditLog:{create:vi.fn(async({data})=>{state.audits.push(data);return data;}),findFirst:vi.fn(async({where})=>state.audits.find(row=>row.resourceId===where.resourceId&&auditMatches(row,where))??null),findMany:vi.fn(async({where})=>state.audits.filter(row=>auditMatches(row,where)))},
  activityAttendanceSession:{upsert:vi.fn(async({create})=>{state.sessions.push(create);return create;})},
 };
 db.$transaction=async work=>{const saved=structuredClone(state);try{return await work(db);}catch(error){state=saved;throw error;}};
 app=createApp({db,jwtSecret:secret,environment:'test',enableDevAttendanceReset:'false',logger:{error(){}}});
});

it('rejects Parent confirmation without changing shared attendance',async()=>{
 expect((await confirm(users.PARENT)).status).toBe(403);expect(state.attendance.status).toBe('CHECKIN_PENDING');expect(state.confirmations).toEqual([]);
});
it('rejects unrelated-center Teacher confirmation',async()=>{
 expect((await confirm(users.OUTSIDE)).status).toBe(404);expect(state.attendance.status).toBe('CHECKIN_PENDING');
});
it('Teacher confirmation and retry are visible through the same Parent and Admin reads',async()=>{
 for(let retry=0;retry<2;retry++) {const r=await confirm(users.TEACHER);expect(r.status).toBe(200);expect(r.body.data.status).toBe('PRESENT');}
 expect(state.confirmations).toHaveLength(1);expect(state.audits).toHaveLength(1);expect(state.sessions).toHaveLength(1);
 const parent=await request(app).get(`/api/v1/mobile/children/${child.id}/attendance`).set('Authorization',auth(users.PARENT));
 const admin=await request(app).get('/api/v1/attendance').set('Authorization',auth(users.ADMIN));
 expect(parent.status).toBe(200);expect(admin.status).toBe(200);
 expect(parent.body.data[0].status).toBe('PRESENT');expect(admin.body.data[0].status).toBe('PRESENT');
 expect(admin.body.data[0].confirmations[0].roleAtConfirmation).toBe('TEACHER');
});
it('rejects stale prior-day confirmation without modifying it',async()=>{
 state.attendance.day='2026-10-22';expect((await confirm(users.TEACHER)).status).toBe(409);expect(state.confirmations).toEqual([]);
});
it('rejects missing attendance IDs',async()=>{
 const r=await request(app).post(`/api/v1/attendance/${randomUUID()}/confirm`).set('Authorization',auth(users.TEACHER)).send({});
 expect(r.status).toBe(404);expect(state.confirmations).toEqual([]);
});
it('rejects a stale attendance reset epoch',async()=>{
 state.audits.push({id:'current-epoch',resourceId:'arrival',action:'ATTENDANCE_DEV_RESET',createdAt:now});
 const r=await confirm(users.TEACHER,{attendanceEpoch:'old-epoch'});
 expect(r.status).toBe(409);expect(r.body.error.code).toBe('ATTENDANCE_CYCLE_CHANGED');expect(state.confirmations).toEqual([]);
});
