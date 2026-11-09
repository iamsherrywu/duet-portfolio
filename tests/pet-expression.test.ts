import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {petExpression} from '../src/lib/pet-expression';
import {AnimatedPet} from '../src/components/animated-pet';

test('approved front-facing dog changes expression with mood and sleeping closes its eyes',()=>{
 for(const pet of [{kind:'dog' as const,breed:'West Highland White Terrier'}]){
  const happy=petExpression(pet,'Happy · Idle')!,low=petExpression(pet,'Low · Wave')!,sleep=petExpression(pet,'Happy · Sleep')!,zen=petExpression(pet,'Zen · Idle')!;
  assert.ok(existsSync(`public${happy.src}`));assert.notEqual(happy.frame,low.frame);assert.equal(sleep.frame,zen.frame);
  assert.ok(happy.x+happy.width<=happy.atlasWidth);assert.ok(happy.y+happy.height<=happy.atlasHeight);assert.ok(happy.displayHeight<=82);assert.ok(happy.outline.length>100);
 }
 for(const breed of ['Abyssinian','Bengal','Siamese','Silver Shorthair'])assert.equal(petExpression({kind:'cat',breed},'Low · Idle'),null);
 assert.equal(petExpression({kind:'cat',breed:'Black Shorthair'},'Calm · Idle'),null);
 assert.equal(petExpression({kind:'dog',breed:'Golden Retriever'},'Happy · Idle'),null,'other selected breeds retain their own original artwork');
});
test('legacy Silver Shorthair uses Devon artwork without the blue expression atlas',()=>{
 const pet={id:'cat',kind:'cat' as const,owner_id:'me',name:'Momo',breed:'Silver Shorthair',appearance:{}};
 const html=renderToStaticMarkup(createElement(AnimatedPet,{pet,status:'Low · Idle',active:true}));
 assert.match(html,/inward\/cat-devon\.png/);assert.doesNotMatch(html,/cat-moods-front\.png/);assert.doesNotMatch(html,/data-expression=/);assert.match(html,/pet-motion-breathe/);assert.doesNotMatch(html,/pet-motion-head|pet-motion-body|<mask/);
});

test('new cat breeds animate with their own source art and no blue expression atlas',()=>{
 for(const [breed,file] of [['Abyssinian','cat-abyssinian.png'],['Bengal','cat-bengal.png'],['Siamese','cat-siamese.png']]){
  const pet={id:breed,kind:'cat' as const,owner_id:'me',name:'Momo',breed,appearance:{}};
  const html=renderToStaticMarkup(createElement(AnimatedPet,{pet,status:'Low · Idle',active:true}));
  assert.match(html,new RegExp(`${file.replace('.','\\.')}`));assert.doesNotMatch(html,/cat-moods-front\.png/);
 }
});

test('black cats retain their selected artwork across moods and actions',()=>{
 const pet={id:'black',kind:'cat' as const,owner_id:'other',name:'Night',breed:'Black Shorthair',appearance:{}};
 for(const status of ['Happy · Idle','Low · Wave','Zen · Sleep','Calm · Tail Wag']){
  const html=renderToStaticMarkup(createElement(AnimatedPet,{pet,status,active:true}));
  assert.match(html,/inward\/cat-black.png/);
  assert.doesNotMatch(html,/cat-moods-front.png/);
 }
});
