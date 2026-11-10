// Authenticated classroom-prototype evidence, not attested GPS or guaranteed accuracy.
export function prototypeGpsEvidence(p,now){
 const unknown=reason=>({eligible:false,reason,observedAt:null});
 if(p.gpsEvidenceVersion!=='CG_GPS_V1')return unknown('LEGACY_GPS_TIMING_UNKNOWN');
 if(p.gpsStatus!=='GPS_FIX'||![p.latitude,p.longitude].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180)return unknown('GPS_UNAVAILABLE');
 const at=Date.parse(p.gpsObservedAt);
 if(!Number.isFinite(at)||at>+now||+now-at>15000||!Number.isFinite(p.gpsFixAgeMs)||p.gpsFixAgeMs>5000||p.gpsFixAgeMs<0||!Number.isFinite(p.gpsQueueAgeMs)||p.gpsQueueAgeMs>1000||p.gpsQueueAgeMs<0)return unknown('STALE_OR_UNCERTAIN_GPS');
 if(!p.deviceBootId||!Number.isInteger(p.gpsSequence))return unknown('GPS_SEQUENCE_UNAVAILABLE');
 if(!Number.isFinite(p.gpsHdop)||p.gpsHdop<=0||p.gpsHdop>2.5||!Number.isInteger(p.gpsSatellites)||p.gpsSatellites<4)return unknown('GPS_QUALITY_UNKNOWN_OR_POOR');
 return {eligible:true,reason:'DEVICE_REPORTED_FRESH_GNSS',observedAt:new Date(at)};
}
