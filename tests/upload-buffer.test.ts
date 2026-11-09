import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageUploadBody} from '../src/lib/server/upload';
test('native shared-backed image slices become independent fetch-compatible ArrayBuffers',async()=>{
 const shared=new SharedArrayBuffer(8);const source=new Uint8Array(shared,2,3);source.set([10,20,30]);
 const body=storageUploadBody(source);assert.ok(body instanceof ArrayBuffer);assert.deepEqual([...new Uint8Array(body)],[10,20,30]);
 source.fill(0);assert.deepEqual([...new Uint8Array(await new Response(body).arrayBuffer())],[10,20,30]);
});
