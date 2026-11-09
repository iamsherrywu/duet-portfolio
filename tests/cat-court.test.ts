import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatCourtVerdict, rewardForTask, addTemperaturePoints } from '../src/lib/cat-court';
import { core } from '../src/lib/server/core';
import { catCourtRoutes } from '../src/lib/server/cat-court';
import type { Context } from '../src/lib/supabase/server';
import { admin,asUser,database,paired,scalar,users } from './helpers/database';

const verdict={
  rootCause:'一方在意节省，另一方把分享食物理解为在意。',
  responsibility:{plaintiff:60,defendant:40},
  judgment:'本庭认为双方表达需求的方式不同。',
  articles:[
    {party:'plaintiff',name:'零食关怀条款',reason:'没有说明拒绝购买的原因。'},
    {party:'defendant',name:'情绪表达条款',reason:'没有直接说出期待。'},
  ],
  reconciliation:[
    {assignee:'plaintiff',kind:'reconcile',title:'主动提出一次和好拥抱。'},
    {assignee:'both',kind:'affection',title:'一起选一份想分享的小零食。'},
  ],
};

test('cat court accepts a structured playful judgment and derives rewards from task kinds',()=>{
  const parsed=parseCatCourtVerdict(JSON.stringify(verdict));
  assert.equal(parsed.responsibility.plaintiff+parsed.responsibility.defendant,100);
  assert.deepEqual(parsed.reconciliation.map(task=>rewardForTask(task.kind)),[8,2]);
});

test('cat court rejects responsibility splits that do not total 100 percent',()=>{
  assert.throws(()=>parseCatCourtVerdict(JSON.stringify({...verdict,responsibility:{plaintiff:60,defendant:30}})),/invalid_cat_court_verdict/);
});

test('cat court ignores model-supplied point awards and keeps heat within 0–100',()=>{
  const manipulated={...verdict,reconciliation:[{assignee:'plaintiff',kind:'reconcile',title:'和好',points:999999}]};
  assert.throws(()=>parseCatCourtVerdict(JSON.stringify(manipulated)),/invalid_cat_court_verdict/);
  assert.equal(addTemperaturePoints(80,10),90);
  assert.equal(addTemperaturePoints(99,8),100);
});

test('cat court keeps original arguments shared, gates each round, and awards shared temperature once',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);
    await asUser(db,users.a);
    const caseId=await scalar<string>(db,'select public.duet_cat_court_create_case() as value');
    await db.query('select public.duet_cat_court_file_case($1)',[caseId]);
    await admin(db);
    const invitationId=await scalar<string>(db,'select id as value from public.cat_court_invitations where case_id=$1',[caseId]);
    await asUser(db,users.b);
    await db.query('select public.duet_cat_court_accept_invitation($1)',[invitationId]);
    await db.query('select public.duet_cat_court_ready($1)',[caseId]);
    await asUser(db,users.a);
    await db.query('select public.duet_cat_court_ready($1)',[caseId]);
    await db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'原告开庭陈述']);
    await asUser(db,users.b);
    let listed=await scalar<{temperature:number;cases:Array<{plaintiff_id:string;statements:Array<{body:string}>;tasks:Array<{id:string;points:number}>}>}>(db,'select public.duet_cat_court_list() as value');
    assert.deepEqual(listed.cases[0].statements.map(row=>row.body),['原告开庭陈述']);
    await assert.rejects(db.query('select public.duet_cat_court_submit_statement($1,1::smallint,$2)',[caseId,'越级一辩']),/round_not_ready/);
    await db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'被告开庭陈述']);
    for(const round of [1,2]) {
      await asUser(db,users.a);await db.query('select public.duet_cat_court_submit_statement($1,$2::smallint,$3)',[caseId,round,`原告第${round}轮`]);
      await asUser(db,users.b);await db.query('select public.duet_cat_court_submit_statement($1,$2::smallint,$3)',[caseId,round,`被告第${round}轮`]);
    }
    const payload={rootCause:'双方诉求不同。',responsibility:{plaintiff:60,defendant:40},judgment:'各自表达需求。',articles:[{party:'plaintiff',name:'零食条款',reason:'忽略分享期待。'}],reconciliation:[
      {assignee:'both',kind:'reconcile',title:'一起和好。'},
      {assignee:'plaintiff',kind:'affection',title:'原告主动表达关心，被告确认。'},
      {assignee:'defendant',kind:'agreement',title:'被告说明下次的约定，原告确认。'},
    ]};
    await assert.rejects(db.query('select public.duet_cat_court_save_verdict($1,$2)',[caseId,payload]),/permission denied/);
    await assert.rejects(db.query('select public.duet_cat_court_store_ai_verdict($1,$2,$3)',[caseId,users.b,payload]),/permission denied/);
    await admin(db);await db.exec('set role service_role');
    await db.query('select public.duet_cat_court_store_ai_verdict($1,$2,$3)',[caseId,users.b,payload]);
    await asUser(db,users.b);
    listed=await scalar(db,'select public.duet_cat_court_list() as value');
    assert.equal(listed.temperature,80);
    let expected=80;
    assert.equal(listed.cases[0].tasks.length,3);
    for(const task of listed.cases[0].tasks) {
      await asUser(db,users.a);
      assert.equal(await scalar(db,'select public.duet_cat_court_complete_task($1) as value',[task.id]),expected);
      expected+=task.points;
      await asUser(db,users.b);
      assert.equal(await scalar(db,'select public.duet_cat_court_complete_task($1) as value',[task.id]),expected);
      assert.equal(await scalar(db,'select public.duet_cat_court_complete_task($1) as value',[task.id]),expected);
    }
    await paired(db,users.c,users.d);await asUser(db,users.c);
    assert.deepEqual((await scalar<{cases:unknown[]}>(db,'select public.duet_cat_court_list() as value')).cases,[]);
    await assert.rejects(db.query('select public.duet_cat_court_complete_task($1)',[listed.cases[0].tasks[0].id]),/not_found/);
  } finally {await admin(db);await db.close();}
});

