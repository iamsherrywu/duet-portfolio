import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { boxInput } from '../src/lib/server/schemas';
import { core } from '../src/lib/server/core';
import type { Context } from '../src/lib/supabase/server';
import { admin, asUser, database, paired, scalar, users } from './helpers/database';

type Draw = {draw_id:string;mode:'question'|'message'|'none';question:string|null;message:string|null};
let db:PGlite;
before(async()=>{db=await database();await paired(db,users.a,users.b);await paired(db,users.c,users.d);});
after(async()=>{await db?.close();});
async function songAndBox(item:Record<string,unknown>={},connection=db) {
  await asUser(connection,users.a);
  const song=await scalar<string>(connection,"select public.duet_create_song('Hidden song','Artist','','',null) as value");
  const box=await scalar<string>(connection,"select public.duet_send_blind_box($1::jsonb,'') as value",[JSON.stringify([{song_id:song,...item}])]);
  return {song,box};
}
async function prepare(box:string,connection=db) {
  await asUser(connection,users.b);
  return scalar<Draw>(connection,'select public.duet_prepare_draw($1) as value',[box]);
}
async function complete(draw:string,answer:string|null=null,connection=db) {
  return scalar<{id:string}>(connection,'select public.duet_complete_draw($1,$2) as value',[draw,answer]);
}

test('song box schema defaults old clients to questions and rejects contradictory mode payloads',()=>{
  const song_id=users.a;
  assert.deepEqual(boxInput.parse({items:[{song_id,question:'  '},{song_id,mode:'message',message:'  A little note  '},{song_id,mode:'none'}]}).items,[
    {song_id,mode:'question',question:''},{song_id,mode:'message',message:'A little note'},{song_id,mode:'none'},
  ]);
  for(const item of [
    {mode:'message'}, {mode:'message',message:'  '}, {mode:'message',message:'x'.repeat(2001)},
    {mode:'none',question:''},{mode:'none',message:''},{mode:'message',message:'hi',question:''},
    {mode:'question',message:''},{mode:'skip'},{mode:null},{question:null},{message:12},
  ])assert.equal(boxInput.safeParse({items:[{song_id,...item}]}).success,false,JSON.stringify(item));
});

test('completion API permits empty input but leaves mode enforcement to the stored draw',async()=>{
  const calls:Array<[string,Record<string,unknown>]> = [];
  const ctx={user:{id:users.b},db:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push([name,args]);return {data:{id:'song'},error:null};}}} as unknown as Context;
  const request=(body:unknown)=>new Request('https://duet.test/api/duet/draws/id/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await core(request({}),['draws',users.a,'answer'],ctx);
  assert.deepEqual(await response!.json(),{data:{id:'song'}});
  assert.deepEqual(calls,[['duet_complete_draw',{p_draw:users.a,p_answer:null}]]);
  for(const body of [{mode:'none'},{answer:null},{answer:'x'.repeat(2001)}])await assert.rejects(core(request(body),['draws',users.a,'answer'],ctx));
  assert.equal(calls.length,1);
});

test('question draws use English fallback, stay hidden until answered, and notify sender exactly once',async()=>{
  const {song,box}=await songAndBox({question:' \t\n '});
  const draw=await prepare(box);
  assert.equal(draw.mode,'question');assert.equal(draw.message,null);
  assert.match(draw.question!,/^[A-Za-z].*\?$/);
  assert.deepEqual(Object.keys(draw).sort(),['draw_id','message','mode','question']);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.song_cards where id=$1',[song]),0);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.blind_box_items where box_id=$1',[box]),0);
  for(const answer of [null,' \t\n '])await assert.rejects(complete(draw.draw_id,answer),/answer_required/);
  assert.equal((await complete(draw.draw_id,'  The river  ')).id,song);
  assert.equal((await complete(draw.draw_id)).id,song);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.song_cards where id=$1',[song]),1);
  await admin(db);
  const answer=await db.query<{answer:string;id:string}>('select id,answer from public.prompt_answers where source_id=$1',[draw.draw_id]);
  assert.equal(answer.rows.length,1);assert.equal(answer.rows[0].answer,'The river');
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.blind_box_inbox where id=$1',[answer.rows[0].id]),1);
});

test('message and none unlock without answers or Inbox entries and preserve snapshot values',async()=>{
  for(const mode of ['message','none'] as const) {
    const {song,box}=await songAndBox(mode==='message'?{mode,message:' \n For the journey home \t '}:{mode});
    const draw=await prepare(box);
    assert.equal(draw.mode,mode);assert.equal(draw.question,null);
    assert.equal(draw.message,mode==='message'?'For the journey home':null);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.song_cards where id=$1',[song]),0);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.blind_box_items where box_id=$1',[box]),0);
    await assert.rejects(complete(draw.draw_id,'invented answer'),/answer_not_expected/);
    await admin(db);
    // A later item edit must not mutate the assigned draw's mode or message.
    await db.query("update public.blind_box_items set interaction_mode='question',message_text=null,custom_prompt='Changed?' where box_id=$1",[box]);
    assert.deepEqual(await prepare(box),draw);
    assert.equal((await complete(draw.draw_id)).id,song);
    assert.equal((await complete(draw.draw_id,' ')).id,song);
    await admin(db);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.prompt_answers where source_id=$1',[draw.draw_id]),0);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.blind_box_inbox where id in (select id from public.prompt_answers where source_id=$1)',[draw.draw_id]),0);
  }
});

