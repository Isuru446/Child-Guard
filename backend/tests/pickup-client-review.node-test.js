import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPickupForwardClient} from '../src/verify-pickup-forward-client.js';
import {pickupForwardClientIntegrity as pins} from '../src/pickup-forward-client-integrity.js';
import {forwardPrismaIntegrity as prior} from '../src/forward-prisma-client-integrity.js';
const root=resolve('D:/ChildGuard-V2');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();

test('reviewed isolated client preserves existing fields and adds the three Pickup models',()=>{
 assert.deepEqual(verifyPickupForwardClient(),{clientVersion:'6.12.0',engineVersion:'8047c96bbd92db98a2abc7c9323ce77c02c89dbc',models:31,previousFieldsPreserved:332,artifactFiles:23,reviewedGeneratedHashes:true,candidateOnly:true,activationApproved:false});
});

test('active generated client remains the exact historical artifact inventory',()=>{
 const folder=resolve(root,'backend/node_modules/.prisma/client');
 assert.deepEqual(readdirSync(folder).sort(),Object.keys(prior.generatedFiles).sort());
 for(const [name,hash] of Object.entries(prior.generatedFiles))assert.equal(sha(resolve(folder,name)),hash,name);
});

test('historical policies and their preserved snapshot remain byte-identical',()=>{
 const review=resolve(root,pins.reviewDirectory);
 const snapshot=JSON.parse(readFileSync(resolve(review,'snapshot.json')));
 for(const [name,hash] of Object.entries(snapshot.priorPolicyFiles)){
  assert.equal(sha(resolve(root,'backend/src',name)),hash,name);
  assert.equal(sha(resolve(review,'prior-policy',name)),hash,name+' snapshot');
 }
 assert.equal(pins.activationApproved,false);
});
