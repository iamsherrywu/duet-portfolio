import assert from 'node:assert/strict';
import { test } from 'node:test';
import { core } from '../src/lib/server/core';
import { AppError, readJson } from '../src/lib/server/http';
import { boxInput } from '../src/lib/server/schemas';
import type { Context } from '../src/lib/supabase/server';

const songId='11111111-1111-4111-8111-111111111111';
const isTooLarge=(error:unknown)=>error instanceof AppError&&error.status===413&&error.code==='too_large';
const request=(body:string,path='boxes')=>new Request(`https://duet.test/api/duet/${path}`,{
  method:'POST',headers:{'content-type':'application/json'},body,
});
function context() {
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  const ctx={user:{id:songId},db:{rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});return {data:'box-id',error:null};
  }}} as unknown as Context;
  return {ctx,calls};
}

test('boxes accept 50 full-length Unicode messages within the bounded request limit',async()=>{
  // maxLength counts UTF-16 units: one emoji takes two; CJK takes one.
  for(const message of ['歌'.repeat(2000),'🎵'.repeat(1000),`${'歌'.repeat(1000)}${'🎵'.repeat(500)}`]) {
    const body=JSON.stringify({items:Array.from({length:50},()=>({song_id:songId,mode:'message',message}))});
    assert.equal(message.length,2000);
    assert.equal(boxInput.safeParse(JSON.parse(body)).success,true);
    assert.ok(Buffer.byteLength(body)>32768);
    assert.ok(Buffer.byteLength(body)<512*1024);
    const {ctx,calls}=context();
    const response=await core(request(body),['boxes'],ctx);
    assert.equal(response?.status,201);
    assert.equal(calls.length,1);
    assert.equal(calls[0].name,'duet_send_blind_box');
    assert.deepEqual(calls[0].args.p_items,JSON.parse(body).items);
  }
});

test('boxes reject requests over 512 KiB before touching the database',async()=>{
  const {ctx,calls}=context();
  // Whitespace pads an otherwise valid payload, so rejection measures bytes, not schema length.
  const body=JSON.stringify({items:[{song_id:songId,mode:'none'}]}).padEnd(512*1024+1,' ');
  await assert.rejects(core(request(body),['boxes'],ctx),isTooLarge);
  assert.deepEqual(calls,[]);
});

test('the shared parser and other routes retain the 32 KiB default',async()=>{
  const body=JSON.stringify({items:[{song_id:songId,mode:'message',message:'歌'.repeat(2000)}]}).padEnd(32769,' ');
  await assert.rejects(readJson(request(body),boxInput),isTooLarge);
  const {ctx,calls}=context();
  const songBody=JSON.stringify({title:'A song',artist:'An artist'}).padEnd(32769,' ');
  await assert.rejects(core(request(songBody,'songs'),['songs'],ctx),isTooLarge);
  assert.deepEqual(calls,[]);
});
