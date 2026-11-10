import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SessionService } from '../src/admin-session-service.js';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { baseline } from '../src/baseline-manifest.js';
import { adminSessionRepository } from '../src/admin-session-repository.js';
const rejected=(code)=>error=>error.code===code;
test('opaque random sessions store digests only; no bearer selected by caller policy',async()=>{
 const f=sessionFixture(), a=await f.login(), b=await f.login();
 assert.notEqual(a.credential,b.credential);assert.equal(Buffer.from(a.credential,'base64url').length,32);
 assert.equal(f.state.sessions[0].clientKind,'ADMIN_WEB');assert.equal(f.state.sessions[0].roleAtLogin,'ADMIN');
 assert.equal(JSON.stringify(f.state).includes(a.credential),false);assert.equal(JSON.stringify(f.state).includes(a.csrfToken),false);
 assert.equal(+a.session.idleExpiresAt-f.clock,300000);assert.equal(+a.session.absoluteExpiresAt-f.clock,28800000);
});
test('polling and refresh validation never extend five-minute inactivity; exact deadline refuses',async()=>{
 const f=sessionFixture(),a=await f.login();
 for(let i=0;i<19;i++){f.tick(15000);await f.service.validate(a.credential);}
 assert.equal(f.updates,0);assert.equal(+f.state.sessions[0].lastActivityAt,Date.parse('2026-10-25T08:00:00.000Z'));
 f.tick(14999);await f.service.validate(a.credential);f.tick(1);
 await assert.rejects(f.service.validate(a.credential),rejected('SESSION_EXPIRED'));
 await assert.rejects(f.service.activity(a.credential,a.csrfToken,randomUUID()),rejected('SESSION_EXPIRED'));assert.equal(f.updates,0);
});
test('only valid explicit activity renews by receipt time; timestamps are not supplied by client',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(200000);
 const result=await f.service.activity(a.credential,a.csrfToken,randomUUID());
 assert.equal(+result.idleExpiresAt,f.clock+300000);f.tick(299999);await f.service.validate(a.credential);f.tick(1);
 await assert.rejects(f.service.validate(a.credential),rejected('SESSION_EXPIRED'));
});
test('duplicate concurrent interaction IDs serialize and update once, including UUID casing',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(15000);const id=randomUUID();
 await Promise.all([f.service.activity(a.credential,a.csrfToken,id),f.service.activity(a.credential,a.csrfToken,id.toUpperCase())]);
 assert.equal(f.updates,1);assert.equal(f.state.sessions[0].revision,1);
});
test('logout revokes server session idempotently; activity cannot revive it',async()=>{
 const f=sessionFixture(),a=await f.login();await f.service.revoke(a.credential,a.csrfToken);await f.service.revoke(a.credential);
 await assert.rejects(f.service.validate(a.credential),rejected('SESSION_REVOKED'));
 await assert.rejects(f.service.activity(a.credential,a.csrfToken,randomUUID()),rejected('SESSION_REVOKED'));assert.equal(f.updates,1);
 assert.deepEqual(f.state.audits.map(a=>a.action),['ADMIN_SESSION_CREATED','ADMIN_SESSION_REVOKED']);
});
test('logout winning a concurrent activity race prevents renewal',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(5000);
 const results=await Promise.allSettled([f.service.revoke(a.credential,a.csrfToken),f.service.activity(a.credential,a.csrfToken,randomUUID())]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.code,'SESSION_REVOKED');assert.equal(f.updates,1);
});
for(const [key,value] of Object.entries({active:false,role:'TEACHER',centerId:'other-center',authVersion:1}))
 test('current user '+key+' change revokes authority on every read and activity',async()=>{
  const f=sessionFixture(),a=await f.login();f.state.user[key]=value;
  await assert.rejects(f.service.validate(a.credential),rejected('SESSION_REVOKED'));
  await assert.rejects(f.service.activity(a.credential,a.csrfToken,randomUUID()),rejected('SESSION_REVOKED'));
 });