test('direct RPC validates every item atomically, including nulls, types, whitespace, and irrelevant fields',async()=>{
  await asUser(db,users.a);
  const song=await scalar<string>(db,"select public.duet_create_song('Validation','Artist','','',null) as value");
  const invalidItems:unknown[]=[null,[],{},'text',
    {song_id:song,mode:'message'}, {song_id:song,mode:'message',message:'\t\n'},
    {song_id:song,mode:'message',message:'x'.repeat(2001)}, {song_id:song,mode:'message',message:42},
    {song_id:song,mode:'none',question:''}, {song_id:song,mode:'none',message:null},
    {song_id:song,mode:'message',message:'hello',question:''},{song_id:song,mode:'question',message:''},
    {song_id:song,mode:'skip'},{song_id:song,mode:null},{song_id:song,question:null},
    {song_id:song,question:12},{song_id:song,extra:true}, {song_id:42},
  ];
  await admin(db);
  const before=await scalar<number>(db,'select count(*)::int as value from public.blind_boxes');
  await asUser(db,users.a);
  for(const invalid of invalidItems)await assert.rejects(db.query("select public.duet_send_blind_box($1::jsonb,'')",[JSON.stringify([{song_id:song},invalid])]),/invalid_items/);
  for(const items of [null,{},[],[...Array(51)].map(()=>({song_id:song}))])await assert.rejects(db.query("select public.duet_send_blind_box($1::jsonb,'')",[items===null?null:JSON.stringify(items)]),/invalid_items/);
  await admin(db);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.blind_boxes'),before);
});

test('all modes enforce recipient/couple authorization; repeated queued requests cannot allocate twice',async()=>{
  for(const mode of ['question','message','none'] as const) {
    const {box,song}=await songAndBox(mode==='message'?{mode,message:'hello'}:{mode});
    await assert.rejects(db.query('select public.duet_prepare_draw($1)',[box]),/not_found/);
    const draw=await prepare(box);
    const requests=await Promise.all([...Array(5)].map(()=>scalar<Draw>(db,'select public.duet_prepare_draw($1) as value',[box])));
    assert.deepEqual(new Set(requests.map(row=>row.draw_id)),new Set([draw.draw_id]));
    for(const user of [users.a,users.c]) {
      await asUser(db,user);
      await assert.rejects(db.query('select public.duet_prepare_draw($1)',[box]),/not_found/);
      await assert.rejects(complete(draw.draw_id,'guess'),/not_found/);
    }
    await asUser(db,users.b);
    const opened=await Promise.all([...Array(5)].map(()=>complete(draw.draw_id,mode==='question'?'yes':null)));
    assert.ok(opened.every(row=>row.id===song));
    await assert.rejects(db.query('select public.duet_prepare_draw($1)',[box]),/box_empty/);
    await admin(db);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.draws where box_id=$1',[box]),1);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.prompt_answers where source_id=$1',[draw.draw_id]),mode==='question'?1:0);
  }
});

test('migration preserves legacy pending and completed questions, their answers, and unopened items',async()=>{
  const legacy=await database('202611020005_profile_edit.sql');
  try {
    await paired(legacy,users.a,users.b);
    const unopened=await songAndBox({},legacy);
    const pending=await songAndBox({question:'Where next?'},legacy);
    const pendingDraw=await prepare(pending.box,legacy);
    const done=await songAndBox({question:'Already answered?'},legacy);
    const doneDraw=await prepare(done.box,legacy);await complete(doneDraw.draw_id,'Yes',legacy);
    await admin(legacy);
    await legacy.exec(await readFile('supabase/migrations/202611030001_song_surprise_modes.sql','utf8'));
    assert.deepEqual(await prepare(pending.box,legacy),{...pendingDraw,mode:'question',message:null});
    await assert.rejects(complete(pendingDraw.draw_id,null,legacy),/answer_required/);
    assert.equal((await complete(doneDraw.draw_id,null,legacy)).id,done.song);
    const fresh=await prepare(unopened.box,legacy);assert.equal(fresh.mode,'question');assert.match(fresh.question!,/^[A-Za-z]/);
    await admin(legacy);
    assert.equal(await scalar<number>(legacy,"select count(*)::int as value from public.prompt_answers where source_type='draw'"),1);
    assert.equal(await scalar<number>(legacy,"select count(*)::int as value from public.blind_box_items where interaction_mode<>'question' or message_text is not null"),0);
  }finally{await legacy.close();}
});

test('mode columns reject invalid states and RPC grants remain authenticated-only',async()=>{
  await admin(db);
  for(const signature of ['duet_send_blind_box(jsonb,text)','duet_prepare_draw(uuid)','duet_complete_draw(uuid,text)']) {
    assert.equal(await scalar<boolean>(db,"select has_function_privilege('authenticated',$1,'execute') as value",[`public.${signature}`]),true);
    assert.equal(await scalar<boolean>(db,"select has_function_privilege('anon',$1,'execute') as value",[`public.${signature}`]),false);
  }
  const {box}=await songAndBox({mode:'none'});const draw=await prepare(box);await admin(db);
  await assert.rejects(db.query("update public.draws set interaction_mode='question',question=null where id=$1",[draw.draw_id]),/check constraint/);
  await assert.rejects(db.query("update public.blind_box_items set message_text='invalid' where box_id=$1",[box]),/check constraint/);
  const definition=await scalar<string>(db,"select pg_get_functiondef('public.duet_complete_draw(uuid,text)'::regprocedure) as value");
  assert.match(definition,/for update/i); // PGlite is single-connection; locking syntax protects actual Postgres contention.
});
