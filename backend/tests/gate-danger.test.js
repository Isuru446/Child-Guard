import { describe, it, expect } from 'vitest';
import { gateDangerSuppression, eventSchema } from '../src/events.js';
const now = new Date('2026-10-21T05:00:00Z');
const eligible = () => ({
 now,attendance:{status:'PRESENT',gatePassAuthorized:false},
 confirmation:{confirmedAt:new Date(now-20000)},
 far:{receivedAt:new Date(now-10000),deviceUptimeMs:100,payload:{queueAgeMs:0}},
 payload:{deviceUptimeMs:200,queueAgeMs:0},reset:null,previousAlert:null,
});
describe('gate danger safeguards',()=>{
 it('allows a fresh post-confirmation FAR followed by a danger approach',()=>expect(gateDangerSuppression(eligible())).toBeNull());
 it.each(['NOT_CHECKED_IN','CHECKIN_PENDING','CHECKED_OUT'])('does not arm while %s',status=>expect(gateDangerSuppression({...eligible(),attendance:{status}})).toBe('NOT_CONFIRMED_PRESENT'));
 it('requires a real confirmation and subsequent FAR evidence',()=>{
  expect(gateDangerSuppression({...eligible(),confirmation:null})).toBe('NOT_CONFIRMED_PRESENT');
  expect(gateDangerSuppression({...eligible(),far:null})).toBe('NO_CONFIRMED_FAR');
  expect(gateDangerSuppression({...eligible(),confirmation:{confirmedAt:now}})).toBe('FAR_PRECEDES_CONFIRMATION');
 });
 it('honors gate authorization',()=>expect(gateDangerSuppression({...eligible(),attendance:{status:'PRESENT',gatePassAuthorized:true}})).toBe('GATE_PASS_AUTHORIZED'));
 it('rejects stale FAR and old queued approaches',()=>{
  const value=eligible();value.confirmation.confirmedAt=new Date(now-90000);value.far.receivedAt=new Date(now-60000);
  expect(gateDangerSuppression(value)).toBe('STALE_OBSERVATION');
  expect(gateDangerSuppression({...eligible(),payload:{deviceUptimeMs:200,queueAgeMs:45001}})).toBe('STALE_OBSERVATION');
 });
 it('never treats signal loss or UNKNOWN as FAR and suppresses repeated approaches',()=>{
  expect(gateDangerSuppression({...eligible(),reset:{}})).toBe('SIGNAL_UNKNOWN');
  expect(gateDangerSuppression({...eligible(),previousAlert:{}})).toBe('APPROACH_ALREADY_REPORTED');
 });
 it('requires new evidence after reboot or uint32 wrap',()=>expect(gateDangerSuppression({...eligible(),payload:{deviceUptimeMs:1}})).toBe('DEVICE_SESSION_CHANGED'));
 it('accepts queue timing on danger events without allowing proximity or missing RSSI',()=>{
  const base={eventId:'event-1',deviceId:'device-1',gateId:'gate-1',eventType:'DANGER_ZONE_NEAR',gpsStatus:'GPS_NO_FIX',deviceUptimeMs:1,rssi:-50,queueAgeMs:500};
  expect(eventSchema.safeParse(base).success).toBe(true);
  expect(eventSchema.safeParse({...base,proximity:'NEAR'}).success).toBe(false);
  expect(eventSchema.safeParse({...base,rssi:undefined}).success).toBe(false);
 });
});