test('first court opener reserves plaintiff; filing sends a private invite that the defendant must accept',async()=>{
  const db=await database();try{
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const caseId=await scalar(db,'select public.duet_cat_court_create_case() as value');
    assert.equal(await scalar(db,'select public.duet_cat_court_create_case() as value'),caseId);
    const parties=await scalar<{cases:Array<{id:string;plaintiff_id:string;defendant_id:string;invitation_sent_at:string|null;accepted_at:string|null}>}>(db,'select public.duet_cat_court_list() as value');
    const openingCase=parties.cases.find(item=>item.id===caseId)!;
    assert.equal(openingCase.plaintiff_id,users.a);assert.equal(openingCase.defendant_id,users.b);assert.equal(openingCase.accepted_at,null);
    assert.equal(openingCase.invitation_sent_at,null);
    await assert.rejects(db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'Opening']),/invitation_not_accepted/);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.cat_court_invitations'),0);
    const invitesForPlaintiff=await scalar<{items:unknown[]}>(db,'select public.duet_list_cat_court_invitations() as value');
    assert.deepEqual(invitesForPlaintiff.items,[]);
    await asUser(db,users.b);
    assert.equal((await scalar<{items:unknown[]}>(db,'select public.duet_list_cat_court_invitations() as value')).items.length,0);
    await assert.rejects(db.query('select public.duet_cat_court_file_case($1)',[caseId]),/not_plaintiff/);
    await asUser(db,users.a);
    assert.equal(await scalar(db,'select public.duet_cat_court_file_case($1) as value',[caseId]),caseId);
    assert.equal(await scalar(db,'select public.duet_cat_court_file_case($1) as value',[caseId]),caseId);
    await asUser(db,users.b);
    const inbox=await scalar<{items:Array<{id:string;case_id:string;accepted_at:string|null;sender_name:string}>}>(db,'select public.duet_list_cat_court_invitations() as value');
    assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].case_id,caseId);assert.equal(inbox.items[0].accepted_at,null);
    assert.equal(await scalar(db,'select public.duet_cat_court_accept_invitation($1) as value',[inbox.items[0].id]),caseId);
    await assert.rejects(db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'Accepted hearing']),/court_not_ready/);
    await db.query('select public.duet_cat_court_ready($1)',[caseId]);
    await assert.rejects(db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'Only one is ready']),/court_not_ready/);
    const oneReady=await scalar<{cases:Array<{plaintiff_ready_at:string|null;defendant_ready_at:string|null}>}>(db,'select public.duet_cat_court_list() as value');
    assert.equal(oneReady.cases[0].plaintiff_ready_at,null);
    assert.ok(oneReady.cases[0].defendant_ready_at);
    await asUser(db,users.a);
    await db.query('select public.duet_cat_court_ready($1)',[caseId]);
    await asUser(db,users.b);
    await db.query('select public.duet_cat_court_submit_statement($1,0::smallint,$2)',[caseId,'Accepted hearing']);
    assert.equal(await scalar(db,'select public.duet_cat_court_create_case() as value'),caseId);
    const accepted=await scalar<{items:Array<{id:string;case_id:string;accepted_at:string|null}>}>(db,'select public.duet_list_cat_court_invitations() as value');
    assert.equal(accepted.items[0].accepted_at!==null,true);
    assert.equal((await db.query("select id from public.messages where metadata ? 'cat_court_case_id'")).rows.length,0);
    await paired(db,users.c,users.d);await asUser(db,users.c);
    await assert.rejects(db.query('select public.duet_cat_court_accept_invitation($1)',[inbox.items[0].id]),/not_found/);
    await assert.rejects(db.query('select public.duet_cat_court_ready($1)',[caseId]),/not_found/);
    assert.equal((await scalar<{items:unknown[]}>(db,'select public.duet_list_cat_court_invitations() as value')).items.length,0);
    const secondCase=await scalar<string>(db,'select public.duet_cat_court_create_case() as value');
    const secondBundle=await scalar<{cases:Array<{id:string;plaintiff_id:string;defendant_id:string}>}>(db,'select public.duet_cat_court_list() as value');
    const second=secondBundle.cases.find(item=>item.id===secondCase)!;
    assert.equal(second.plaintiff_id,users.c);assert.equal(second.defendant_id,users.d);
    assert.equal((await scalar<{items:unknown[]}>(db,'select public.duet_list_cat_court_invitations() as value')).items.length,0);
    await db.query('select public.duet_cat_court_file_case($1)',[secondCase]);
    await asUser(db,users.d);
    assert.equal((await scalar<{items:Array<{case_id:string}>}>(db,'select public.duet_list_cat_court_invitations() as value')).items[0].case_id,secondCase);
    await admin(db);await db.exec('set role service_role');
    await assert.rejects(db.query('select public.duet_cat_court_store_ai_verdict($1,$2,$3)',[caseId,users.c,verdict]),/not_found/);
  }finally{await admin(db);await db.close();}
});

