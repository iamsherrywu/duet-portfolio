import assert from 'node:assert/strict';
import {test} from 'node:test';
import {personalScheduleRoutes} from '../src/lib/server/personal-schedules';
import {failure} from '../src/lib/server/http';
import type {Context} from '../src/lib/supabase/server';
const uid='10000000-0000-4000-8000-000000000001';
const input={title:'Work',startsAt:'2099-01-01T09:00:00Z',endsAt:'2099-01-01T10:00:00Z',timezone:'Asia/Shanghai',note:''};
function mock(paired=true){
 const calls:Array<{name:string;args:unknown}>=[];
 const ctx={user:{id:uid},db:{from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:paired?{couple_id:uid}:null,error:null}),single:async()=>({data:{status:'active'},error:null})}),rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:[],error:null};}}} as unknown as Context;
 return {ctx,calls};
}
const req=(method:string,body?:unknown,suffix='schedules')=>new Request(`https://duet.example/api/duet/calendar/${suffix}`,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
test('schedule routes derive ownership in SQL and reject forged owner/couple fields before writing',async()=>{
 const {ctx,calls}=mock();
 assert.equal((await personalScheduleRoutes(req('POST',input),['calendar','schedules'],ctx))?.status,201);
 assert.deepEqual(calls[0],{name:'duet_create_personal_schedule',args:{p_title:'Work',p_starts_at:input.startsAt,p_ends_at:input.endsAt,p_timezone:input.timezone,p_note:''}});
 for(const extra of [{owner_id:uid},{coupleId:uid},{endsAt:input.startsAt},{timezone:'bad'}]){
  await assert.rejects(personalScheduleRoutes(req('POST',{...input,...extra}),['calendar','schedules'],ctx));
 }
 assert.equal(calls.length,1);
 const {ctx:unpaired}=mock(false);
 await assert.rejects(personalScheduleRoutes(req('POST',input),['calendar','schedules'],unpaired),/not_paired/);
});
test('range endpoints reject invalid or oversized ranges and send bounded RPC arguments',async()=>{
 const {ctx,calls}=mock();
 const query='free-time?from=2099-01-01T00:00:00Z&to=2099-01-02T00:00:00Z';
 assert.equal((await personalScheduleRoutes(req('GET',undefined,query),['calendar','free-time'],ctx))?.status,200);
 assert.equal(calls[0].name,'duet_common_free_time');
 for(const query of ['schedules?from=bad&to=bad','schedules?from=2099-01-02T00:00:00Z&to=2099-01-01T00:00:00Z','schedules?from=2099-01-01T00:00:00Z&to=2101-01-01T00:00:00Z'])await assert.rejects(personalScheduleRoutes(req('GET',undefined,query),['calendar','schedules'],ctx));
 assert.equal(calls.length,1);
 assert.match(await failure(new Error()).text(),/Unable to complete/);
});

test('all-day intent reaches the schedule RPC and is rejected unless both endpoints are midnight',async()=>{
 const {ctx,calls}=mock();
 const allDay={...input,startsAt:'2099-01-01T16:00:00Z',endsAt:'2099-01-02T16:00:00Z',allDay:true};
 assert.equal((await personalScheduleRoutes(req('POST',allDay),['calendar','schedules'],ctx))?.status,201);
 assert.equal((calls[0].args as Record<string,unknown>).p_all_day,true);
 await assert.rejects(personalScheduleRoutes(req('POST',{...allDay,startsAt:'2099-01-01T17:00:00Z'}),['calendar','schedules'],ctx));
 assert.equal(calls.length,1);
});
