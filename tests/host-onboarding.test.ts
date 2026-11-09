import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceSession} from '../src/components/duet-workspace';
import type {AccountState} from '../src/components/use-account';
import {database,asUser,scalar,users} from './helpers/database';

test('host goes from profile to invitation creation; partner cannot see a create-space action',()=>{
 const base={userId:'a',email:'a@example.test',data:{pets:[],profile:{id:'a',display_name:'A',gender:'male'},couple:{coupleId:null,members:[],isHost:true,canCreateSpace:true}},error:'',refresh:async()=>{},signOut:async()=>{}} as AccountState;
 const host=renderToStaticMarkup(createElement(WorkspaceSession,{account:base}));
 assert.match(host,/Invite your partner/);assert.match(host,/>Create<\/button>/);assert.doesNotMatch(host,/Accept invitation|Paste your invitation link/);
 const partner={...base,data:{...base.data!,couple:{coupleId:null,members:[],isHost:false,canCreateSpace:false}}} as AccountState;
 const html=renderToStaticMarkup(createElement(WorkspaceSession,{account:partner}));
 assert.match(html,/Accept invitation/);assert.doesNotMatch(html,/Create a new space|Invite your partner/);
});

test('an Auth email alone does not grant Host; preset creator can create and invite without an incoming link',async()=>{
 const db=await database();try{
  await asUser(db,users.b);
  await assert.rejects(db.query('select public.duet_create_couple()'),/not_allowed/);
  await asUser(db,users.a);
  assert.ok(await scalar(db,'select public.duet_create_couple() as value'));
  const token=await scalar<string>(db,'select public.duet_create_invitation() as value');
  assert.match(token,/^[a-f0-9]{64}$/);
 }finally{await db.close();}
});
