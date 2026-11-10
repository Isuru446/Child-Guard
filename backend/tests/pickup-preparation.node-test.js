import test from 'node:test';
import assert from 'node:assert/strict';
import { appliedPickupHashes, comparePickupLedger, verifyPickupStage, pickupReview } from '../src/pickup-preparation.js';
import { pickupClientPolicy, verifyPickupClientMetadata } from '../src/pickup-client-policy.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ledger=()=>Object.entries(appliedPickupHashes).map(([migration_name,checksum])=>({migration_name,checksum:checksum.toLowerCase(),finished:true,rolled_back:false}));
test('ledger comparison accepts exact nine reviewed sources and only Pickup pending',()=>assert.deepEqual(comparePickupLedger(ledger()),{applied:9,onlyPending:pickupReview.name}));
for(const kind of ['checksum','missing','additional','duplicate','unfinished','rolledback'])test('ledger proof refuses '+kind,()=>{
 const rows=ledger();if(kind==='checksum')rows[0].checksum='0'.repeat(64);if(kind==='missing')rows.pop();if(kind==='additional')rows.push({migration_name:'unrelated'});if(kind==='duplicate')rows[1]=rows[0];if(kind==='unfinished')rows[0].finished=false;if(kind==='rolledback')rows[0].rolled_back=true;
 assert.throws(()=>comparePickupLedger(rows));
});
test('separately staged geofence source matches its original reviewed hash',()=>{
 const bytes=readFileSync(new URL('../prisma/review/geofence/prototype-migration.sql',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),appliedPickupHashes[pickupReview.geofence]);
});
test('Pickup policy adds three models without changing historical model manifest',()=>{
 assert.equal(pickupClientPolicy.models.length,31);assert.match(pickupClientPolicy.generationApproval,/REQUIRES_MAINTENANCE/);
});
test('old active generated client is refused by Pickup metadata policy',()=>{
 const source=readFileSync(new URL('../node_modules/.prisma/client/index.js',import.meta.url),'utf8');
 const config=JSON.parse(/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source)[1]);
 const prefix='config.runtimeDataModel = JSON.parse(';const line=source.split(/\r?\n/).find(line=>line.startsWith(prefix));const model=JSON.parse(JSON.parse(line.slice(prefix.length,-1)));
 assert.throws(()=>verifyPickupClientMetadata(config,model));
});
test('stage verifier refuses arbitrary folders rather than invoking a migration runner',()=>assert.throws(()=>verifyPickupStage('D:\\ChildGuard-V2\\backend')));
test('owner-supplied ledger matches every original reviewed checksum',()=>{
 const rows=JSON.parse(readFileSync(new URL('../prisma/review/pickup/owner-ledger-20261026.json',import.meta.url),'utf8'));
 assert.equal(comparePickupLedger(rows).onlyPending,pickupReview.name);
});
test('postflight requires exactly one new successful Pickup entry without changing prior hashes',()=>{
 const rows=ledger();rows.push({migration_name:pickupReview.name,checksum:pickupReview.sql,finished:true,rolled_back:false,applied_steps_count:1});
 assert.deepEqual(comparePickupLedger(rows,{after:true}),{applied:10,onlyPending:null});assert.throws(()=>comparePickupLedger(rows));
 rows.at(-1).checksum='0'.repeat(64);assert.throws(()=>comparePickupLedger(rows,{after:true}));
});
test('future metadata may pass compatibility but never approves its generated-file hashes',()=>{
 const source=readFileSync(new URL('../node_modules/.prisma/client/index.js',import.meta.url),'utf8');
 const config=JSON.parse(/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source)[1]);
 const prefix='config.runtimeDataModel = JSON.parse(';const line=source.split(/\r?\n/).find(line=>line.startsWith(prefix));const model=JSON.parse(JSON.parse(line.slice(prefix.length,-1)));
 const schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
 for(const name of ['PickupPhoto','AuthorizedPickupPerson','PickupRequest']){
  const block=new RegExp('model '+name+' \\{([\\s\\S]*?)^\\}','m').exec(schema)[1];
  model.models[name]={fields:block.split(/\r?\n/).flatMap(line=>{const match=/^\s*(\w+)\s+([\w]+)(\?|\[\])?/.exec(line);if(!match)return [];return [{name:match[1],type:match[2],kind:['String','Int','DateTime','Json','Bytes','Boolean'].includes(match[2])?'scalar':'object',isRequired:match[3]!=='?',isList:match[3]==='[]'}];})};
 }
 assert.deepEqual(verifyPickupClientMetadata(config,model),{metadataCompatible:true,models:31,generatedHashesApproved:false});
 model.models.PickupPhoto.fields.find(field=>field.name==='bytes').type='String';assert.throws(()=>verifyPickupClientMetadata(config,model));
});
