import {describe,it,expect,vi} from 'vitest';
import {parentUpdates} from '../src/parent-updates.js';

const child={id:'authorized-child',centerId:'authorized-center',name:'Real child'};
const row=(id,kind,time)=>({id,kind,createdAt:new Date(time)});
describe('read-only Parent update projection',()=>{
 it('merges saved attendance and pickup evidence before pagination with deterministic ties and no private audit payload',async()=>{
  const db={$queryRaw:vi.fn()
   .mockResolvedValueOnce([row('a','ATTENDANCE_ABSENT:INITIAL:{"reason":"private"}','2026-10-28T01:00Z'),row('c','ATTENDANCE_CONFIRMED_TEACHER','2026-10-28T03:00Z')])
   .mockResolvedValueOnce([{installed:true}])
   .mockResolvedValueOnce([row('b','PICKUP_COMPLETED','2026-10-28T03:00Z')])};
  const result=await parentUpdates(db,child,{limit:2,offset:1});
  expect(result.rows.map(r=>r.id)).toEqual(['b','a']);
  expect(result.rows[1].kind).toBe('ABSENT');
  expect(JSON.stringify(result)).not.toContain('private');
  expect(result.rows.every(r=>r.child.id===child.id)).toBe(true);
  expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual([child.id,child.centerId,child.id,child.centerId,child.id,child.centerId,3]);
  expect(db.$queryRaw.mock.calls[2].slice(1)).toEqual([child.id,child.centerId,3]);
  const sql=db.$queryRaw.mock.calls[2][0].join('?');
  expect(sql).not.toMatch(/codeHash|codeSalt|snapshot|phone/);
  expect(sql).toContain('PICKUP_EXPIRED');
 });
 it('keeps attendance when Pickup storage is not installed without synthesizing pickup events',async()=>{
  const db={$queryRaw:vi.fn().mockResolvedValueOnce([row('a','CHECKIN_PENDING','2026-10-28T01:00Z')]).mockResolvedValueOnce([{installed:false}])};
  const result=await parentUpdates(db,child,{limit:1,offset:0});
  expect(result.pickupAvailable).toBe(false);expect(result.rows[0].kind).toBe('CHECKIN_PENDING');
  expect(db.$queryRaw).toHaveBeenCalledTimes(2);
 });
 it('does not turn database failures into a successful empty response',async()=>{
  const db={$queryRaw:vi.fn().mockRejectedValue(new Error('unavailable'))};
  await expect(parentUpdates(db,child,{limit:1,offset:0})).rejects.toThrow('unavailable');
 });
 it('tolerates only a missing Pickup table race, not a connection failure',async()=>{
  for(const missing of [true,false]){
   const db={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{installed:true}]).mockRejectedValueOnce(Object.assign(new Error('failed'),{code:missing?'P2021':'P1001'}))};
   if(missing) expect((await parentUpdates(db,child,{limit:25,offset:0})).rows).toEqual([]);
   else await expect(parentUpdates(db,child,{limit:25,offset:0})).rejects.toThrow('failed');
  }
 });
});

it('merges saved advisories into routine history without including them in danger or exporting private fields',async()=>{
 const db={$queryRaw:vi.fn().mockResolvedValueOnce([{id:'advisory',kind:'LOW_ACTIVITY_ADVISORY',createdAt:new Date('2026-10-28T05:00:00Z'),details:{reductionPercent:34.2,privateField:'not-exported'}}]).mockResolvedValueOnce([{installed:false}])};
 const result=await parentUpdates(db,child,{limit:1,offset:0});expect(result.rows[0]).toMatchObject({kind:'LOW_ACTIVITY_ADVISORY',details:{reductionPercent:34.2},child:{id:child.id,name:child.name}});expect(JSON.stringify(result)).not.toContain('not-exported');
 expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain("a.kind='LOW_ACTIVITY_ADVISORY'");
});
