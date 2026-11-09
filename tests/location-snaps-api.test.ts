import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { core } from '../src/lib/server/core';
import type { Context } from '../src/lib/supabase/server';
import { users } from './helpers/database';

function context(rpc: (name: string, args?: Record<string, unknown>) => Promise<{data: unknown; error: null}>) {
  return { user: { id: users.a }, db: { rpc } } as unknown as Context;
}

test('location snaps API creates stories from media ID, caption and explicit map choice only', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx = context(async (name, args = {}) => {
    calls.push([name, args]);
    return { data: { id: 'snap-1' }, error: null };
  });
  const response = await core(new Request('https://duet.example/api/duet/stories', {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({mediaId:'10000000-0000-4000-8000-000000000099',caption:'hello',withLocation:true}),
  }), ['stories'], ctx);
  assert.ok(response);
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [['duet_create_location_snap', {
    p_media:'10000000-0000-4000-8000-000000000099',p_caption:'hello',p_with_location:true,
  }]]);
});

test('location snaps API creates a multi-photo group with one shared location refresh', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx = context(async (name, args = {}) => {
    calls.push([name, args]);
    return { data: { group_id: 'group-1', items: [] }, error: null };
  });
  const response = await core(new Request('https://duet.example/api/duet/stories', {
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({
      mediaIds:[
        '10000000-0000-4000-8000-000000000011',
        '10000000-0000-4000-8000-000000000012',
      ],caption:'By the river',coordinates:{latitude:31.2,longitude:121.5,accuracy:18},durationMinutes:30,
    }),
  }),['stories'],ctx);
  assert.ok(response);
  assert.equal(response.status,201);
  assert.deepEqual(calls,[['duet_create_location_story_group',{
    p_media_ids:['10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012'],
    p_caption:'By the river',p_latitude:31.2,p_longitude:121.5,p_accuracy_m:18,p_duration_minutes:30,
  }]]);
});

test('location snaps API creates a chat-only group without changing location sharing when GPS is unavailable', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx = context(async (name,args={})=>{calls.push([name,args]);return {data:{group_id:'group-2',items:[]},error:null};});
  const response=await core(new Request('https://duet.example/api/duet/stories',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({mediaIds:['10000000-0000-4000-8000-000000000011'],caption:'No map pin'}),
  }),['stories'],ctx);
  assert.ok(response);
  assert.deepEqual(calls,[['duet_create_location_story_group',{
    p_media_ids:['10000000-0000-4000-8000-000000000011'],p_caption:'No map pin',
    p_latitude:null,p_longitude:null,p_accuracy_m:null,p_duration_minutes:null,
  }]]);
});

test('location snaps API rejects empty, duplicate and oversized photo groups before database access', async()=>{
  let calls=0;
  const ctx=context(async()=>{calls+=1;return {data:null,error:null};});
  const id='10000000-0000-4000-8000-000000000011';
  for(const mediaIds of [[],[id,id],Array.from({length:11},(_,index)=>`10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`)]) {
    await assert.rejects(core(new Request('https://duet.example/api/duet/stories',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mediaIds}),
    }),['stories'],ctx),error=>error instanceof ZodError);
  }
  assert.equal(calls,0);
});

test('location snaps API rejects client-supplied author, couple, coordinates or time fields', async () => {
  let calls = 0;
  const ctx = context(async () => { calls += 1; return {data:null,error:null}; });
  await assert.rejects(core(new Request('https://duet.example/api/duet/stories', {
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({mediaId:'10000000-0000-4000-8000-000000000099',withLocation:true,latitude:31.2,longitude:121.5,authorId:users.b}),
  }), ['stories'], ctx), error=>error instanceof ZodError);
  assert.equal(calls,0);
});

test('location snaps API lists each scope and reads only the requested snap', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx = context(async (name,args={})=>{calls.push([name,args]);return {data:[],error:null};});
  const chat = await core(new Request('https://duet.example/api/duet/stories?scope=chat'),['stories'],ctx);
  const map = await core(new Request('https://duet.example/api/duet/stories?scope=map'),['stories'],ctx);
  const one = await core(new Request('https://duet.example/api/duet/stories/10000000-0000-4000-8000-000000000001'),['stories','10000000-0000-4000-8000-000000000001'],ctx);
  assert.ok(chat && map && one);
  assert.deepEqual(calls, [
    ['duet_list_location_snaps',{p_scope:'chat'}],
    ['duet_list_location_snaps',{p_scope:'map'}],
    ['duet_get_location_snap',{p_snap:'10000000-0000-4000-8000-000000000001'}],
  ]);
});

test('location snaps API marks views, saves with optional shared entry, and quotes in chat', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx = context(async (name,args={})=>{calls.push([name,args]);return {data:'ok',error:null};});
  const id='10000000-0000-4000-8000-000000000001';
  const entry='10000000-0000-4000-8000-000000000002';
  const view=await core(new Request(`https://duet.example/api/duet/stories/${id}/view`,{method:'POST'}),['stories',id,'view'],ctx);
  const save=await core(new Request(`https://duet.example/api/duet/stories/${id}/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkedEntryId:entry})}),['stories',id,'save'],ctx);
  const reply=await core(new Request('https://duet.example/api/duet/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'text',body:'回复',storyId:id})}),['messages'],ctx);
  assert.ok(view && save && reply);
  assert.deepEqual(calls, [
    ['duet_mark_location_snap_viewed',{p_snap:id}],
    ['duet_save_location_snap',{p_snap:id,p_linked_entry:entry}],
    ['duet_send_message',{p_kind:'text',p_body:'回复',p_metadata:{story_id:id}}],
  ]);
});

test('location snaps API requires a known scope and rejects unexpected save fields', async () => {
  let calls=0;
  const ctx=context(async()=>{calls+=1;return {data:null,error:null};});
  await assert.rejects(core(new Request('https://duet.example/api/duet/stories'),['stories'],ctx),error=>error instanceof ZodError);
  await assert.rejects(core(new Request('https://duet.example/api/duet/stories/10000000-0000-4000-8000-000000000001/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkedEntryId:null,coupleId:'fake'})}),['stories','10000000-0000-4000-8000-000000000001','save'],ctx),error=>error instanceof ZodError);
  assert.equal(calls,0);
});
