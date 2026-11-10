import { z } from 'zod';
const id=z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
export const TAMPER_TYPES=['TAMPER_LOOP_OPEN','TAMPER_LOOP_RESTORED','TAMPER_LOOP_STATUS'];
export const tamperSchema=z.object({
 eventId:id,deviceId:id,eventType:z.enum(TAMPER_TYPES),tamperVersion:z.literal('CG_TAMPER_V1'),
 deviceBootId:id.max(80),tamperEpoch:id.max(48),tamperSequence:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
 tamperEpisodeId:id,tamperState:z.enum(['OPEN','CLOSED']),reason:z.enum(['STARTUP','TRANSITION','PERIODIC']),
 deviceUptimeMs:z.number().int().min(0).max(4294967295),queueAgeMs:z.number().int().min(0).max(4294967295),
 timingUncertain:z.boolean(),assignmentId:z.string().uuid().optional(),
}).strict().superRefine((p,c)=>{
 if(p.eventType==='TAMPER_LOOP_OPEN'&&p.tamperState!=='OPEN'||p.eventType==='TAMPER_LOOP_RESTORED'&&p.tamperState!=='CLOSED')c.addIssue({code:'custom',message:'Tamper event/state mismatch'});
});
