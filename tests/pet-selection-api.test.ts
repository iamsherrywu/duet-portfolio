import assert from 'node:assert/strict';
import {test} from 'node:test';
import {core} from '../src/lib/server/core';
import type {Context} from '../src/lib/supabase/server';
const request=()=>new Request('https://duet.example/api/duet/pets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'cat',breed:'Devon Rex',name:'团团'})});
test('a concurrent pet claim gives actionable feedback without changing the other owner',async()=>{
 const ctx={user:{id:'me'},db:{rpc:async()=>({data:null,error:{code:'23505',message:'duplicate key'}})}} as unknown as Context;
 await assert.rejects(core(request(),['pets'],ctx),/pet_taken/);
});
