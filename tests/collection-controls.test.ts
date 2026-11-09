import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement,act} from 'react';
import {createRoot} from 'react-dom/client';
import {CollectionRecord} from '../src/components/home-space';

test('cross asks to remove; Keep cancels; failure preserves the record and allows retry',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);let calls=0,fail=true;
 const song={id:'song',title:'Mantra',artist:'Jennie',album:'',media_id:null,created_by:'me'};
 const click=async(node:Element|null)=>{assert.ok(node);await act(async()=>{node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
 const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent===label)??null;
 try{
  await act(async()=>root.render(createElement(CollectionRecord,{song,onHide:async()=>{calls++;if(fail)throw Error('offline');}})));
  await click(document.querySelector('.collection-disc-button'));
  assert.ok(!document.querySelector('.collection-reaction-panel'),'tapping album must only reveal removal control');
  assert.equal(document.querySelector('textarea'),null);
  assert.equal(button('Send'),null);
  await click(button('×'));
  assert.ok(document.querySelector('[role="alertdialog"]'),'cross must open removal confirmation, not reactions');
  assert.equal(document.querySelector('.collection-reaction-panel'),null);
  assert.equal(calls,0);
  await click(button('Keep'));assert.equal(document.querySelector('[role="alertdialog"]'),null);assert.equal(calls,0);
  await click(button('×'));await click(button('Remove'));
  assert.equal(calls,1);assert.match(document.querySelector('[role="status"]')?.textContent??'',/Could not remove/);
  assert.ok(document.querySelector('.collection-vinyl'));
  fail=false;await click(button('Remove'));assert.equal(calls,2);
  assert.equal(document.querySelector('[role="status"]'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
