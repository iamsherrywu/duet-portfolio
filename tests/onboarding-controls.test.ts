import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceSession} from '../src/components/duet-workspace';
import {InviteSession} from '../src/components/invite-entry';
import {AuthEntry} from '../src/components/account-onboarding';
import type {AccountState} from '../src/components/use-account';

test('profile and pairing screens always show the current account and an exit',()=>{
  for(const gender of [null,'male']) {
    const account={userId:'a',email:'a@example.test',data:{pets:[],profile:{display_name:'A',gender},couple:{coupleId:null,members:[]}},error:'',refresh:async()=>{},signOut:async()=>{}} as AccountState;
    for(const component of [createElement(WorkspaceSession,{account}),createElement(InviteSession,{account,token:'a'.repeat(64)})]) {
      const html=renderToStaticMarkup(component);assert.match(html,/a@example.test/);assert.match(html,/<button[^>]*>Sign out(?: \/ switch account)?<\/button>/);
    }
  }
});

test('approved registration keeps required profile data and authenticated content remains gated',()=>{
  const html=renderToStaticMarkup(createElement(AuthEntry,{inviteToken:'a'.repeat(64)}));
  assert.match(html,/data-approved-screen="E02"/);
  for(const field of ['Email','Password','Name'])assert.ok(html.includes(field));
  assert.doesNotMatch(html,/>Gender<|>Birthday</); // These belong to the next profile step, not E02.
  assert.match(html,/type="email"[^>]*required|<input required="" type="email"/);
  assert.match(html,/Sign up and join/);
  assert.doesNotMatch(html,/Ready to join|This invitation is valid/);
});

test('invitation status reflects actual loading, errors and membership without demo status selectors',()=>{
  const base={userId:undefined,data:null,error:'',email:'',refresh:async()=>{},signOut:async()=>{}} as AccountState;
  const render=(account:AccountState,token='a'.repeat(64))=>renderToStaticMarkup(createElement(InviteSession,{account,token}));
  const loading=render(base);
  assert.match(loading,/aria-busy="true"/);assert.match(loading,/aria-label="Loading"/);assert.doesNotMatch(loading,/>Checking sign-in/);assert.doesNotMatch(loading,/Try again|Ready to join/);
  const failed=render({...base,error:'Connection failed.'});
  assert.match(failed,/role="alert"/);assert.match(failed,/Try again/);assert.doesNotMatch(failed,/aria-busy="true"|changes stay|Open Settings/);
  const invalid=render(base,'invalid');assert.match(invalid,/Invalid invitation link/);assert.doesNotMatch(invalid,/Checking sign-in/);
  const joined=render({...base,userId:'a',data:{pets:[],profile:{display_name:'A',gender:'male'},couple:{coupleId:'pair',members:[]}}} as AccountState);
  assert.match(joined,/Already in a space/);assert.match(joined,/Open my space/);
  for(const html of [loading,failed,invalid,joined])assert.doesNotMatch(html,/data-state=|status-tabs|This invitation is valid/);
});