test('Inbox includes private Cat Judge invitations in its unread count',async()=>{
  const calls:string[]=[];
  const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{couple_id:'couple'},error:null}),single:async()=>({data:{status:'active'},error:null}),order:()=>query,limit:async()=>({data:[],error:null})};
  const ctx={user:{id:users.b},db:{from:()=>query,rpc:async(name:string)=>{
    calls.push(name);
    return {data:name==='duet_list_blind_box_inbox'?{items:[],unreadCount:2,nextCursor:null}:{items:[{id:'invite',accepted_at:null,read_at:null}]},error:null};
  }}} as unknown as Context;
  const response=await core(new Request('https://duet.example/api/duet/inbox'),['inbox'],ctx,()=>({from:()=>query}) as any);
  const body=await response!.json() as {data:{unreadCount:number;courtInvitations:Array<{id:string}>}};
  assert.deepEqual(calls,['duet_list_blind_box_inbox','duet_list_cat_court_invitations']);
  assert.equal(body.data.unreadCount,3);assert.equal(body.data.courtInvitations[0].id,'invite');
});

test('Cat Court invite acceptance endpoint derives the case from the private invite',async()=>{
  const invitationId='10000000-0000-4000-8000-000000000099';const calls:Array<[string,Record<string,unknown>]> = [];
  const ctx={user:{id:users.b},db:{rpc:async(name:string,args:Record<string,unknown>={})=>{calls.push([name,args]);return {data:'case-1',error:null};}}} as unknown as Context;
  const response=await catCourtRoutes(new Request(`https://duet.example/api/duet/cat-court/invitations/${invitationId}/accept`,{method:'POST'}),['cat-court','invitations',invitationId,'accept'],ctx);
  assert.deepEqual(calls,[['duet_cat_court_accept_invitation',{p_invitation:invitationId}]]);
  assert.deepEqual(await response!.json(),{data:{caseId:'case-1'}});
});

test('filing a Cat Court case uses the case path and authenticated plaintiff identity',async()=>{
  const caseId='10000000-0000-4000-8000-000000000098';const calls:Array<[string,Record<string,unknown>]> = [];
  const ctx={user:{id:users.a},db:{rpc:async(name:string,args:Record<string,unknown>={})=>{calls.push([name,args]);return {data:caseId,error:null};}}} as unknown as Context;
  const response=await catCourtRoutes(new Request(`https://duet.example/api/duet/cat-court/cases/${caseId}/file`,{method:'POST'}),['cat-court','cases',caseId,'file'],ctx);
  assert.deepEqual(calls,[['duet_cat_court_file_case',{p_case:caseId}]]);
  assert.deepEqual(await response!.json(),{data:{id:caseId}});
});


test('Court readiness endpoint only records the authenticated party, not a client-supplied identity',async()=>{
  const caseId='10000000-0000-4000-8000-000000000098';const calls:Array<[string,Record<string,unknown>]> = [];
  const ctx={user:{id:users.a},db:{rpc:async(name:string,args:Record<string,unknown>={})=>{calls.push([name,args]);return {data:caseId,error:null};}}} as unknown as Context;
  const response=await catCourtRoutes(new Request(`https://duet.example/api/duet/cat-court/cases/${caseId}/ready`,{method:'POST'}),['cat-court','cases',caseId,'ready'],ctx);
  assert.deepEqual(calls,[['duet_cat_court_ready',{p_case:caseId}]]);
  assert.deepEqual(await response!.json(),{data:{id:caseId}});
});