for(const token of [undefined,'bad','A'.repeat(43)]) test('bad CSRF rejects renewal and live logout '+String(token?.length),async()=>{
 const f=sessionFixture(),a=await f.login();
 await assert.rejects(f.service.activity(a.credential,token,randomUUID()),rejected('CSRF_INVALID'));
 await assert.rejects(f.service.revoke(a.credential,token),rejected('CSRF_INVALID'));assert.equal(f.updates,0);
});
test('CSRF cannot be used across sessions or after server-key change',async()=>{
 const f=sessionFixture(),a=await f.login(),b=await f.login();
 await assert.rejects(f.service.activity(a.credential,b.csrfToken,randomUUID()),rejected('CSRF_INVALID'));
 const restarted=new SessionService({repository:f.repository,csrfKey:Buffer.alloc(32,7)});
 await assert.rejects(restarted.validate(a.credential),rejected('SESSION_REVOKED'));
});
test('service restart with the same key restores a session without idle extension',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(1000);
 const restarted=new SessionService({repository:f.repository,csrfKey:f.csrfKey});const restored=await restarted.validate(a.credential);
 assert.equal(restored.csrfToken,a.csrfToken);assert.equal(+restored.session.idleExpiresAt,+a.session.idleExpiresAt);assert.equal(f.updates,0);
});
test('password verification cannot race account edits at session creation',async()=>{
 const f=sessionFixture();f.state.user.passwordHash='changed';await assert.rejects(f.login(),rejected('INVALID_CREDENTIALS'));assert.equal(f.state.sessions.length,0);
});
test('credential verification must belong to the same locked user',async()=>{
 const f=sessionFixture();await assert.rejects(f.service.create({userId:'other-user',verifiedPasswordHash:'verified-hash'}),rejected('INVALID_CREDENTIALS'));assert.equal(f.state.sessions.length,0);
});
test('non-admin users cannot select Admin or mobile policy',async()=>{
 const f=sessionFixture();f.state.user.role='TEACHER';await assert.rejects(f.login(),rejected('INVALID_CREDENTIALS'));
});
test('absolute eight-hour ceiling is never extended by activity',async()=>{
 const f=sessionFixture(),a=await f.login();
 for(let i=0;i<96;i++){f.tick(299000);await f.service.activity(a.credential,a.csrfToken,randomUUID());}
 f.tick(95999);await f.service.activity(a.credential,a.csrfToken,randomUUID());
 assert.equal(+f.state.sessions[0].idleExpiresAt,+a.session.absoluteExpiresAt);
 f.tick(1);await assert.rejects(f.service.validate(a.credential),rejected('SESSION_EXPIRED'));
});
test('sensitive mutation crossing expiry rolls back domain writes',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(299999);
 await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,async db=>{db.domain.push('not committed');f.tick(1);}),rejected('SESSION_EXPIRED'));
 assert.deepEqual(f.state.domain,[]);
});
test('mutation rechecks account/session state changed within its own transaction',async()=>{
 const f=sessionFixture(),a=await f.login();
 await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,async db=>{db.domain.push('not committed');f.state.user.authVersion++;f.state.sessions[0].revokedAt=new Date(f.clock);}),rejected('SESSION_REVOKED'));
 assert.deepEqual(f.state.domain,[]);assert.equal(f.state.user.authVersion,0);
});
test('revocation waits for an already-authorized transaction then blocks later writes',async()=>{
 const f=sessionFixture(),a=await f.login();let release,started;
 const begun=new Promise(resolve=>{started=resolve;}), barrier=new Promise(resolve=>{release=resolve;});
 const mutation=f.service.withMutation(a.credential,a.csrfToken,async db=>{started();await barrier;db.domain.push('committed');});
 await begun;const revoked=f.service.revoke(a.credential,a.csrfToken);release();await Promise.all([mutation,revoked]);
 assert.deepEqual(f.state.domain,['committed']);await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,()=>{}),rejected('SESSION_REVOKED'));
});
test('expired logout clears/revokes without restoring any authority',async()=>{
 const f=sessionFixture(),a=await f.login();f.tick(300000);assert.deepEqual(await f.service.revoke(a.credential),{revoked:true});
 await assert.rejects(f.service.validate(a.credential),rejected('SESSION_REVOKED'));
});
test('repository errors are redacted and fail closed',async()=>{
 const service=new SessionService({repository:{forUser(){throw Error('synthetic-private-engine-error');}},csrfKey:Buffer.alloc(32,1)});
 await assert.rejects(service.create({userId:'any'}),e=>e.status===503 && !e.message.includes('private-engine'));
});
test('failed creation audit rolls back the inserted session',async()=>{
 const f=sessionFixture(), original=f.repository.forUser;
 f.repository.forUser=(id,work)=>original(id,tx=>{tx.audit=async()=>{throw Error('synthetic private audit error');};return work(tx);});
 await assert.rejects(f.login(),rejected('SERVICE_UNAVAILABLE'));assert.equal(f.state.sessions.length,0);assert.deepEqual(f.state.audits,[]);
});
test('failed revocation audit rolls back revocation and never reports success',async()=>{
 const f=sessionFixture(),a=await f.login(),original=f.repository.forCredential;
 f.repository.forCredential=(hash,work)=>original(hash,tx=>{tx.audit=async()=>{throw Error('synthetic private audit error');};return work(tx);});
 await assert.rejects(f.service.revoke(a.credential,a.csrfToken),rejected('SERVICE_UNAVAILABLE'));assert.equal(f.state.sessions[0].revokedAt,null);assert.equal(f.state.audits.length,1);
});
function repositoryMock() {
 const f=sessionFixture(), calls=[];
 const tx={
  user:{findUnique:async()=>{calls.push('read-user');return f.state.user;}},
  authSession:{findUnique:async({where,select})=>{calls.push(select?'lookup':'read-session');return select?{id:'session-a',userId:'user-a'}:{id:'session-a',userId:'user-a',revision:0};}},
  $queryRaw:async(strings,...values)=>{const sql=strings.join('?');calls.push({sql,values});return sql.includes('clock_timestamp() AS now')?[{now:new Date(f.clock)}]:sql.startsWith('UPDATE')?[]:[{id:'locked'}];}
 };
 const db={$transaction:async(work,options)=>{assert.deepEqual(options,{isolationLevel:'ReadCommitted',maxWait:5000,timeout:10000});return work(tx);}};
 return {repository:adminSessionRepository(db),calls};
}
test('Prisma repository locks User then session, reloads and reads DB clock after locks',async()=>{
 const f=repositoryMock();
 await f.repository.forCredential('synthetic-hash',async tx=>{await tx.now();await tx.refresh();});
 assert.equal(f.calls[0],'lookup');assert.match(f.calls[1].sql,/FROM public\."User".*FOR UPDATE/);assert.deepEqual(f.calls[1].values,['user-a']);
 assert.equal(f.calls[2],'read-user');assert.match(f.calls[3].sql,/FROM public\."AuthSession".*FOR UPDATE/);assert.equal(f.calls[4],'read-session');assert.match(f.calls[5].sql,/clock_timestamp\(\)/);
});
test('final activity SQL uses DB-clock predicates and parameters, and refuses zero-row renewal',async()=>{
 const f=repositoryMock();await assert.rejects(f.repository.forCredential('hash',tx=>tx.update({lastActivityAt:new Date(),idleExpiresAt:new Date(),lastInteractionId:"synthetic'input"})),rejected('SESSION_EXPIRED'));
 const update=f.calls.filter(c=>c.sql?.startsWith('UPDATE'))[0];
 assert.match(update.sql,/"revokedAt" IS NULL/);assert.match(update.sql,/"idleExpiresAt" > clock_timestamp\(\)/);assert.match(update.sql,/"absoluteExpiresAt" > clock_timestamp\(\)/);
 assert.ok(!update.sql.includes("synthetic'input"));assert.ok(update.values.includes("synthetic'input"));
});
test('all seven baseline migration SQL files are unchanged; additive migration and relations exist',()=>{
 for(const [p,h] of Object.entries(baseline.hashes).filter(([p])=>p.endsWith('migration.sql')))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex').toUpperCase(),h);
 const sql=readFileSync(new URL('../prisma/migrations/202610250001_admin_session_foundation/migration.sql',import.meta.url),'utf8');
 for(const marker of ['ADD COLUMN "authVersion"','CREATE TABLE "AuthSession"','AuthSession_idle_limit','AuthSession_absolute_limit','CREATE TRIGGER','IS DISTINCT FROM OLD."centerId"','IS DISTINCT FROM OLD."passwordHash"'])assert.ok(sql.includes(marker));
 assert.ok(!/DROP\s+(TABLE|COLUMN)|SECURITY DEFINER|CREATE EXTENSION/i.test(sql.replace(/--[^\r\n]*/g,'')));
 assert.ok(sql.indexOf('GRANT SELECT, INSERT, UPDATE ON public."AuthSession" TO childguard_v2_app')<sql.indexOf('CREATE TRIGGER'));
 const schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');assert.ok(schema.includes('model AuthSession'));assert.ok(schema.includes('authVersion Int @default(0)'));
});
test('approved server cookie composition and same-origin React integration are selected',()=>{
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.ok(server.includes("const absoluteAdminPolicy = 'OWNER_ACCEPTED_ADMIN_8H_CEILING'"));
 assert.ok(server.includes('db:prepared.database,adminAuthRouter:prepared.router'));assert.ok(!server.includes('absoluteAdminPolicy = undefined'));
 const main=readFileSync(new URL('../../web_front/src/main.jsx',import.meta.url),'utf8');assert.ok(main.includes('configureAdminCookieClient(adminClient)'));assert.ok(main.includes('<CookieAdminSessionProvider'));
 assert.ok(readFileSync(new URL('../../web_front/vite.config.js',import.meta.url),'utf8').includes('server: adminSessionDevelopmentServer'));
});
