import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateCircle, distanceMeters, classifyCircle, evaluateGeofenceReview, assessStoredGps } from '../src/geofence-foundation.js';
const base={name:'Review circle',latitude:0,longitude:0,radiusM:100,active:true};
const zone={...base,id:'zone',centerId:'center',revision:0};
const assignment={id:'a',centerId:'center',deviceId:'device',childId:'child',startedAt:0,endedAt:null};
const obs=(t,longitude=.002,extra={})=>({eventId:'event-'+t,deviceId:'device',childId:'child',centerId:'center',gpsStatus:'GPS_FIX',latitude:0,longitude,observedAt:t,receivedAt:t,...extra});
const evaluate=(o,previous=null,extra={})=>evaluateGeofenceReview({zone,observation:o,assignments:[assignment],previous,now:o.receivedAt,centerId:'center',...extra});
test('accepts real numeric zeros and trimmed names without coordinate coercion',()=>assert.deepEqual(validateCircle({...base,name:' Circle '}),{...base,name:'Circle'}));
for(const patch of [{latitude:91},{longitude:-181},{latitude:'0'},{latitude:NaN},{longitude:Infinity},{radiusM:49},{radiusM:5001},{radiusM:'100'},{radiusM:NaN},{active:'true'},{name:' '},{name:'x'.repeat(101)},{name:'bad\nname'},{centerId:'foreign'},{childId:'unapproved'}])test('rejects invalid zone '+JSON.stringify(patch),()=>assert.throws(()=>validateCircle({...base,...patch})));
test('range endpoints and minimum/maximum radius are accepted',()=>{validateCircle({...base,latitude:-90,longitude:180,radiusM:50});validateCircle({...base,latitude:90,longitude:-180,radiusM:5000});});
test('great-circle distances match known equatorial, antimeridian, antipodal and pole cases',()=>{
 assert.equal(distanceMeters(base,base),0);assert.ok(Math.abs(distanceMeters(base,{latitude:0,longitude:1})-111195.08)<.02);
 assert.ok(Math.abs(distanceMeters({latitude:0,longitude:179.999},{latitude:0,longitude:-179.999})-222.39016)<.02);
 assert.ok(Math.abs(distanceMeters(base,{latitude:0,longitude:180})-20015114.44)<.1);assert.ok(distanceMeters({latitude:90,longitude:0},{latitude:90,longitude:180})<.001);assert.throws(()=>distanceMeters(base,{latitude:NaN,longitude:0}));
});
test('classifies geometry as inside/outside/unknown without inventing accuracy',()=>{
 assert.equal(classifyCircle(base,obs(1,0)).state,'INSIDE');assert.equal(classifyCircle(base,obs(1)).state,'OUTSIDE');assert.equal(classifyCircle(base,obs(1,100/111195.0802)).state,'UNKNOWN');assert.equal(classifyCircle({...base,active:false},obs(1)).state,'UNKNOWN');
});
for(const fix of [{},null,{gpsStatus:'GPS_NO_FIX',latitude:0,longitude:0},{gpsStatus:'GPS_NO_SERIAL'},{gpsStatus:'GPS_FIX',latitude:0},{gpsStatus:'GPS_FIX',latitude:NaN,longitude:0},{gpsStatus:'GPS_FIX',latitude:0,longitude:181}])test('invalid/missing GPS stays unknown '+JSON.stringify(fix),()=>assert.equal(classifyCircle(base,fix).state,'UNKNOWN'));
test('separate sustained outside observations create only a review candidate, never an allowed alert',()=>{
 const first=evaluate(obs(1000)),next=evaluate(obs(11000),first.checkpoint),repeat=evaluate(obs(21000),next.checkpoint);
 assert.equal(first.state,'UNKNOWN');assert.equal(next.state,'OUTSIDE');assert.equal(next.candidate,true);assert.equal(repeat.candidate,false);assert.equal(next.alertAllowed,false);
});
test('boundary oscillation, missing fix and signal gaps cannot settle a candidate or rearm one',()=>{
 let p=evaluate(obs(1000)).checkpoint;p=evaluate(obs(11000,100/111195.0802),p).checkpoint;assert.equal(evaluate(obs(21000),p).candidate,false);
 p=evaluate(obs(1000)).checkpoint;p=evaluate(obs(11000,0,{gpsStatus:'GPS_NO_FIX'}),p).checkpoint;assert.equal(evaluate(obs(21000),p).candidate,false);
 assert.equal(evaluate(obs(50000),evaluate(obs(1000)).checkpoint).candidate,false);
 let open=evaluate(obs(11000),evaluate(obs(1000)).checkpoint).checkpoint;open=evaluate(obs(21000,0),open).checkpoint;assert.equal(evaluate(obs(31000),open).candidate,false);
 open=evaluate(obs(41000,0),open).checkpoint;open=evaluate(obs(51000,0),open).checkpoint;open=evaluate(obs(61000),open).checkpoint;assert.equal(evaluate(obs(71000),open).candidate,true);
});
for(const [label,o,now] of [['stale',obs(1000),40001],['delayed',obs(1000,.002,{receivedAt:17000}),17000],['future',obs(2000,.002,{receivedAt:1000}),1000],['future receipt',obs(1000),0]])test('refuses '+label+' timing',()=>assert.equal(evaluate(o,null,{now}).state,'UNKNOWN'));
test('duplicate and out-of-order events never advance a checkpoint, even after assignment/config changes',()=>{
 const p=evaluate(obs(10000)).checkpoint;for(const o of [obs(10000),obs(9999),obs(20000,.002,{eventId:'event-10000'})]){const r=evaluate(o,p);assert.equal(r.reason,'DUPLICATE_OR_OUT_OF_ORDER');assert.equal(r.checkpoint,p);assert.equal(r.candidate,false);}
 assert.equal(evaluate(obs(5000),p,{zone:{...zone,revision:1}}).candidate,false);
});
test('delayed/invalid timing interrupts dwell without rearming an existing outside episode',()=>{
 const first=evaluate(obs(1000));const delayed=evaluate(obs(2000,.002,{receivedAt:19000}),first.checkpoint);
 assert.equal(delayed.checkpoint.pendingState,null);assert.equal(evaluate(obs(21000),delayed.checkpoint).candidate,false);
 const open=evaluate(obs(11000),first.checkpoint).checkpoint;const broken=evaluate(obs(12000,.002,{receivedAt:1000}),open);
 assert.equal(broken.checkpoint.openCandidate,true);assert.equal(broken.checkpoint.pendingSince,null);
});
test('uses historical assignment intervals, rejects ambiguity and never substitutes a newly assigned child',()=>{
 const ended={...assignment,endedAt:15000},next={...assignment,id:'new',childId:'new-child',startedAt:15000};
 assert.equal(evaluate(obs(10000),null,{assignments:[ended,next]}).reason,'AWAITING_SEPARATE_OBSERVATION');
 assert.equal(evaluate(obs(15000),null,{assignments:[ended,next]}).reason,'HISTORICAL_ASSIGNMENT_UNPROVEN');
 const p=evaluate(obs(10000)).checkpoint;assert.equal(evaluate(obs(20000,.002,{childId:'new-child'}),p,{assignments:[ended,next]}).candidate,false);
 assert.equal(evaluate(obs(10000),null,{assignments:[assignment,{...assignment,id:'overlap'}]}).reason,'HISTORICAL_ASSIGNMENT_UNPROVEN');
 assert.equal(evaluate(obs(10000),null,{assignments:[assignment,{...assignment,id:'foreign-overlap',centerId:'foreign'}]}).reason,'HISTORICAL_ASSIGNMENT_UNPROVEN');
 assert.equal(evaluate(obs(10000),null,{assignments:[]}).state,'UNKNOWN');
});
test('center mismatch and revision changes cannot reuse a previous candidate',()=>{
 const p=evaluate(obs(1000)).checkpoint;assert.equal(evaluate(obs(11000),p,{zone:{...zone,centerId:'foreign'}}).reason,'CENTER_MISMATCH');assert.equal(evaluate(obs(11000,.002,{centerId:'foreign'}),p).reason,'CENTER_MISMATCH');assert.equal(evaluate(obs(11000),p,{zone:{...zone,revision:1}}).candidate,false);assert.equal(evaluate(obs(11000),{...p,pendingSince:NaN}).reason,'INVALID_CHECKPOINT');
});
test('current stored GPS never enables alerts despite forged trust flags, timestamps or a last-known fix',()=>{
 for(const payload of [obs(1000),{...obs(1000),trusted:true,accuracy:1,timingBasis:'VERIFIED',lastKnownLocation:{latitude:0,longitude:0}},null])assert.deepEqual(assessStoredGps(payload),{state:'UNKNOWN',reason:'TRUSTED_GPS_TIMING_AND_RELIABILITY_UNAVAILABLE',monitoringAvailable:false,candidate:false,alertAllowed:false});
});
test('draft is outside migration history, additive, and the active schema has no SafeZone model',()=>{
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8'),sql=read('../prisma/review/geofence/migration.sql'),schema=read('../prisma/review/geofence/schema.prisma');
 assert.equal(readdirSync(new URL('../prisma/migrations',import.meta.url)).filter(n=>/^\d/.test(n)).length,8);assert.ok(!read('../prisma/schema.prisma').includes('model SafeZone'));
 assert.match(schema,/safeZones SafeZone\[\]/);assert.match(schema,/model SafeZone/);assert.match(sql,/ON DELETE RESTRICT ON UPDATE RESTRICT/);assert.match(sql,/BETWEEN 50 AND 5000/);assert.doesNotMatch(sql,/\b(?:ALTER|DROP|GRANT|INSERT|UPDATE|DELETE)\b(?!\s+RESTRICT)/i);
});
