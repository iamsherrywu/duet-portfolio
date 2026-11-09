import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {petPose,PET_POSES} from '../src/lib/pet-motion';
import {AnimatedPet} from '../src/components/animated-pet';
import {PET_ART} from '../src/lib/pets';
test('every appearance has one complete pose and a valid breed-matched source',()=>{
 assert.deepEqual(Object.keys(PET_POSES).sort(),PET_ART.map(art=>art.id).sort());
 for(const art of PET_ART){
  const config=PET_POSES[art.id],pose=petPose(art);
  assert.ok(config,`${art.id} has a pose`);
  assert.ok(['original','inward'].includes(config.source),`${art.id} has a source setting`);
  assert.equal(typeof config.mirror,'boolean',`${art.id} has a mirror setting`);
  assert.ok(Number.isFinite(config.neck),`${art.id} has a neck setting`);
  for(const part of ['paw','tail'] as const){assert.equal(config[part].length,4);assert.ok(config[part].every(Number.isFinite));}
  assert.equal(pose.facing,art.kind==='cat'?'right':'left');assert.ok(existsSync(`public${pose.src}`));assert.equal(pose.mirror,config.mirror);
  assert.equal(pose.src,config.source==='original'?art.src:art.src.replace('/duet/pets/','/duet/pets/inward/'));
 }
 for(const id of ['cat-abyssinian','cat-bengal','cat-siamese'] as const){assert.equal(PET_POSES[id].source,'original');assert.equal(PET_POSES[id].mirror,false);}
 assert.equal(PET_POSES['cat-maine'].source,'original');assert.equal(PET_POSES['cat-maine'].mirror,true);
 for(const art of PET_ART.filter(art=>art.kind==='dog')){assert.equal(PET_POSES[art.id].source,'inward');assert.equal(PET_POSES[art.id].mirror,false);}
 assert.match(petPose({kind:'dog',breed:'Golden Retriever'}).src,/dog-golden/);
 assert.equal(petPose({kind:'cat',breed:'Devon Rex'}).mirror,false);
});
test('pet motion keeps artwork intact, scopes silhouette clips and supports pausing off Home',()=>{
 const pet={id:'cat',kind:'cat' as const,owner_id:'me',name:'团团',breed:'Devon Rex',appearance:{}};
 const first=render(createElement(AnimatedPet,{pet,active:true,status:'Zen · Tail Wag'}));
 assert.match(first,/data-action="Tail Wag"/);assert.match(first,/pet-motion-breathe/);assert.doesNotMatch(first,/pet-motion-head|pet-motion-body|<mask/);assert.match(first,/Greet 团团/);
 const paused=render(createElement(AnimatedPet,{pet,active:false,status:'Unknown custom mood'}));assert.match(paused,/data-active="false"/);assert.match(paused,/data-action="Idle"/);
 const pair=render(createElement('div',null,createElement(AnimatedPet,{pet,active:true,status:''}),createElement(AnimatedPet,{pet:{...pet,id:'dog',kind:'dog'},active:true,status:''})));
 const ids=[...pair.matchAll(/<clipPath id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
});
test('head joints sit below the Westie beard and use the greyhound slender neck',()=>{
 assert.equal(petPose({kind:'dog',breed:'West Highland White Terrier'}).neck,48);
 assert.equal(petPose({kind:'dog',breed:'Greyhound'}).neck,32);
});
