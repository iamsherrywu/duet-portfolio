import {test} from 'node:test';
import assert from 'node:assert/strict';
import {core} from '../src/lib/server/core';
import type {Context} from '../src/lib/supabase/server';
import {database,paired,asUser,admin,users,scalar} from './helpers/database';

test('removal API checks visibility before privileged write and scopes reads/writes to signed-in user',async()=>{
 const song='20000000-0000-4000-8000-000000000001';let visible=true,writes=0;
 const saved=new Map<string,string>();
 const service=()=>({from:(table:string)=>{assert.equal(table,'collection_hides');return {
  upsert:async(row:{user_id:string;song_id:string})=>{writes++;saved.set(row.user_id,row.song_id);return {error:null};},
  select:()=>({eq:async(column:string,value:string)=>{assert.equal(column,'user_id');return {data:saved.has(value)?[{song_id:saved.get(value)}]:[],error:null};}})
 };}});
 const context=(user:string)=>({user:{id:user},db:{from:(table:string)=>({select:()=>({eq:()=>({
  maybeSingle:async()=>({data:table==='couple_members'?{couple_id:'couple'}:visible?{id:song}:null,error:null}),
  single:async()=>({data:{status:'active'},error:null})
 })})})}} as unknown as Context);
 const call=(user:string,hide=false)=>core(new Request('http://localhost/api',{method:hide?'POST':'GET'}),hide?['songs',song,'hide']:['collection','hidden'],context(user),service as never);
 visible=false;await assert.rejects(call(users.a,true),/not_found/);assert.equal(writes,0);
 visible=true;await call(users.a,true);await call(users.a,true);assert.equal(saved.size,1);
 assert.deepEqual(await (await call(users.a))!.json(),{data:[{song_id:song}]});
 assert.deepEqual(await (await call(users.b))!.json(),{data:[]});
});

test('database stores personal hides idempotently without deleting songs or partner access',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);
  const song=await scalar<string>(db,"select public.duet_create_song('Song','Artist','','',null) as value");
  const box=await scalar<string>(db,"select public.duet_send_blind_box($1::jsonb,'') as value",[JSON.stringify([{song_id:song,mode:'none'}])]);
  await asUser(db,users.b);const draw=await scalar<{draw_id:string}>(db,'select public.duet_prepare_draw($1) as value',[box]);
  await db.query('select public.duet_complete_draw($1,null)',[draw.draw_id]);
  await admin(db);await db.exec('set role service_role');
  for(let i=0;i<2;i++)await db.query('insert into public.collection_hides(user_id,song_id) values($1,$2) on conflict(user_id,song_id) do nothing',[users.a,song]);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.collection_hides where user_id=$1',[users.a]),1);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.collection_hides where user_id=$1',[users.b]),0);
  await asUser(db,users.b);assert.equal(await scalar<number>(db,'select count(*)::int as value from public.song_cards where id=$1',[song]),1);
  await assert.rejects(db.query('select * from public.collection_hides'),/permission denied/);
  await asUser(db,users.outsider);assert.equal(await scalar<number>(db,'select count(*)::int as value from public.song_cards where id=$1',[song]),0);
 }finally{await db.close();}
});
