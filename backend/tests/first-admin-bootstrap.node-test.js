import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { bootstrapFirstAdmin, validateBootstrapInput, confirmationPhrase } from '../src/first-admin-bootstrap.js';
const environment = {NODE_ENV:'development',DATABASE_URL:'postgresql://childguard_v2_app:synthetic@127.0.0.1:5432/childguard_v2?schema=public'};
const input = () => ({centerName:'University Center',username:'initial.admin',password:'Synthetic-strong-passphrase',repeatPassword:'Synthetic-strong-passphrase',confirmation:confirmationPhrase});
const identity = () => ({name:'childguard_v2',role:'childguard_v2_app',login:'childguard_v2_app',schema:'public',host:'127.0.0.1',port:5432,version:180006,superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false});
const privileges = () => ({usage:true,ddl:false,databaseDdl:false,dml:true,owner:false,ledger:false});
const safeHash = '$2b$12$'+'A'.repeat(53);
function fixture(options={}) {
  let state = {users:[],centers:[]}; let disconnected=0, factories=0, hashes=0, transactions=0, identityReads=0;
  const calls=[];
  const db={
    $executeRaw:async(strings)=>{assert.equal(strings.join(''), 'LOCK TABLE public."Center", public."User" IN SHARE ROW EXCLUSIVE MODE');calls.push('lock');if(options.lockFailure)throw Error('synthetic lock timeout');return 0;},
    $queryRaw:async(strings)=>{
      const sql=strings.join('?'); calls.push(sql.includes('current_database() AS name')?'identity':'privileges');
      if(sql.includes('current_database() AS name')) {identityReads++;return [{...identity(),...(identityReads===2?options.transactionIdentity:options.identity)}];}
      return [{...privileges(),...options.privileges}];
    },
    user:{count:async()=>options.userCount??state.users.length,findUnique:async()=>options.conflict?{id:'existing'}:null,
      create:async({data})=>{calls.push('user');if(options.insertFailure)throw Error('secret synthetic engine error');state.users.push({...data,id:'user-1'});return {id:'user-1'};}},
    center:{count:async()=>options.centerCount??state.centers.length,create:async({data})=>{calls.push('center');state.centers.push({...data,id:'center-1'});return {id:'center-1'};}},
    $transaction:async(fn,settings)=>{transactions++;assert.deepEqual(settings,{isolationLevel:'ReadCommitted',maxWait:5000,timeout:10000});const before=structuredClone(state);try{const value=await fn(db);if(options.serializationFailure)throw Error('synthetic commit failure');return value;}catch(e){state=before;throw e;}},
    $disconnect:async()=>{disconnected++;if(options.disconnectFailure)throw Error('secret disconnect');}
  };
  const run=(changes={})=>bootstrapFirstAdmin({environment,input:input(),createClient:()=>{factories++;return db;},hash:async(value,cost)=>{hashes++;assert.equal(cost,12);assert.equal(value,input().password);return safeHash;},...changes});
  return {run,calls,get state(){return state;},get disconnected(){return disconnected;},get factories(){return factories;},get hashes(){return hashes;},get transactions(){return transactions;}};
}
const rejection = /^Error: V2 first-admin bootstrap refused; details withheld$/;
test('atomic success creates exactly one active ADMIN and one center with correct link, no fixtures or output hash',async()=>{
 const f=fixture();const result=await f.run();assert.deepEqual(result,{centerName:'University Center',username:'initial.admin',role:'ADMIN'});
 assert.deepEqual(f.state.centers,[{id:'center-1',name:'University Center'}]);
 assert.deepEqual(f.state.users,[{id:'user-1',username:'initial.admin',passwordHash:safeHash,role:'ADMIN',active:true,centerId:'center-1'}]);
 assert.deepEqual(f.calls,['identity','privileges','identity','privileges','lock','center','user']);assert.equal(f.disconnected,1);assert.equal(f.transactions,1);
 await assert.rejects(f.run(),rejection);assert.equal(f.state.centers.length,1);assert.equal(f.state.users.length,1);
});
for(const [key,value] of Object.entries({name:'other',role:'childguard_v2_migrator',login:'other',schema:'other',host:'localhost',port:5433,version:170000,superuser:true,createDb:true,createRole:true,replication:true,bypassRls:true}))
 test('actual identity rejects '+key+' before hashing or transaction',async()=>{const f=fixture({identity:{[key]:value}});await assert.rejects(f.run(),rejection);assert.equal(f.hashes,0);assert.equal(f.transactions,0);assert.equal(f.disconnected,1);});
