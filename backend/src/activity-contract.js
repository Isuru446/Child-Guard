import { z } from 'zod';
export const MEASUREMENT_VERSION='MAD_G_V1_25HZ_5S';
const id=z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
export const activitySchema=z.object({
 eventId:id,eventType:z.literal('ACTIVITY_SUMMARY'),deviceId:id,sessionId:id,sequence:z.number().int().min(1).max(2147483647),
 measurementVersion:z.literal(MEASUREMENT_VERSION),movementIntensity:z.number().finite().min(0).max(4).nullable(),
 windowDurationSeconds:z.literal(60),validSampleCount:z.number().int().min(0).max(1500),expectedSampleCount:z.literal(1500),
 validDurationSeconds:z.number().finite().min(0).max(60),sensorStatus:z.enum(['OK','PARTIAL','UNAVAILABLE']),
 deviceUptimeMs:z.number().int().min(60000).max(4294967295),queueAgeMs:z.number().int().min(0).max(86400000),
}).strict().superRefine((v,c)=>{
 if(Math.abs(v.validDurationSeconds-v.validSampleCount/25)>0.05 || (v.validSampleCount===0)!==(v.movementIntensity===null) || (v.sensorStatus==='UNAVAILABLE')!==(v.validSampleCount===0) || (v.sensorStatus==='OK'&&v.validSampleCount<1425)) c.addIssue({code:'custom',message:'Inconsistent sensor coverage'});
});
const minutes=z.number().int().min(0).max(1440);
export const policySchema=z.object({
 maxInitialAlertsPerDay:z.literal(1).default(1),followUpMinutes:z.number().int().min(60).max(480).nullable().default(null),
 enabled:z.boolean(),timezone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Unknown timezone'),
 startMinute:minutes,endMinute:minutes,weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),
 quietPeriods:z.array(z.object({startMinute:minutes,endMinute:minutes}).strict()).max(12),
 baselineDays:z.number().int().min(4).max(14),minBaselineDays:z.number().int().min(4).max(14),
 reductionPercent:z.number().finite().min(10).max(90),sustainedMinutes:z.number().int().min(30).max(240).multipleOf(30),
 minCoveragePercent:z.number().finite().min(50).max(100),minimumBaselineMADg:z.number().finite().min(0.001).max(1),
}).strict().superRefine((v,c)=>{
 if(v.startMinute>=v.endMinute||v.minBaselineDays>v.baselineDays||new Set(v.weekdays).size!==v.weekdays.length||v.quietPeriods.some(p=>p.startMinute>=p.endMinute)) c.addIssue({code:'custom',message:'Invalid monitoring schedule or baseline policy'});
});
export const DEFAULT_ACTIVITY_POLICY={maxInitialAlertsPerDay:1,followUpMinutes:null,enabled:false,timezone:'Asia/Colombo',startMinute:480,endMinute:1020,weekdays:[1,2,3,4,5],quietPeriods:[],baselineDays:7,minBaselineDays:4,reductionPercent:30,sustainedMinutes:60,minCoveragePercent:80,minimumBaselineMADg:0.005};
