import assert from 'node:assert/strict';
import {test} from 'node:test';
import {core} from '../src/lib/server/core';
import type {Context} from '../src/lib/supabase/server';
import {database,admin,asUser,users,scalar} from './helpers/database';

test('profile GET database clock values round-trip through profile PATCH',async()=>{
  const db=await database();
  try {
    await asUser(db,users.a);
    const profile=await scalar<Record<string,string>>(db,'select public.duet_get_my_profile() as value');
    const calls:Record<string,unknown>[]=[];
    const ctx={user:{id:users.a},db:{rpc:async(_name:string,args:Record<string,unknown>)=>{calls.push(args);return {data:null,error:null};}}} as unknown as Context;
    const result=await core(new Request('https://duet.example/api/duet/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Alice',timezone:profile.timezone,start:profile.afterwork_start,end:profile.afterwork_end})}),['profile'],ctx);
    assert.equal(result?.status,200);assert.equal(calls[0].p_start,profile.afterwork_start);
  }finally{await admin(db);await db.close();}
});
