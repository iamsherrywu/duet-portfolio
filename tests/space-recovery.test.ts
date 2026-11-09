import test from 'node:test';
import assert from 'node:assert/strict';
import {core} from '../src/lib/server/core';
import type {Context} from '../src/lib/supabase/server';
test('approved space cleanup remains discoverable after active-space RPCs become unavailable',async()=>{
 const ctx={user:{id:'a'},db:{from:()=>({select:async()=>({data:[{user_id:'a',couple_id:'c'}],error:null})}),rpc:async()=>({data:null,error:{message:'space_inactive'}})}} as unknown as Context;
 const response=await core(new Request('https://example.test/api/duet/couple'),['couple'],ctx);const result=await response!.json();assert.equal(result.data.status,'deletion_approved');assert.deepEqual(result.data.profiles,[]);
});
test('deletion status can be read using RLS without requiring an active couple',async()=>{
 const ctx={user:{id:'a'},db:{from:()=>({select(){return this;},order(){return this;},limit:async()=>({data:[{id:'request',status:'approved'}],error:null})})}} as unknown as Context;
 const response=await core(new Request('https://example.test/api/duet/deletions'),['deletions'],ctx);const result=await response!.json();assert.equal(result.data[0].status,'approved');
});
