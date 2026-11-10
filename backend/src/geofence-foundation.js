// Pure REVIEW foundation. No database, environment, event ingestion or alert writes.
export const zoneLimits=Object.freeze({minRadiusM:50,maxRadiusM:5000,maxNameLength:100});
export const reviewPolicy=Object.freeze({maxAgeMs:30000,maxTransportDelayMs:15000,dwellMs:10000,maxGapMs:30000});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const validCoordinates=(latitude,longitude)=>finite(latitude)&&finite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180;
export function validateCircle(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['name','latitude','longitude','radiusM','active'].includes(k)))throw Error('Invalid zone fields');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>zoneLimits.maxNameLength||/[\u0000-\u001f\u007f]/.test(input.name))throw Error('Invalid zone name');
 if(!validCoordinates(input.latitude,input.longitude))throw Error('Invalid zone coordinates');
 if(!finite(input.radiusM)||input.radiusM<zoneLimits.minRadiusM||input.radiusM>zoneLimits.maxRadiusM)throw Error('Invalid zone radius');
 if(typeof input.active!=='boolean')throw Error('Invalid zone status');
 return Object.freeze({...input,name:input.name.trim()});
}
// Spherical great-circle distance in metres; mean Earth radius, no claimed GPS accuracy.
export function distanceMeters(a,b){
 if(!validCoordinates(a?.latitude,a?.longitude)||!validCoordinates(b?.latitude,b?.longitude))throw Error('Invalid coordinates');
 const rad=n=>n*Math.PI/180,dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
 return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,Math.max(0,h))),Math.sqrt(Math.max(0,1-h)));
}
export function classifyCircle(zone,fix){
 const z=validateCircle(zone);
 if(!z.active)return {state:'UNKNOWN',reason:'ZONE_INACTIVE',distanceM:null};
 if(fix?.gpsStatus!=='GPS_FIX'||!validCoordinates(fix.latitude,fix.longitude))return {state:'UNKNOWN',reason:'GPS_UNAVAILABLE',distanceM:null};
 const distanceM=distanceMeters(z,fix),marginM=Math.max(10,Math.min(50,z.radiusM*.1));
 return {state:distanceM<z.radiusM-marginM?'INSIDE':distanceM>z.radiusM+marginM?'OUTSIDE':'UNKNOWN',reason:Math.abs(distanceM-z.radiusM)<=marginM?'BOUNDARY_BAND':'GEOMETRY_ONLY',distanceM,marginM};
}
// Hypothetical trusted observations ONLY, for review/testing future sequencing.
// Even a confirmed candidate is never authorization to emit an operational alert.
export function evaluateGeofenceReview({zone,observation:o,assignments=[],previous=null,now,centerId}){
 const unavailable=(reason,checkpoint=previous)=>({state:'UNKNOWN',reason,candidate:false,alertAllowed:false,checkpoint});
 if(previous&&(!finite(previous.lastObservedAt)||typeof previous.lastEventId!=='string'||typeof previous.scope!=='string'||typeof previous.openCandidate!=='boolean'||(previous.pendingState!==null&&!['INSIDE','OUTSIDE'].includes(previous.pendingState))||(previous.pendingState===null?previous.pendingSince!==null:!finite(previous.pendingSince)||previous.pendingSince>previous.lastObservedAt)))return unavailable('INVALID_CHECKPOINT',null);
 if(typeof centerId!=='string'||!centerId||zone?.centerId!==centerId||o?.centerId!==centerId)return unavailable('CENTER_MISMATCH',null);
 if(typeof zone.id!=='string'||!zone.id||!Number.isInteger(zone.revision)||zone.revision<0)return unavailable('INVALID_ZONE',null);
 const circle=validateCircle({name:zone.name,latitude:zone.latitude,longitude:zone.longitude,radiusM:zone.radiusM,active:zone.active});
 if(![o.eventId,o.deviceId,o.childId].every(v=>typeof v==='string'&&v.length>0))return unavailable('IDENTITY_UNAVAILABLE',null);
 const interrupted=previous?{...previous,pendingState:null,pendingSince:null}:null;
 if(![now,o.observedAt,o.receivedAt].every(finite)||o.observedAt>o.receivedAt||o.receivedAt>now)return unavailable('INVALID_TIME',interrupted);
 if(now-o.observedAt>reviewPolicy.maxAgeMs||o.receivedAt-o.observedAt>reviewPolicy.maxTransportDelayMs)return unavailable('STALE_OR_DELAYED',interrupted);
 const matching=assignments.filter(a=>a.deviceId===o.deviceId&&finite(a.startedAt)&&(a.endedAt===null||finite(a.endedAt))&&a.startedAt<=o.observedAt&&(a.endedAt===null||o.observedAt<a.endedAt));
 if(matching.length!==1||typeof matching[0].id!=='string'||!matching[0].id||matching[0].centerId!==centerId||matching[0].childId!==o.childId)return unavailable('HISTORICAL_ASSIGNMENT_UNPROVEN',null);
 const scope=JSON.stringify([centerId,zone.id,zone.revision,o.deviceId,o.childId,matching[0].id]);
 // High-water mark remains across configuration/assignment changes to block old observations.
 if(previous&&(o.eventId===previous.lastEventId||o.observedAt<=previous.lastObservedAt))return unavailable('DUPLICATE_OR_OUT_OF_ORDER');
 const same=previous?.scope===scope,contiguous=same&&o.observedAt-previous.lastObservedAt<=reviewPolicy.maxGapMs;
 const checkpoint={scope,lastObservedAt:o.observedAt,lastEventId:o.eventId,openCandidate:same?previous.openCandidate:false,pendingState:null,pendingSince:null};
 const comparison=classifyCircle(circle,o);
 if(comparison.state==='UNKNOWN')return {...unavailable(comparison.reason,checkpoint),comparison};
 checkpoint.pendingState=comparison.state;checkpoint.pendingSince=contiguous&&previous.pendingState===comparison.state?previous.pendingSince:o.observedAt;
 const settled=o.observedAt-checkpoint.pendingSince>=reviewPolicy.dwellMs;
 const candidate=settled&&comparison.state==='OUTSIDE'&&!checkpoint.openCandidate;
 if(candidate)checkpoint.openCandidate=true;
 if(settled&&comparison.state==='INSIDE')checkpoint.openCandidate=false;
 return {state:settled?comparison.state:'UNKNOWN',reason:settled?'REVIEW_SEQUENCE_ONLY':'AWAITING_SEPARATE_OBSERVATION',comparison,candidate,alertAllowed:false,checkpoint};
}
// Current GPS_STATUS has no trusted original fix timestamp or accuracy contract.
// Never substitute receivedAt, last-known location, payload flags or current assignment.
export function assessStoredGps(){
 return Object.freeze({state:'UNKNOWN',reason:'TRUSTED_GPS_TIMING_AND_RELIABILITY_UNAVAILABLE',monitoringAvailable:false,candidate:false,alertAllowed:false});
}
// Review recommendation only: never infer union/intersection or child applicability.
export function reviewCenterZoneCandidates(zones,centerId){
 if(typeof centerId!=='string'||!centerId||!Array.isArray(zones))throw Error('Invalid center zone review');
 const active=zones.filter(z=>z.centerId===centerId&&z.active===true);
 return Object.freeze({state:active.length===0?'NO_ACTIVE_ZONE':active.length===1?'SINGLE_CENTER_ZONE_PROPOSAL':'MULTIPLE_ZONES_AMBIGUOUS',zoneId:active.length===1?active[0].id:null,requiresOwnerApproval:true,alertAllowed:false});
}
