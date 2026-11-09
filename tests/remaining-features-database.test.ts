import test from 'node:test';
import assert from 'node:assert/strict';
import {database,paired,asUser,scalar,users,admin} from './helpers/database';

test('voice messages require ready owned chat audio, never another user or image media',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);
  const media=await scalar<{id:string}>(db,"select duet_register_media('chat','audio/mp4') as value");
  await assert.rejects(()=>db.query("select duet_send_message('audio','',$1::jsonb)",[JSON.stringify({media_id:media!.id})]),/not_found/);
  await admin(db);await db.query('select duet_media_uploaded($1)',[media!.id]);await asUser(db,users.b);
  await assert.rejects(()=>db.query("select duet_send_message('audio','',$1::jsonb)",[JSON.stringify({media_id:media!.id})]),/not_found/);
  await asUser(db,users.a);await db.query("select duet_send_message('audio','',$1::jsonb)",[JSON.stringify({media_id:media!.id})]);
  const image=await scalar<{id:string}>(db,"select duet_register_media('chat','image/png') as value");await admin(db);await db.query('select duet_media_uploaded($1)',[image!.id]);await asUser(db,users.a);
  await assert.rejects(()=>db.query("select duet_send_message('audio','',$1::jsonb)",[JSON.stringify({media_id:image!.id})]),/not_found/);
 }finally{await db.close();}
});

test('shared Duet context excludes private history, other spaces, and legacy draw answers; reply is idempotent',async()=>{
 const db=await database();try{
  const couple=await paired(db,users.a,users.b);await paired(db,users.c,users.d);await asUser(db,users.a);
  await db.query("select duet_agent_begin_turn('private secret',true)");
  const message=await scalar(db,"select duet_send_message('text','@Duet 帮我们想想约会','{}') as value");
  const context=await scalar<{messages:unknown[]}>(db,'select duet_shared_ai_context($1) as value',[message]);
  assert.match(JSON.stringify(context),/约会/);assert.doesNotMatch(JSON.stringify(context),/private secret/);
  await asUser(db,users.c);await assert.rejects(()=>db.query('select duet_shared_ai_context($1)',[message]),/not_found/);
  await asUser(db,users.a);await assert.rejects(()=>db.query("select duet_finish_shared_ai($1,$2,'reply')",[users.a,message]),/permission denied/);
  await admin(db);await db.exec('set role service_role');
  await db.query("select duet_finish_shared_ai($1,$2,'reply')",[users.a,message]);await db.query("select duet_finish_shared_ai($1,$2,'reply')",[users.a,message]);
  await asUser(db,users.b);assert.equal(await scalar<number>(db,"select count(*)::int as value from messages where couple_id=$1 and metadata->>'agent'='duet'",[couple]),1);
 }finally{await db.close();}
});

test('weekly suggestion reservation is shared by the pair and cannot be acquired twice concurrently',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);
  const first=await scalar<{acquired:boolean;token:string}>(db,'select duet_reserve_weekly_date() as value');assert.equal(first!.acquired,true);
  await asUser(db,users.b);const second=await scalar<{acquired:boolean}>(db,'select duet_reserve_weekly_date() as value');assert.equal(second!.acquired,false);
  await assert.rejects(()=>db.query("select duet_finish_weekly_date($1,null,'待补空档')",[first!.token]),/not_found/);
  await asUser(db,users.a);await db.query("select duet_finish_weekly_date($1,null,'请先分享共同空档')",[first!.token]);
  await asUser(db,users.b);const cached=await scalar<{message:string}>(db,'select duet_reserve_weekly_date() as value');assert.equal(cached!.message,'请先分享共同空档');
 }finally{await db.close();}
});

test('only a pet owner can edit its breed, name and selected appearance',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);const pet=await scalar(db,"select duet_claim_pet('cat','德文','猫') as value");
  await db.query("select duet_update_pet($1,'Devon Rex','Momo','midnight')",[pet]);
  assert.equal(await scalar(db,'select name as value from pets where id=$1',[pet]),'Momo');
  await asUser(db,users.b);await assert.rejects(()=>db.query("select duet_update_pet($1,'X','X','classic')",[pet]),/not_found/);
 }finally{await db.close();}
});
test('photo feeds require a ready owned image and deliver its attachment to the partner',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);const pet=await scalar(db,"select duet_claim_pet('cat','德文','猫') as value");
  const media=await scalar<{id:string}>(db,"select duet_register_media('feed','image/png') as value");
  await assert.rejects(()=>db.query("select duet_feed_pet($1,'image',$2,'Q','早安')",[pet,media!.id]),/not_found/);
  await admin(db);await db.query('select duet_media_uploaded($1)',[media!.id]);await asUser(db,users.a);
  await db.query("select duet_feed_pet($1,'image',$2,'Q','早安')",[pet,media!.id]);
  await asUser(db,users.b);assert.equal(await scalar(db,"select metadata->>'feed_media_id' as value from messages where metadata->>'source'='feed'"),media!.id);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from media where id=$1',[media!.id]),1);
 }finally{await db.close();}
});
