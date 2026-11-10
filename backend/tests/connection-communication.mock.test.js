import {beforeEach,it,expect,vi} from 'vitest';
import {ingestActivity} from '../src/activity.js';
import {sessionFixture} from './helpers/admin-session-memory.js';
import {attendanceMemory,instrumentAttendanceMemory} from './helpers/attendance-memory.js';
let f,m,payload;
beforeEach(()=>{
 instrumentAttendanceMemory(vi.fn);f=sessionFixture();m=attendanceMemory(f,{hash:'synthetic',tokenHash:'a'.repeat(64)});
 payload={eventId:'authenticated-retry',eventType:'ACTIVITY_SUMMARY',deviceId:m.device.hardwareId,sessionId:'boot',sequence:1,measurementVersion:'MAD_G_V1_25HZ_5S',movementIntensity:null,windowDurationSeconds:60,validSampleCount:0,expectedSampleCount:1500,validDurationSeconds:0,sensorStatus:'UNAVAILABLE',deviceUptimeMs:60000,queueAgeMs:0};
 m.data().deviceEvent.push({id:'stored-source',eventId:payload.eventId,deviceId:m.device.id,payload:{...payload}});f.tick(10000);
});
it('an accepted identical activity retry proves current communication without replaying movement or alert calculations',async()=>{
 const result=await ingestActivity(m.db,m.device,payload);
 expect(result).toEqual({eventId:payload.eventId,duplicate:true});expect(+m.data().device[0].lastSeen).toBe(f.clock);expect(m.data().deviceEvent).toHaveLength(1);expect(m.data().alert).toHaveLength(0);
});
it('a conflicting activity replay cannot update communication time',async()=>{
 await expect(ingestActivity(m.db,m.device,{...payload,deviceUptimeMs:60001})).rejects.toMatchObject({code:'EVENT_ID_CONFLICT'});expect(m.data().device[0].lastSeen).toBeNull();
});
it('a stale or inactive device credential cannot count an activity retry as communication',async()=>{
 const stale={...m.device};m.device.active=false;
 await expect(ingestActivity(m.db,stale,payload)).rejects.toMatchObject({code:'DEVICE_UNAUTHORIZED'});expect(m.data().device[0].lastSeen).toBeNull();
});