for(const [key,value] of Object.entries({usage:false,ddl:true,databaseDdl:true,dml:false,owner:true,ledger:true}))
 test('privilege rejection '+key,async()=>{const f=fixture({privileges:{[key]:value}});await assert.rejects(f.run(),rejection);assert.equal(f.transactions,0);assert.equal(f.disconnected,1);});
for(const env of [{...environment,NODE_ENV:'test'},{...environment,DATABASE_URL:environment.DATABASE_URL.replace('/childguard_v2?','/childguard_v2_test?')},{...environment,PGDATABASE:'other'},{NODE_ENV:'development'}])
 test('configuration rejected before client construction '+Object.keys(env).join('-'),async()=>{const f=fixture();await assert.rejects(f.run({environment:env}),rejection);assert.equal(f.factories,0);});
for(const [name,change] of [
 ['missing confirmation',i=>delete i.confirmation],['wrong confirmation',i=>i.confirmation='yes'],
 ['short password',i=>i.password=i.repeatPassword='short'],['long password',i=>i.password=i.repeatPassword='a'.repeat(73)],
 ['bcrypt multibyte limit',i=>i.password=i.repeatPassword='é'.repeat(37)],['mismatch',i=>i.repeatPassword+='x'],
 ['password control',i=>i.password=i.repeatPassword='synthetic\nlongpass'],['bad username',i=>i.username='bad name'],
 ['short username',i=>i.username='ab'],['empty center',i=>i.centerName=''],['terminal escape center',i=>i.centerName='center\x1b[31m']
]) test('input rejected before client: '+name,async()=>{const f=fixture();const i=input();change(i);await assert.rejects(f.run({input:i}),rejection);assert.equal(f.factories,0);});
test('existing minimum-length and unicode password rules remain compatible',()=>{const i=input();i.password=i.repeatPassword='é'.repeat(12);assert.doesNotThrow(()=>validateBootstrapInput(i));});
for(const options of [{userCount:1},{centerCount:1},{conflict:true}]) test('existing data or account conflict refuses without inserts',async()=>{const f=fixture(options);await assert.rejects(f.run(),rejection);assert.deepEqual(f.state,{users:[],centers:[]});assert.ok(!f.calls.includes('center'));assert.equal(f.disconnected,1);});
for(const options of [{insertFailure:true},{serializationFailure:true},{lockFailure:true},{transactionIdentity:{role:'other'}}])
 test('transaction failure rolls back center and never retries '+Object.keys(options)[0],async()=>{const f=fixture(options);await assert.rejects(f.run(),rejection);assert.deepEqual(f.state,{users:[],centers:[]});assert.equal(f.transactions,1);assert.equal(f.disconnected,1);});
test('invalid hash result refuses before write',async()=>{const f=fixture();await assert.rejects(f.run({hash:async()=> 'invalid'}),rejection);assert.equal(f.transactions,0);assert.equal(f.disconnected,1);});
test('real installed bcrypt cost 12 is accepted by existing login comparison',async()=>{const f=fixture();await f.run({hash:bcrypt.hash});assert.equal(bcrypt.getRounds(f.state.users[0].passwordHash),12);assert.equal(await bcrypt.compare(input().password,f.state.users[0].passwordHash),true);});
test('disconnect error is redacted and does not trigger retry',async()=>{const f=fixture({disconnectFailure:true});await assert.rejects(f.run(),rejection);assert.equal(f.transactions,1);assert.equal(f.disconnected,1);});
test('console boundary is TTY-only, no arguments; hidden raw input and cleanup; no implicit setup or server',()=>{
 const source=readFileSync(new URL('../scripts/bootstrap-v2-admin.js',import.meta.url),'utf8');
 for(const marker of ['process.argv.length !== 2','!process.stdin.isTTY','!process.stdout.isTTY','!process.stderr.isTTY','stdin.setRawMode(true)','stdin.setRawMode(Boolean(wasRaw))','input.password = \'\'','datasources: { db: { url } }, log: []'])assert.ok(source.includes(marker));
 assert.ok(source.indexOf('!process.stdin.isTTY')<source.indexOf("await import('../src/development-environment.js')"));
 assert.ok(!/import.*(?:setup|server|app)\.js/.test(source));
});
