import { describe, it, expect } from 'vitest';
import { eventSchema } from '../src/events.js';
const observation = {eventId:'test-ble-1',deviceId:'device-1',gateId:'gate-1',eventType:'BLE_PROXIMITY',gpsStatus:'GPS_NO_FIX',deviceUptimeMs:10,queueAgeMs:0,proximity:'NEAR',rssi:-55.5};
describe('BLE wire contract',()=>{
 it('accepts confirmed states and fractional filtered RSSI',()=>{
  for(const proximity of ['NEAR','FAR']) expect(eventSchema.parse({...observation,proximity}).proximity).toBe(proximity);
 });
 it('accepts UNKNOWN without a fabricated signal measurement',()=>{
  const {rssi,...unknown}=observation;
  expect(rssi).toBe(-55.5);
  expect(eventSchema.parse({...unknown,proximity:'UNKNOWN'}).rssi).toBeUndefined();
  expect(eventSchema.safeParse({...observation,proximity:'UNKNOWN'}).success).toBe(false);
 });
 it('rejects invalid identity, missing fields, states, ranges and extra properties',()=>{
  for(const patch of [{eventId:'invalid id'},{deviceId:''},{gateId:''},{proximity:'OBSERVING'},{proximity:undefined},{rssi:undefined},{rssi:-128},{rssi:1},{rssi:NaN},{queueAgeMs:undefined},{queueAgeMs:-1},{queueAgeMs:0.5},{queueAgeMs:4294967296},{extra:true}]) expect(eventSchema.safeParse({...observation,...patch}).success).toBe(false);
 });
 it('keeps BLE fields out of workflow events',()=>{
  expect(eventSchema.safeParse({...observation,eventType:'CHILD_NEAR_GATE'}).success).toBe(false);
  const {proximity,queueAgeMs,...workflow}=observation;
  expect(proximity).toBe('NEAR');expect(queueAgeMs).toBe(0);
  expect(eventSchema.safeParse({...workflow,eventType:'CHILD_NEAR_GATE'}).success).toBe(true);
 });
});
