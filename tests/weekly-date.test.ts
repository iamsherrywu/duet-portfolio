import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureWeeklyDate} from '../src/lib/server/weekly-date';
import type {Context} from '../src/lib/supabase/server';
import {AppError} from '../src/lib/server/http';
test('cached weekly suggestions do not call generation again; missing slots produce guidance, not an event',async()=>{
 let generated=0;const writes:string[]=[];
 const context=(reservation:unknown)=>({user:{id:'a'},db:{rpc:async(name:string)=>{writes.push(name);return {data:reservation,error:null};}}}) as unknown as Context;
 const cached=await ensureWeeklyDate(context({acquired:false,proposalId:'p',message:'本周建议'}),async()=>{generated++;return 'p';});
 assert.equal(cached.proposalId,'p');assert.equal(generated,0);assert.doesNotMatch(cached.message,/[\u3400-\u9fff]/,'legacy system status must use English');
 const waiting=await ensureWeeklyDate(context({acquired:true,token:'t'}),async()=>{throw new Error('No availability');});
 assert.match(waiting.message,/availability|Unable to generate/);assert.ok(writes.includes('duet_finish_weekly_date'));assert.ok(!writes.some(name=>name.includes('entry')));
});
test('weekly no-free-time guidance uses schedules, never the removed manual availability workflow',async()=>{
 const ctx={user:{id:'a'},db:{rpc:async(name:string)=>({data:name==='duet_reserve_weekly_date'?{acquired:true,token:'t'}:null,error:null})}} as unknown as Context;
 const result=await ensureWeeklyDate(ctx,async()=>{throw new AppError(409,'no_common_availability','No free time');});
 assert.doesNotMatch(result.message,/share (?:your )?availability/);assert.match(result.message,/schedules/);
});
