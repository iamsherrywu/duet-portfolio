import assert from 'node:assert/strict';
import {test} from 'node:test';
import {personalScheduleRoutes} from '../src/lib/server/personal-schedules';
import {datePlanningRoutes} from '../src/lib/server/date-planning';
import type {Context} from '../src/lib/supabase/server';
import type {AIMessage} from '../src/lib/ai/provider';
import {admin,asUser,database,paired,scalar,users} from './helpers/database';
test('real local API→SQL flow: partner sees schedule, AI avoids busy time, two in sync commits once',async()=>{
 const db=await database();try{
  const couple=await paired(db,users.a,users.b);const start=Date.now()+2*86400000;
  const t=(offset:number)=>new Date(start+offset*3600000).toISOString();
  const context=(owner:string)=>({user:{id:owner},db:{
   from:()=>({select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},maybeSingle:async()=>({data:{couple_id:couple},error:null}),single:async()=>({data:{status:'active'},error:null}),limit:async()=>({data:[],error:null})}),
   rpc:async(name:string,args:Record<string,unknown>={})=>{
    assert.match(name,/^duet_[a-z_]+$/);const keys=Object.keys(args);keys.forEach(key=>assert.match(key,/^p_[a-z_]+$/));
    try{return {data:await scalar(db,`select public.${name}(${keys.map((key,index)=>`${key} => $${index+1}`).join(',')}) as value`,Object.values(args)),error:null};}
    catch(error){return {data:null,error:{message:error instanceof Error?error.message:'database_error'}};}
   }
  }}) as unknown as Context;
  const request=(body:unknown)=>new Request('https://duet.example/api/duet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  await asUser(db,users.a);
  const schedule=await personalScheduleRoutes(request({title:'Work',startsAt:t(0),endsAt:t(1),timezone:'Asia/Shanghai'}),['calendar','schedules'],context(users.a));
  assert.equal(schedule?.status,201);
  await asUser(db,users.b);
  const query=new URLSearchParams({from:t(-1),to:t(6)});
  const read=await personalScheduleRoutes(new Request(`https://duet.example/api/duet/calendar/schedules?${query}`),['calendar','schedules'],context(users.b));
  const rows=(await read!.json()).data;assert.equal(rows[0].title,'Work');assert.equal(rows[0].owner_id,users.a);
  const provider={complete:async(messages:AIMessage[])=>{
   assert.equal(typeof messages[1].content,'string');
   const facts=JSON.parse(messages[1].content as string) as {commonSlots:Array<{start:string;end:string}>};
   assert.ok(!facts.commonSlots.some(slot=>Date.parse(slot.start)<Date.parse(t(1))&&Date.parse(slot.end)>Date.parse(t(0))));
   return JSON.stringify({title:'Dinner',startsAt:t(3),endsAt:t(4),timezone:'Asia/Shanghai',plan:'Dinner together'});
  }};
  const response=await datePlanningRoutes(request({kind:'todo'}),['date-planning','proposals'],context(users.b),provider);
  assert.equal(response?.status,201);const proposal=(await response!.json()).data;
  assert.equal(await scalar(db,'select count(*)::int as value from public.entries'),0);
  await datePlanningRoutes(request({version:1}),['date-planning','proposals',proposal.id,'confirm'],context(users.b),provider);
  await asUser(db,users.a);
  const confirmed=await datePlanningRoutes(request({version:1}),['date-planning','proposals',proposal.id,'confirm'],context(users.a),provider);
  assert.equal((await confirmed!.json()).data.status,'completed');
  await datePlanningRoutes(request({version:1}),['date-planning','proposals',proposal.id,'confirm'],context(users.a),provider);
  assert.equal(await scalar(db,'select count(*)::int as value from public.entries'),1);
  const free=await scalar<Array<{start:string;end:string}>>(db,'select public.duet_common_free_time($1,$2) as value',[t(2),t(5)]);
  assert.equal(free.length,2);
 }finally{await admin(db);await db.close();}
});
