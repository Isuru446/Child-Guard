import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prototypeGpsEvidence } from '../src/prototype-gps.js';
const sketch=readFileSync(new URL('../../firmware/ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino',import.meta.url),'utf8');
const zones=readFileSync(new URL('../../firmware/ChildGuard_Wearable_Integrated/MultiBeaconRuntime.h',import.meta.url),'utf8');
it('keeps GPS outside the congestible FIFO and dispatches before blocking communication',()=>{
 expect(sketch).toContain('pendingGPS.queuedAtMs=millis();return;');
 expect(sketch).toContain('age>1000');
 expect(sketch).toContain('millis()-pendingGPS.queuedAtMs');
 const loop=sketch.slice(sketch.indexOf('void loop()'));
 expect(loop.indexOf('flushFreshGPS();')).toBeLessThan(loop.indexOf('pollGateState'));
 expect(sketch).toContain('strcmp(eventType,"GPS_STATUS")!=0 && next == telemetryTail');
});
it('protects zone FAR identity and emits FAR before current state and danger',()=>{
 expect(zones).toContain('!z.pendingFAR.length()');
 expect(zones).toContain('kind==0?z.pendingFAR:kind==1?(z.pendingNear.length()?z.pendingNear:z.pendingBLE):z.pendingDanger');
 expect(zones).toContain('z.pendingNear=z.pendingBLE;z.nearAt=z.bleAt;');
 expect(zones).toContain('kind==2?z.pendingNear:z.pendingDanger');
 expect(zones).toContain('!gatePassAuthorized && z.approachArmed');
 expect(zones).toContain('ZoneFilter::UNKNOWN){z.approachArmed=false');
});
it('attempts priority transitions before optional blocking polls without changing GPS priority',()=>{
 const loop=sketch.slice(sketch.indexOf('void loop()'));
 expect(loop.indexOf('flushFreshGPS();')).toBeLessThan(loop.indexOf('processZoneBeacons();'));
 expect(loop.indexOf('flushPriorityTelemetry')).toBeLessThan(loop.indexOf('pollGateState'));
 expect(sketch).toContain('telemetryDispatchDue(millis(),lastTelemetrySendAttemptMs');
 expect(sketch).toContain('telemetryRetryNeeded=!flushZoneBatch(http)');
});
it('retries ambiguous success with the original identity and handles deliberate rejection',()=>{
 expect(sketch).toContain('String(response["data"]["eventId"]|"")!=String(sentEvent["eventId"]|"")))code=-100');
 expect(sketch).toContain('code == 400 || code == 409 || code == 422');
 expect(zones).toContain('logTelemetryResult(item,status)');
});
it('accepts timely evidence but rejects stale queue age without resetting observation time',()=>{
 const now=new Date('2026-10-25T05:00:00Z');
 const p={gpsEvidenceVersion:'CG_GPS_V1',gpsStatus:'GPS_FIX',latitude:1,longitude:2,gpsObservedAt:new Date(+now-2000).toISOString(),gpsFixAgeMs:100,deviceBootId:'boot',gpsSequence:1,gpsHdop:1,gpsSatellites:8,gpsQueueAgeMs:1000};
 expect(prototypeGpsEvidence(p,now).eligible).toBe(true);
 expect(prototypeGpsEvidence({...p,gpsQueueAgeMs:1001},now).eligible).toBe(false);
 expect(prototypeGpsEvidence({...p,gpsObservedAt:new Date(+now-16000).toISOString()},now).eligible).toBe(false);
});

it('separates server-authorized zone sessions from Gate live proximity and retains safety priority',()=>{
 const zoneProcessing=zones.slice(zones.indexOf('void processZoneBeacons()'),zones.indexOf('bool zoneTelemetryPending()'));
 expect(zoneProcessing).toContain('hasFreshGateState() && zoneMonitoringArmed');
 expect(zoneProcessing).not.toContain('gateDangerArmed');
 expect(zoneProcessing).toContain('z.filter.lastSeen>zoneDepartureUptimeMs');
 expect(sketch).toContain('"&deviceBootId=" + deviceBootId');
 expect(sketch).toContain('doc["zoneMonitoringArmed"] | false');
});
