import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecognitionCache} from '../src/lib/recognition-cache';
test('cache coalesces in-flight requests, isolates users, expires and evicts; failures retry',async()=>{
 let now=0,calls=0;const cache=createRecognitionCache<number>(2,100,()=>now);
 const load=async()=>{calls++;return calls;};
 assert.deepEqual(await Promise.all([cache('a:img',load),cache('a:img',load)]),[1,1]);
 assert.equal(await cache('b:img',load),2);assert.equal(await cache('a:img',load),1);
 now=101;assert.equal(await cache('a:img',load),3);
 await cache('c:img',load);await cache('d:img',load);assert.equal(await cache('a:img',load),6);
 await assert.rejects(cache('bad',async()=>{throw Error('fail');}));assert.equal(await cache('bad',load),7);
});
