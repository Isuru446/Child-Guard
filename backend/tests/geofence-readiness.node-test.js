import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventSchema } from '../src/events.js';
import { assessStoredGps, evaluateGeofenceReview, reviewCenterZoneCandidates } from '../src/geofence-foundation.js';
const zone={id:'zone',centerId:'center',revision:0,name:'Synthetic circle',latitude:0,longitude:0,radiusM:100,active:true};
const a={id:'assignment',centerId:'center',deviceId:'device',childId:'child',startedAt:0,endedAt:null};
const o=t=>({eventId:'event-'+t,centerId:'center',deviceId:'device',childId:'child',gpsStatus:'GPS_FIX',latitude:0,longitude:.002,observedAt:t,receivedAt:t});
const evaluate=(observation,previous=null,extra={})=>evaluateGeofenceReview({zone,centerId:'center',now:observation.receivedAt,observation,assignments:[a],previous,...extra});
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('overlapping and disjoint multiple active circles stay ambiguous without selecting union/intersection',()=>{
 for(const latitude of [0,20])assert.deepEqual(reviewCenterZoneCandidates([zone,{...zone,id:'second',latitude}],'center'),{state:'MULTIPLE_ZONES_AMBIGUOUS',zoneId:null,requiresOwnerApproval:true,alertAllowed:false});
 assert.equal(reviewCenterZoneCandidates([zone],'center').state,'SINGLE_CENTER_ZONE_PROPOSAL');assert.equal(reviewCenterZoneCandidates([{...zone,active:false}],'center').state,'NO_ACTIVE_ZONE');
});
test('center review never returns a foreign zone and never grants approval',()=>{
 const r=reviewCenterZoneCandidates([{...zone,centerId:'foreign'}],'center');assert.equal(r.zoneId,null);assert.equal(r.requiresOwnerApproval,true);assert.equal(r.alertAllowed,false);assert.throws(()=>reviewCenterZoneCandidates([zone],''));
});
test('deactivation cancels pending dwell; reactivation/revision cannot settle an old pending observation',()=>{
 const p=evaluate(o(1000)).checkpoint;const inactive=evaluate(o(11000),p,{zone:{...zone,active:false}});assert.equal(inactive.reason,'ZONE_INACTIVE');assert.equal(inactive.checkpoint.pendingState,null);assert.equal(evaluate(o(21000),inactive.checkpoint,{zone:{...zone,revision:1}}).candidate,false);
});
test('corrupt future dwell timestamps and orphan pending-since values fail closed',()=>{
 const p=evaluate(o(1000)).checkpoint;assert.equal(evaluate(o(11000),{...p,pendingSince:2000}).reason,'INVALID_CHECKPOINT');assert.equal(evaluate(o(11000),{...p,pendingState:null,pendingSince:1000}).reason,'INVALID_CHECKPOINT');
});
test('missing/claimed GPS accuracy and caller trust flags cannot unlock current stored-GPS evaluation',()=>{
 for(const accuracy of [undefined,null,0,1,Infinity])assert.equal(assessStoredGps({...o(1000),accuracy,trusted:true,bootId:'forged',timestamp:1000}).state,'UNKNOWN');
});
test('current GPS API rejects unapproved evidence fields while retaining the existing payload contract',()=>{
 const legacy={eventId:'synthetic',deviceId:'synthetic-belt',gateId:'synthetic-gate',eventType:'GPS_STATUS',gpsStatus:'GPS_FIX',latitude:0,longitude:0,deviceUptimeMs:100};assert.equal(eventSchema.safeParse(legacy).success,true);
 for(const extra of [{queueAgeMs:100},{observedAt:100},{fixAgeMs:1},{accuracyM:1},{bootId:'boot'},{sequence:1}])assert.equal(eventSchema.safeParse({...legacy,...extra}).success,false);
});
test('a delayed old-child observation is never assigned to the new child',()=>{
 const history=[{...a,endedAt:15000},{...a,id:'new-assignment',childId:'new-child',startedAt:15000}];
 const old={...o(11000),receivedAt:21000};assert.equal(evaluate(old,null,{assignments:history}).candidate,false);assert.equal(evaluate({...old,childId:'new-child'},null,{assignments:history}).reason,'HISTORICAL_ASSIGNMENT_UNPROVEN');
 assert.equal(assessStoredGps(old).alertAllowed,false);assert.equal(evaluate({...old,receivedAt:100000},null,{assignments:history}).reason,'STALE_OR_DELAYED');
});
// Protocol simulation only: not a PostgreSQL adapter or a production alert writer.
function serializedReviewStore(){
 let state={checkpoint:null,receipts:[],candidates:[]},tail=Promise.resolve();
 return {snapshot:()=>structuredClone(state),process(observation,{revision=0,fail=false}={}){
  const result=tail.then(async()=>{const before=structuredClone(state);try{
   const key=zone.id+':'+observation.eventId;if(state.receipts.some(r=>r.key===key))return {duplicate:true,alertAllowed:false};
   const decision=evaluate(observation,state.checkpoint,{zone:{...zone,revision}});await Promise.resolve();
   if(decision.checkpoint)state.checkpoint=decision.checkpoint;
   if(decision.candidate)state.candidates.push({eventId:observation.eventId,revision});
   state.receipts.push({key,decision:decision.state});if(fail)throw Error('Synthetic rollback');
   return {duplicate:false,candidate:decision.candidate,alertAllowed:false};
  }catch(error){state=before;throw error;}});tail=result.catch(()=>{});return result;
 }};
}
test('concurrent duplicate observations require serialized state and immutable receipts, not pure computation alone',async()=>{
 const first=evaluate(o(1000)).checkpoint;assert.equal(evaluate(o(11000),first).candidate,true);assert.equal(evaluate(o(11000),first).candidate,true);
 const store=serializedReviewStore();await store.process(o(1000));const results=await Promise.all([store.process(o(11000)),store.process(o(11000)),store.process({...o(11000),eventId:'equivalent'})]);assert.equal(results.filter(r=>r.candidate).length,1);assert.equal(store.snapshot().candidates.length,1);assert.equal(results.every(r=>!r.alertAllowed),true);
});
test('receipt deduplication survives zone revisions and mock rollback preserves all state atomically',async()=>{
 const store=serializedReviewStore();await store.process(o(1000));const before=store.snapshot();await assert.rejects(store.process(o(11000),{fail:true}));assert.deepEqual(store.snapshot(),before);
 await store.process(o(11000));const committed=store.snapshot();assert.equal((await store.process(o(11000),{revision:1})).duplicate,true);assert.deepEqual(store.snapshot(),committed);
});
test('state SQL provides cursor scope, revision-independent receipt uniqueness and episode/alert dedup keys',()=>{
 const sql=read('../prisma/review/geofence/detection-state.sql');
 for(const token of ['PRIMARY KEY ("zoneId","deviceId")','("zoneId","eventId")','("zoneId","deviceId","episodeId")','("alertId")','GeofenceCursor_pending_check','GeofenceEvaluation_alert_check','GeofenceEvaluation_decision_check','REFERENCES "DeviceEvent"("id")','BEGIN;','COMMIT;'])assert.ok(sql.includes(token),token);
 assert.ok(!/\b(?:ALTER|DROP|GRANT|INSERT)\s/i.test(sql));
});
test('combined schema contains inverse relations and draft policy stays outside the default migration',()=>{
 const schema=read('../prisma/review/geofence/detection.schema.prisma'),sql=read('../prisma/review/geofence/migration.sql'),option=read('../prisma/review/geofence/initial-policy-option.sql');
 for(const name of ['SafeZone','GeofenceCursor','GeofenceEvaluation'])assert.ok(schema.includes('model '+name+' {'));
 assert.ok(schema.includes('geofenceEvaluation GeofenceEvaluation?'));assert.ok(schema.includes('@@unique([zoneId,eventId])'));assert.ok(option.includes('WHERE "active" = true'));assert.ok(!sql.includes('SafeZone_one_active_center_key'));
});
test('source evidence confirms firmware age assertion and legacy-only GPS queue behavior without reading provisioning',()=>{
 const firmware=read('../../firmware/ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino');
 for(const text of ['GPS_FIX_MAX_AGE_MS 5000','gpsParser.location.age()','TELEMETRY_QUEUE_SIZE 12','telemetryQueue[telemetryHead].queuedAtMs = millis();','strcmp(kind, "DANGER_ZONE_NEAR") == 0 || strcmp(kind, "DANGER_ZONE_EXIT") == 0'])assert.ok(firmware.includes(text),'Expected reviewed firmware evidence');
});
