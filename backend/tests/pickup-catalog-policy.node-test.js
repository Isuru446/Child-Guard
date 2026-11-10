import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPickupCatalog} from '../src/pickup-catalog-policy.js';
const evidence=JSON.parse(readFileSync(new URL('../prisma/review/pickup/postflight-catalog-20261026.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
test('reviewed catalog validates 22 semantic constraints and 33 separately verified NOT NULL constraints',()=>{
 assert.deepEqual(verifyPickupCatalog(evidence),{catalogPassed:true,tables:3,nonNotNullConstraints:22,notNullConstraints:33,indexes:9,definitionsAndPrivilegesMatchReviewedSql:true});
});
for(const [name,change] of [
 ['missing FK',e=>{e.constraints=e.constraints.filter(c=>c.conname!=='PickupRequest_childId_fkey');}],
 ['changed check',e=>{e.constraints.find(c=>c.conname==='PickupRequest_attempts').definition='CHECK (true)';}],
 ['missing NOT NULL',e=>{e.constraints.splice(e.constraints.findIndex(c=>c.type==='n'),1);}],
 ['invalid index',e=>{e.indexes[0].indisvalid=false;}],
 ['wrong partial predicate',e=>{e.indexes.find(i=>i.name==='PickupRequest_one_pending').definition+=' OR true';}],
 ['extra grant',e=>{e.grants.push({relname:'PickupPhoto',grantee:'PUBLIC',privilege_type:'SELECT',is_grantable:false});}],
 ['photo UPDATE',e=>{e.tables.find(t=>t.relname==='PickupPhoto').update=true;}],
 ['ledger access',e=>{e.ledgerReadable=true;}],
])test('catalog refuses '+name,()=>{const copy=structuredClone(evidence);change(copy);assert.throws(()=>verifyPickupCatalog(copy),/Pickup catalog refused/);});
