import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commonAvailability,validateDatePlan} from '../src/lib/date-planning';
import {datePlanningRoutes,previewDatePreference} from '../src/lib/server/date-planning';
import type {Context} from '../src/lib/supabase/server';

const a='10000000-0000-4000-8000-000000000001';const b='10000000-0000-4000-8000-000000000002';
const slot=(owner_id:string,starts_at:string,ends_at:string,expires_at='2099-10-22T00:00:00Z')=>({id:owner_id,owner_id,starts_at,ends_at,expires_at,timezone:'Asia/Shanghai'});
const availability=[slot(a,'2099-10-21T08:00:00Z','2099-10-21T12:00:00Z'),slot(b,'2099-10-21T09:00:00Z','2099-10-21T11:00:00Z')];

test('date planning intersects both users slots and ignores expired availability',()=>{
  const result=commonAvailability([...availability,slot(b,'2099-10-21T07:00:00Z','2099-10-21T08:30:00Z','2020-01-01T00:00:00Z')],Date.parse('2099-10-20T00:00:00Z'));
  assert.deepEqual(result,[{start:'2099-10-21T09:00:00.000Z',end:'2099-10-21T11:00:00.000Z'}]);
  assert.deepEqual(commonAvailability([availability[0]],Date.parse('2099-10-20T00:00:00Z')),[]);
  assert.throws(()=>validateDatePlan({title:'Walk',startsAt:'2099-10-21T08:00:00Z',endsAt:'2099-10-21T10:00:00Z',timezone:'Asia/Shanghai',plan:'Walk'},result),/shared availability/);
});

test('date planning preview sends only the explicitly selected nonsecret source to the model',async()=>{
  let seen='';let calls=0;
  const provider={complete:async(messages:unknown[])=>{calls++;seen=JSON.stringify(messages);return '{"preference":"喜欢安静的公园"}';}};
  const preview=await previewDatePreference({owner_id:a,visibility:'askable',body:'I like quiet parks'},a,provider);
  assert.equal(preview,'喜欢安静的公园');assert.match(seen,/I like quiet parks/);
  await assert.rejects(previewDatePreference({owner_id:b,visibility:'askable',body:'Other history'},a,provider));
  await assert.rejects(previewDatePreference({owner_id:a,visibility:'confidential',body:'Secret history'},a,provider));
  assert.equal(calls,1);assert.doesNotMatch(seen,/Other history|Secret history/);
});

test('date planning API saves only valid model output and never writes an event directly',async()=>{
  const calls:string[]=[];let supplied='';
  const ctx={user:{id:a},db:{from:()=>({select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:{couple_id:a},error:null}),single:async()=>({data:{status:'active'},error:null})}),rpc:async(name:string)=>{
    calls.push(name);
    return {data:name==='duet_rate_limit'?true:name==='duet_get_date_context'?{hash:'snapshot',preferences:[],availability:[],busy:[],members:[a,b],window:{start:'2099-10-21T09:00:00Z',end:'2099-10-21T11:00:00Z'},wishes:[]}:a,error:null};
  }}} as unknown as Context;
  const input=()=>new Request('https://duet.example/api/duet/date-planning/proposals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'todo',requirements:'Keep it simple',wishIds:[]})});
  const provider={complete:async(messages:unknown[])=>{supplied=JSON.stringify(messages);return JSON.stringify({title:'A walk',startsAt:'2099-10-21T09:30:00Z',endsAt:'2099-10-21T10:30:00Z',timezone:'Asia/Shanghai',plan:'Take a quiet walk'});}};
  const result=await datePlanningRoutes(input(),['date-planning','proposals'],ctx,provider);
  assert.equal(result?.status,201);assert.equal(calls.filter(name=>name==='duet_create_date_proposal').length,1);
  assert.match(supplied,/Keep it simple/);assert.doesNotMatch(supplied,/agent_messages|birthday/);
  const writesBefore=calls.filter(name=>name==='duet_create_date_proposal').length;
  await assert.rejects(datePlanningRoutes(input(),['date-planning','proposals'],ctx,{complete:async()=>'{"title":"Bad","startsAt":"2099-10-21T08:30:00Z","endsAt":"2099-10-21T10:00:00Z","timezone":"Asia/Shanghai","plan":"Outside"}'}));
  await assert.rejects(datePlanningRoutes(input(),['date-planning','proposals'],ctx,{complete:async()=>{throw new Error('provider failed');}}));
  assert.equal(calls.filter(name=>name==='duet_create_date_proposal').length,writesBefore);
  assert.ok(calls.every(name=>!name.includes('entry')));
});
