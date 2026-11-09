import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceSession,WorkspaceNavigation,PageHeader,MeMenu} from '../src/components/duet-workspace';
import {SharedCalendar} from '../src/components/shared-calendar';
import {PetShowcase} from '../src/components/pet-showcase';
import type {AccountState} from '../src/components/use-account';
test('paired users open Home with four primary destinations, not standalone Map or Us tabs',()=>{
  const account={userId:'10000000-0000-4000-8000-000000000001',email:'a@example.test',error:'',data:{pets:[{id:'pet',kind:'cat',owner_id:'10000000-0000-4000-8000-000000000001',name:'Momo',breed:'Devon Rex',appearance:{}}],profile:{id:'10000000-0000-4000-8000-000000000001',display_name:'A',gender:'male',profile_initialized:true},couple:{coupleId:'20000000-0000-4000-8000-000000000001',members:[{user_id:'a'},{user_id:'b'}]}},refresh:async()=>{},signOut:async()=>{}} as unknown as AccountState;
  const html=renderToStaticMarkup(createElement(WorkspaceSession,{account}));
  assert.ok(html.indexOf('</header>')<html.indexOf('class="home-hero-video"'));
  assert.ok(html.indexOf('class="home-hero-video"')<html.indexOf('class="pet-home '));
  assert.doesNotMatch(html,/Song surprise|Our pets|pet-showcase|A little song/);
  assert.match(html,/>DUET<\/h1>/);
  assert.doesNotMatch(html,/Sign out/);
  const nav=html.match(/<nav aria-label="Main navigation"[\s\S]*?<\/nav>/)?.[0]??'';
  assert.equal((nav.match(/<button/g)??[]).length,4);
  assert.match(nav,/aria-label="Home" aria-current="page"/);
  assert.doesNotMatch(nav,/Map|Us/);
});

test('Calendar exposes Story and date details contain only daily schedules',()=>{
  for(const detailsOpen of [false,true]){
    const html=renderToStaticMarkup(createElement(SharedCalendar,{userId:'me',detailsOpen,onToggleDetails:()=>{},
      petContent:createElement(PetShowcase,{userId:'me',timezone:'Asia/Shanghai',active:true}),
      detailsContent:createElement('p',null,'Shared lists test marker')}));
    const pets=html.indexOf('aria-label="Our pets"');
    assert.ok(pets>0);assert.ok(html.indexOf('>Story</button>')<pets);
    assert.equal(html.includes('Shared lists test marker'),false);
    assert.equal(html.includes('calendar-schedule-details'),detailsOpen);

    assert.doesNotMatch(html,/>Push<|>Events<|>Refresh<|>Saved entries</);
  }
});


test('primary destinations use the same four approved icons and preserve accessible labels',()=>{
  const html=renderToStaticMarkup(createElement(WorkspaceNavigation,{active:'chat',unread:2,onSelect:()=>{}}));
  for(const [key,label] of [['home','Home'],['chat','Chat'],['calendar','Calendar'],['me','Me']]){
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.ok(html.includes(`/mobile/assets/${key}.svg`));
  }
  assert.equal((html.match(/aria-current="page"/g)??[]).length,1);
  assert.match(html,/aria-label="Chat" aria-current="page"/);
  assert.match(html,/aria-label="2 unread"/);
});

test('Me groups approved destinations under Space and subpages share the gold chevron header',()=>{
  const menu=renderToStaticMarkup(createElement(MeMenu,{unread:3,onOpen:()=>{}}));
  assert.equal((menu.match(/<button/g)??[]).length,5);
  for(const title of ['Inbox','Pets','Court Archive','Space','Feedback']) assert.ok(menu.includes(title));
  assert.doesNotMatch(menu,/Privacy|Lists|Partner/);
  const header=renderToStaticMarkup(createElement(PageHeader,{title:'Account',onBack:()=>{}}));
  assert.match(header,/aria-label="Back"/);
  assert.match(header,/<path d="m14 5-7 7 7 7"/);
  assert.match(header,/<h1>Account<\/h1>/);
  assert.doesNotMatch(header,/<nav/);
});
