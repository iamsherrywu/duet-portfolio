import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAccountLifecycle} from '../src/lib/account-lifecycle';
import {createUploadDraft,prepareUploadFile} from '../src/lib/upload-draft';
import {visibleStoryImage} from '../src/lib/story-view';

test('account changes immediately clear data and ignore previous identity requests',async()=>{
  const published:Array<{userId:string|null|undefined;data:unknown}>=[];
  const pending=new Map<string,(value:string)=>void>();
  const lifecycle=createAccountLifecycle(id=>new Promise<string>(resolve=>pending.set(id,resolve)),value=>published.push(value));
  const first=lifecycle.identify('a');await Promise.resolve();const second=lifecycle.identify('b');await Promise.resolve();
  assert.deepEqual(published.at(-1),{userId:'b',data:null,error:''});
  pending.get('a')!('private-a');await first;assert.equal(published.at(-1)?.data,null);
  pending.get('b')!('private-b');await second;assert.equal(published.at(-1)?.data,'private-b');
  lifecycle.identify(null);assert.equal(published.at(-1)?.data,null);assert.equal(published.at(-1)?.userId,null);
  lifecycle.dispose();
});

test('failed publication reuses uploaded media instead of leaking duplicate uploads',async()=>{
  let calls=0;const draft=createUploadDraft(async()=>({id:`media-${++calls}`}));const file=new File(['x'],'photo.jpg',{type:'image/jpeg'});
  assert.equal((await draft.resolve(file,'story')).id,'media-1');
  assert.equal((await draft.resolve(file,'story')).id,'media-1');assert.equal(calls,1);
  draft.clear();await draft.resolve(file,'story');assert.equal(calls,2);
});

test('large photos are reduced below the hosted request limit before upload',async()=>{
  const file=new File([new Uint8Array(6*1024*1024)],'photo.jpg',{type:'image/jpeg'});
  let calls=0;const ready=await prepareUploadFile(file,async()=>{calls++;return new Blob([new Uint8Array(1024)],{type:'image/jpeg'});});
  assert.ok(ready.size<=3.5*1024*1024);assert.equal(calls,1);
  await assert.rejects(prepareUploadFile(file,async()=>file),/too large|Resize/);
});

test('a photo URL is displayable only for the exact currently selected snap',()=>{
  assert.equal(visibleStoryImage({snapId:'one',url:'private-one'},'two'),'');
  assert.equal(visibleStoryImage({snapId:'one',url:'private-one'},'one'),'private-one');
  assert.equal(visibleStoryImage(null,'one'),'');
});
