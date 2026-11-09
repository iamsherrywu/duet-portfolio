import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountStep,inviteTokenFromInput,accountUser} from '../src/lib/onboarding';
import {createClient} from '@supabase/supabase-js';

test('onboarding requires first profile completion and pairing before entering shared content',()=>{
  assert.equal(accountStep({userId:null,profile:null,coupleId:null}),'sign-in');
  assert.equal(accountStep({userId:'a',profile:{display_name:'',gender:null},coupleId:null}),'profile');
  assert.equal(accountStep({userId:'a',profile:{display_name:'A',gender:'male'},coupleId:null}),'pair');
  assert.equal(accountStep({userId:'a',profile:{display_name:'A',gender:'male'},coupleId:'c'}),'ready');
});

test('onboarding accepts only complete invitation tokens or recognized invite paths',()=>{
  const token='a'.repeat(64);
  assert.equal(inviteTokenFromInput(token),token);
  assert.equal(inviteTokenFromInput(`https://duet.example/invite/${token}`),token);
  assert.equal(inviteTokenFromInput(`https://duet.example/invite/${token}?extra=ignored`),token);
  assert.equal(inviteTokenFromInput('bad-token'),null);
  assert.equal(inviteTokenFromInput(`https://duet.example/other/${token}`),null);
});

test('onboarding treats a real Supabase missing session as signed out but preserves other errors',async()=>{
  const db=createClient('https://example.supabase.co','public-test-key',{auth:{persistSession:false}});
  const result=await db.auth.getUser();
  assert.equal(result.error?.name,'AuthSessionMissingError');
  assert.equal(accountUser(result),null);
  assert.throws(()=>accountUser({data:{user:null},error:new Error('network unavailable')}),/network unavailable/);
  assert.deepEqual(accountUser({data:{user:{id:'a'}},error:null}),{id:'a'});
});
