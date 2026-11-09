import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {PET_ART,petArt,availablePetKinds} from '../src/lib/pets';
import {PetChooser} from '../src/components/pet-selection';
test('twelve supplied appearances resolve within species and legacy pets retain a safe default',()=>{
 assert.equal(PET_ART.filter(p=>p.kind==='cat').length,7);assert.equal(PET_ART.filter(p=>p.kind==='dog').length,5);
 for(const art of PET_ART){assert.ok(existsSync(`public${art.src}`));assert.equal(petArt({kind:art.kind,breed:art.breed}).id,art.id);}
 assert.deepEqual(PET_ART.filter(p=>p.kind==='cat'&&['Abyssinian','Bengal','Siamese'].includes(p.breed)).map(({id,breed,label})=>({id,breed,label})),[
  {id:'cat-abyssinian',breed:'Abyssinian',label:'Abyssinian'},
  {id:'cat-bengal',breed:'Bengal',label:'Bengal'},
  {id:'cat-siamese',breed:'Siamese',label:'Siamese'},
 ]);
 assert.equal(petArt({kind:'cat',breed:'Old custom cat'}).kind,'cat');
 assert.equal(petArt({kind:'cat',breed:'Silver Shorthair'}).id,'cat-devon');
 assert.equal(petArt({kind:'cat',breed:'Silver Shorthair'}).breed,'Devon Rex');
 assert.equal(petArt({kind:'dog',breed:'Devon Rex'}).kind,'dog');
 assert.equal(petArt({kind:'cat',breed:'德文'}).breed,'Devon Rex');
 assert.deepEqual(availablePetKinds([{kind:'cat',owner_id:'partner'}],'me'),['dog']);
 assert.deepEqual(availablePetKinds([{kind:'cat',owner_id:'me'},{kind:'dog',owner_id:'partner'}],'me'),['cat']);
});
test('adoption disables a partner-owned species; settings only show same-species appearances',()=>{
 const props={kind:'dog' as const,breed:'West Highland White Terrier',onKindChange:()=>{},onBreedChange:()=>{}};
 const adoption=render(createElement(PetChooser,{...props,availableKinds:['dog']}));
 assert.match(adoption,/<button[^>]*disabled=""[^>]*>Cat/);assert.match(adoption,/Partner’s pet/);
 const settings=render(createElement(PetChooser,{...props,availableKinds:['dog'],locked:true}));
 assert.doesNotMatch(settings,/>Cat</);assert.match(settings,/Westie/);assert.doesNotMatch(settings,/Devon Rex/);
});
test('cat chooser lists each new breed once and omits Silver Shorthair',()=>{
 const html=render(createElement(PetChooser,{kind:'cat',breed:'Silver Shorthair',availableKinds:['cat'],onKindChange:()=>{},onBreedChange:()=>{}}));
 for(const label of ['Abyssinian','Bengal','Siamese'])assert.equal((html.match(new RegExp(`>${label}</span>`,'g'))??[]).length,1);
 assert.doesNotMatch(html,/Silver/);
 assert.match(html,/cat-devon\.png/);
});
import {WorkspaceSession} from '../src/components/duet-workspace';
import type {AccountState} from '../src/components/use-account';
test('first signed-in visit chooses a pet before Home and an existing owner goes straight Home',()=>{
 const account={userId:'me',email:'a@example.test',data:{profile:{display_name:'A',gender:'female'},couple:{coupleId:'space',members:[{user_id:'me'}]},pets:[]},error:'',refresh:async()=>{},signOut:async()=>{}} as unknown as AccountState;
 const first=render(createElement(WorkspaceSession,{account}));assert.match(first,/<h1>Choose your pet<\/h1>/);assert.match(first,/Choose your pet/);assert.doesNotMatch(first,/class="shell-home-view"|class="production-turntable"/);
 const returning={...account,data:{...account.data!,pets:[{id:'pet',owner_id:'me',kind:'cat',breed:'Devon Rex',name:'团团',appearance:{}}]}} as AccountState;
 const home=render(createElement(WorkspaceSession,{account:returning}));assert.match(home,/<section aria-label="Home"/);assert.match(home,/aria-label="Home" aria-current="page"/);assert.match(home,/aria-label="Open your songs"/);assert.doesNotMatch(home,/Choose your pet|Song surprise/);
});
