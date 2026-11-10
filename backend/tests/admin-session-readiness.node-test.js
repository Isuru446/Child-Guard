import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sessionFixture } from './helpers/admin-session-memory.js';
import { adminSessionWriteBoundary,adminWriteInventory } from '../src/admin-session-write-boundary.js';
import { baseline } from '../src/baseline-manifest.js';
import { adminForwardHashes } from '../src/admin-session-forward-manifest.js';
import { validateForwardLedger,sessionMigrationName,validateForwardSnapshot,validateForwardColumns,inspectAdminForwardMigration } from '../src/admin-session-migration-readiness.js';
const rejected=code=>e=>e.code===code;
const changePassword=f=>{f.state.user.passwordHash='$2b$12$'+'A'.repeat(53);f.state.user.authVersion++;Object.assign(f.state.sessions[0],{revokedAt:new Date(f.clock),revokeReason:'ACCOUNT_CHANGED',revision:1});};
test('self password change commits exactly its revocation instead of rolling back the password',async()=>{
 const f=sessionFixture(),a=await f.login();
 const result=await f.service.withPasswordChange(a.credential,a.csrfToken,async db=>{changePassword(f);db.domain.push('PASSWORD_CHANGED');return {changed:true};});
 assert.deepEqual(result,{changed:true});assert.equal(f.state.user.authVersion,1);assert.equal(f.state.sessions[0].revokeReason,'ACCOUNT_CHANGED');
 await assert.rejects(f.service.validate(a.credential),rejected('SESSION_REVOKED'));
});
for(const kind of ['expiry','role-change','not-revoked'])test('password operation refuses '+kind+' and rolls back',async()=>{
 const f=sessionFixture(),a=await f.login();
 await assert.rejects(f.service.withPasswordChange(a.credential,a.csrfToken,async()=>{
  changePassword(f);if(kind==='expiry')f.tick(300000);if(kind==='role-change')f.state.user.role='TEACHER';if(kind==='not-revoked')f.state.sessions[0].revokedAt=null;
 }));assert.equal(f.state.user.passwordHash,'verified-hash');assert.equal(f.state.user.authVersion,0);assert.equal(f.state.sessions[0].revokedAt,null);
});
test('normal write boundary still refuses self invalidation; no generic bypass was added',async()=>{
 const f=sessionFixture(),a=await f.login();await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,()=>changePassword(f)),rejected('SESSION_REVOKED'));
});
test('controlled business conflicts preserve status/code without exposing unknown engine exceptions',async()=>{
 const f=sessionFixture(),a=await f.login();
 await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,()=>{throw Object.assign(Error('Child unavailable'),{status:404,code:'NOT_FOUND'});}),e=>e.status===404&&e.code==='NOT_FOUND');
 await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,()=>{throw Error('synthetic-private-engine-text');}),e=>e.status===503&&!e.message.includes('private-engine'));
});
test('retryable transaction codes survive safely for the existing serial helper',async()=>{
 const f=sessionFixture(),a=await f.login();await assert.rejects(f.service.withMutation(a.credential,a.csrfToken,()=>{throw Object.assign(Error('synthetic-private-details'),{code:'P2034'});}),e=>e.code==='P2034'&&!e.message.includes('private-details'));
});
test('request facade refuses direct/unknown writes and nested transactions',async()=>{
 const base={user:{create(){throw Error('unexpected base write');}},$transaction:async work=>work({})};const scope=adminSessionWriteBoundary(base);
 const req={method:'POST',path:'/api/v1/admin/users',user:{role:'ADMIN'},withAdminMutation:(work,level)=>{assert.equal(level,'Serializable');return work({},req.user);}};
 await scope.run(req,async()=>{
  assert.throws(()=>scope.database.user.create({}),rejected('SESSION_BOUND_TRANSACTION_REQUIRED'));
  await assert.rejects(scope.database.$transaction([],{}),rejected('SESSION_BOUND_TRANSACTION_REQUIRED'));
 });
});
test('facade passes legacy/mobile transactions through unchanged when no cookie scope exists',async()=>{
 let opts;const base={$transaction:async(work,o)=>{opts=o;return work({legacy:true});}};
 const scope=adminSessionWriteBoundary(base);assert.equal(await scope.database.$transaction(tx=>tx.legacy,{isolationLevel:'Serializable'}),true);assert.deepEqual(opts,{isolationLevel:'Serializable'});
});
const ledger=()=>Object.entries(baseline.hashes).filter(([p])=>p.endsWith('migration.sql')).map(([p,checksum])=>({name:p.split('/')[2],checksum,finished:true,notRolledBack:true,steps:1}));
const hash=adminForwardHashes['prisma/migrations/'+sessionMigrationName+'/migration.sql'];
test('forward ledger allows exactly seven before and eight after, with original baseline checks',()=>{
 assert.doesNotThrow(()=>validateForwardLedger(ledger(),'before',hash));
 assert.doesNotThrow(()=>validateForwardLedger([...ledger(),{name:sessionMigrationName,checksum:hash,finished:true,notRolledBack:true,steps:1}],'after',hash));
});
for(const kind of ['missing','extra','duplicate','wrong-checksum','failed','rolled-back'])test('forward ledger refuses '+kind,()=>{
 const rows=[...ledger(),{name:sessionMigrationName,checksum:hash,finished:true,notRolledBack:true,steps:1}];
 if(kind==='missing')rows.pop();if(kind==='extra')rows.push({...rows[0],name:'unexpected'});if(kind==='duplicate')rows.push({...rows[0]});if(kind==='wrong-checksum')rows[7].checksum='B'.repeat(64);if(kind==='failed')rows[7].finished=false;if(kind==='rolled-back')rows[7].notRolledBack=false;
 assert.throws(()=>validateForwardLedger(rows,'after',hash));
});
test('all baseline SQL and reviewed forward pins match; new privileges precede trigger inside one transaction',()=>{
 for(const [p,h] of Object.entries({...baseline.hashes,...adminForwardHashes}))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex').toUpperCase(),h);
 const sql=readFileSync(new URL('../prisma/migrations/'+sessionMigrationName+'/migration.sql',import.meta.url),'utf8');
 assert.ok(sql.indexOf('BEGIN;')<sql.indexOf('GRANT SELECT, INSERT, UPDATE ON public."AuthSession" TO childguard_v2_app'));
 assert.ok(sql.indexOf('GRANT SELECT, INSERT, UPDATE ON public."AuthSession" TO childguard_v2_app')<sql.indexOf('CREATE TRIGGER'));
 assert.ok(sql.indexOf('CREATE TRIGGER')<sql.indexOf('COMMIT;'));assert.match(sql,/current_database\(\) <> 'childguard_v2'/);assert.match(sql,/inet_server_port\(\) IS DISTINCT FROM 5432/);
 assert.ok(!/GRANT ALL|SECURITY DEFINER|ALTER ROLE|CREATE ROLE/i.test(sql.replace(/--[^\r\n]*/g,'')));
});
test('inventory remains explicit and excludes unsupported Parent-only writes',()=>{assert.equal(adminWriteInventory.length,27);for(const path of ['/api/v1/admin/devices','/api/v1/admin/devices/:id/assignment','/api/v1/admin/devices/:id/unassign'])assert.ok(adminWriteInventory.some(r=>r.method==='POST'&&r.path===path));assert.ok(adminWriteInventory.some(r=>r.method==='PATCH'&&r.path==='/api/v1/admin/devices/:id/status'));assert.ok(adminWriteInventory.some(r=>r.method==='PATCH'&&r.path==='/api/v1/admin/users/:id/profile'));assert.ok(adminWriteInventory.some(r=>r.method==='POST'&&r.path==='/api/v1/admin/children'));assert.ok(adminWriteInventory.some(r=>r.method==='DELETE'&&r.path==='/api/v1/admin/users/:id/guardians'));assert.ok(!adminWriteInventory.some(r=>r.path==='/api/v1/account/children'));});
const owner='childguard_v2_migrator';
test('zone configuration has one explicit session-bound mutation and no arbitrary zone-ID write',()=>{assert.ok(adminWriteInventory.some(r=>r.method==='PUT'&&r.path==='/api/v1/safe-zones'));assert.ok(!adminWriteInventory.some(r=>r.path==='/api/v1/safe-zones/:id'));});
const sql=readFileSync(new URL('../prisma/migrations/'+sessionMigrationName+'/migration.sql',import.meta.url),'utf8');
const functionSource=/CREATE FUNCTION public\.childguard_invalidate_admin_sessions\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(sql)[1];
function baselineSnapshot(){
 const types=[...baseline.tables,'_prisma_migrations'].map(name=>({name,kind:'c',owner,element:null})).concat(Object.keys(baseline.enums).map(name=>({name,kind:'e',owner,element:null})));
 return {schemas:0,extensions:0,otherObjects:0,types:[...types,...types.map(t=>({name:'_'+t.name,kind:'b',owner,element:t.name}))],
 tables:[...baseline.tables,'_prisma_migrations'].map(name=>({name,owner,kind:'r',rls:false,forcedRls:false})),enums:Object.entries(baseline.enums).map(([name,labels])=>({name,labels,owner})),
 constraints:baseline.constraints.map(c=>({...structuredClone(c),validated:true,enforced:true,noInherit:false,deferrable:false,deferred:false,referenceSchema:c.type==='f'?'public':null,match:'s'})),
 indexes:[...baseline.indexes,...baseline.constraints.filter(c=>c.type==='p').map(c=>({...c,unique:true,predicate:null}))].map(i=>({...structuredClone(i),owner,method:'btree',valid:true,ready:true,live:true,expressions:false,nullsNotDistinct:false,keys:i.columns.length,options:i.columns.map(()=>0)})),
 functions:[{name:'enforce_assignment_center',owner,language:'plpgsql',returnType:'trigger',arguments:0,kind:'f',securityDefiner:false,config:null,volatility:'v',strict:false,source:baseline.functionSource}],
 triggers:[{name:'assignment_center',table:'Assignment',functionSchema:'public',function:'enforce_assignment_center',type:23,enabled:'O',arguments:0,condition:null,columns:[],constraint:false,oldTransition:null,newTransition:null}],
 runtime:['childguard_v2_app','childguard_v2_test_app'].map(name=>({name,schemaCreate:false,databaseCreate:false,memberships:false,superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false,ledgerAccess:false,ledgerColumnAccess:false}))};
}
function afterSnapshot(){
 const s=baselineSnapshot();s.tables.push({name:'AuthSession',owner,kind:'r',rls:false,forcedRls:false});s.types.push({name:'AuthSession',owner,kind:'c',element:null},{name:'_AuthSession',owner,kind:'b',element:'AuthSession'});
 const common={validated:true,enforced:true,noInherit:false,deferrable:false,deferred:false};
 for(const [,name,expression] of sql.matchAll(/CONSTRAINT "([^"]+)" CHECK \((.*)\)/g))s.constraints.push({...common,table:name.startsWith('User_')?'User':'AuthSession',name,type:'c',expression});
 s.constraints.push({...common,table:'AuthSession',name:'AuthSession_pkey',type:'p',columns:['id']});
 for(const table of ['User','Center'])s.constraints.push({...common,table:'AuthSession',name:'AuthSession_'+(table==='User'?'userId':'centerId')+'_fkey',type:'f',columns:[table==='User'?'userId':'centerId'],referenceSchema:'public',reference:table,referenceColumns:['id'],delete:'r',update:'r',match:'s'});
 for(const [name,columns] of Object.entries({AuthSession_pkey:['id'],AuthSession_credentialHash_key:['credentialHash'],AuthSession_userId_revokedAt_idx:['userId','revokedAt'],AuthSession_absoluteExpiresAt_idx:['absoluteExpiresAt'],AuthSession_idleExpiresAt_idx:['idleExpiresAt'],AuthSession_centerId_idx:['centerId']}))s.indexes.push({name,columns,table:'AuthSession',owner,method:'btree',valid:true,ready:true,live:true,expressions:false,nullsNotDistinct:false,predicate:null,unique:['AuthSession_pkey','AuthSession_credentialHash_key'].includes(name),keys:columns.length,options:columns.map(()=>0)});
 s.functions.push({name:'childguard_invalidate_admin_sessions',owner,language:'plpgsql',returnType:'trigger',arguments:0,kind:'f',securityDefiner:false,config:['search_path=pg_catalog, public'],volatility:'v',strict:false,source:functionSource});
 s.triggers.push({name:'User_invalidate_admin_sessions',table:'User',functionSchema:'public',function:'childguard_invalidate_admin_sessions',type:19,enabled:'O',arguments:0,condition:null,columns:[3,5,4,6,7],constraint:false,oldTransition:null,newTransition:null});return s;
}
function columns(){
 const body=sql.split('CREATE TABLE "AuthSession" (')[1].split(');')[0];const types={TEXT:'text',INTEGER:'integer','CHAR(64)':'character(64)','TIMESTAMPTZ(3)':'timestamp(3) with time zone','"Role"':'"Role"'};
 return [...body.matchAll(/^  "(\w+)" (TEXT|INTEGER|CHAR\(64\)|TIMESTAMPTZ\(3\)|"Role")(.*),$/gm)].map(([,name,t,tail])=>{
  let def=tail.includes(' DEFAULT ')?tail.split(' DEFAULT ')[1].trim():null;if(def?.startsWith("'"))def+='::'+types[t];return {table:'AuthSession',name,type:types[t],required:tail.includes('NOT NULL'),default:def};
 }).concat({table:'User',name:'authVersion',type:'integer',required:true,default:'0'});
}
test('forward catalog accepts additive schema while retaining all original baseline checks',()=>{
 assert.doesNotThrow(()=>validateForwardSnapshot(baselineSnapshot(),'before',functionSource));assert.doesNotThrow(()=>validateForwardSnapshot(afterSnapshot(),'after',functionSource));assert.doesNotThrow(()=>validateForwardColumns(columns()));
});
for(const kind of ['missing-trigger','disabled-trigger','function-body','function-owner','fk-delete','check-expression','missing-index','extra-table'])test('forward catalog rejects '+kind,()=>{
 const s=afterSnapshot();if(kind==='missing-trigger')s.triggers.pop();if(kind==='disabled-trigger')s.triggers.at(-1).enabled='D';if(kind==='function-body')s.functions.at(-1).source+='\n-- changed';if(kind==='function-owner')s.functions.at(-1).owner='childguard_v2_app';if(kind==='fk-delete')s.constraints.at(-1).delete='c';if(kind==='check-expression')s.constraints.find(c=>c.name==='AuthSession_idle_limit').expression='"idleExpiresAt" <= "lastActivityAt"';if(kind==='missing-index')s.indexes.pop();if(kind==='extra-table')s.tables.push({name:'unexpected',owner,kind:'r',rls:false,forcedRls:false});assert.throws(()=>validateForwardSnapshot(s,'after',functionSource));
});
for(const kind of ['missing-column','wrong-type','wrong-default','nullable-version'])test('forward columns reject '+kind,()=>{
 const rows=columns();if(kind==='missing-column')rows.pop();if(kind==='wrong-type')rows[0].type='uuid';if(kind==='wrong-default')rows.at(-1).default='1';if(kind==='nullable-version')rows.at(-1).required=false;assert.throws(()=>validateForwardColumns(rows));
});
function inspectionMock(phase,options={}) {
 const identity={name:'childguard_v2',role:owner,login:owner,schema:'public',host:'127.0.0.1',port:5432,version:180006,
 superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false,canLogin:true,memberships:false,
 databaseOwner:'reviewed_v2_owner',schemaOwner:'pg_database_owner',connect:true,databaseCreate:false,temp:false,usage:true,schemaCreate:true,runtimeCreate:false,publicCreate:false,plpgsql:true,...options.identity};
 const preserved={users:1,admins:1,usersFingerprint:'a'.repeat(32),centersFingerprint:'b'.repeat(32)};const calls=[];
 const db={$queryRaw:async(strings)=>{const text=strings.join('?');calls.push(text);assert.match(text,/^SELECT\b/);
  if(text.includes('current_database() AS name'))return [identity];
  if(text.includes('jsonb_build_object('))return [{snapshot:phase==='before'?baselineSnapshot():afterSnapshot()}];
  if(text.includes('FROM public._prisma_migrations'))return phase==='before'?ledger():[...ledger(),{name:sessionMigrationName,checksum:hash,finished:true,notRolledBack:true,steps:1}];
  if(text.includes('usersFingerprint'))return [{...preserved,version:phase==='after',...options.preserved}];
  if(text.includes(' AS sessions'))return [{sessions:0,changed:0,dml:true,excessive:false,execute:true,publicExecute:false,otherTableAcl:false,otherFunctionAcl:false,...options.privileges}];
  if(text.includes('format_type'))return columns();
  throw Error('Unexpected query');
 }};
 return {db,calls,preserved};
}
test('forward inspection uses only SELECTs, requires existing Admin and preserves private fingerprints',async()=>{
 const before=inspectionMock('before');const evidence=await inspectAdminForwardMigration(before.db,{phase:'before',checksum:hash,functionSource});
 const after=inspectionMock('after');const result=await inspectAdminForwardMigration(after.db,{phase:'after',checksum:hash,functionSource,before:evidence});
 assert.equal(result.users,1);assert.equal(after.calls.length,6);assert.ok(!JSON.stringify(result).includes('passwordHash'));
});
for(const [key,value] of Object.entries({name:'other_database',role:'childguard_v2_app',host:'localhost',port:5433,superuser:true}))test('forward target rejects '+key+' before schema or data inspection',async()=>{
 const f=inspectionMock('before',{identity:{[key]:value}});await assert.rejects(inspectAdminForwardMigration(f.db,{phase:'before',checksum:hash,functionSource}));assert.equal(f.calls.length,1);
});
for(const [key,value] of Object.entries({dml:false,excessive:true,execute:false,publicExecute:true,otherTableAcl:true,otherFunctionAcl:true,sessions:1,changed:1}))test('post-forward verification rejects '+key,async()=>{
 const f=inspectionMock('after',{privileges:{[key]:value}});await assert.rejects(inspectAdminForwardMigration(f.db,{phase:'after',checksum:hash,functionSource,before:f.preserved}));
});
test('post-forward verification refuses changed Admin credentials/counts instead of accepting migration success alone',async()=>{
 const f=inspectionMock('after',{preserved:{usersFingerprint:'c'.repeat(32)}});await assert.rejects(inspectAdminForwardMigration(f.db,{phase:'after',checksum:hash,functionSource,before:f.preserved}));
});
const {execFileSync}=await import('node:child_process');
test('PowerShell staging helper parses under installed policy and its only operation is file staging/verification',()=>{
 const text=readFileSync(new URL('../../scripts/New-V2AdminSessionMigrationStage.ps1',import.meta.url),'utf8');
 for(const h of Object.values(adminForwardHashes))assert.ok(text.includes(h));
 assert.ok(text.includes('$stageFiles.Count -ne 11'));assert.ok(text.includes('VerifyExistingStage'));assert.ok(!/migrate deploy|pg_dump|pg_restore|psql|Read-Host/i.test(text));
 const cmd=String.raw`$tokens=$null;$errors=$null;$a=[Management.Automation.Language.Parser]::ParseFile('D:\ChildGuard-V2\scripts\New-V2AdminSessionMigrationStage.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Parser failed'};$r=$a.FindAll({param($x) $x -is [Management.Automation.Language.StringConstantExpressionAst] -and $x.Value.StartsWith('\AD:')},$true)[0].Value;if(-not [regex]::IsMatch('D:\ChildGuard-V2\.admin-session-stage-12345678-1234-4234-8234-123456789abc',$r)){throw 'Valid path refused'};if([regex]::IsMatch('D:\ChildGuard-V2\backend',$r)){throw 'Wrong path accepted'};'Stage parser and path-policy checks PASSED'`;
 assert.match(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',windowsHide:true}),/PASSED/);
});
test('forward verifier entry cannot deploy and never loads runtime configuration',()=>{
 const text=readFileSync(new URL('../scripts/verify-v2-admin-session-migration.js',import.meta.url),'utf8');
 assert.ok(text.includes("validateMigrationEnvironment('development',process.env)"));assert.ok(text.includes('finally {if(db)'));assert.ok(!text.includes('loadDevelopmentEnvironment'));assert.ok(!/\$executeRaw|migrate deploy|child_process/.test(text));
});
