import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocationSnapCleanupPost,supabaseRepository, type LocationSnapCleanupRepository } from '../src/app/api/cron/location-snaps/route';
import type {SupabaseClient} from '@supabase/supabase-js';

function request(secret='cron-secret') {
  return new Request('https://duet.example/api/cron/location-snaps',{method:'POST',headers:{'x-cron-secret':secret}});
}

test('location snaps cleanup rejects missing configuration and invalid cron secrets', async () => {
  let listCalls=0;
  const repository:LocationSnapCleanupRepository={
    listExpired:async()=>{listCalls+=1;return[];},removeObjects:async()=>{},deleteExpired:async()=>0,
  };
  const unconfigured=await createLocationSnapCleanupPost({secret:undefined,repository})(request());
  const denied=await createLocationSnapCleanupPost({secret:'cron-secret',repository})(request('wrong-secret'));
  assert.equal(unconfigured.status,503);
  assert.equal(denied.status,401);
  assert.equal(listCalls,0);
});

test('location snaps cleanup removes private files before deleting expired database rows', async () => {
  const steps:string[]=[];
  const repository:LocationSnapCleanupRepository={
    listExpired:async()=>[{id:'snap-1',mediaId:'media-1',path:'couple/user/media-1'}],
    removeObjects:async(paths)=>{steps.push(`remove:${paths.join(',')}`);},
    deleteExpired:async(ids)=>{steps.push(`delete:${ids.join(',')}`);return ids.length;},
  };
  const response=await createLocationSnapCleanupPost({secret:'cron-secret',repository})(request());
  assert.equal(response.status,200);
  assert.deepEqual(steps,['remove:couple/user/media-1','delete:snap-1']);
  assert.deepEqual(await response.json(),{data:{deleted:1}});
});

test('location snaps cleanup keeps database metadata when storage deletion fails', async () => {
  let deleteCalls=0;
  const repository:LocationSnapCleanupRepository={
    listExpired:async()=>[{id:'snap-1',mediaId:'media-1',path:'couple/user/media-1'}],
    removeObjects:async()=>{throw new Error('storage unavailable');},
    deleteExpired:async()=>{deleteCalls+=1;return 1;},
  };
  const response=await createLocationSnapCleanupPost({secret:'cron-secret',repository})(request());
  assert.equal(response.status,503);
  assert.equal(deleteCalls,0);
});

test('location snaps cleanup treats an empty batch as an idempotent success', async () => {
  let removeCalls=0;
  let deleteCalls=0;
  const repository:LocationSnapCleanupRepository={
    listExpired:async()=>[],removeObjects:async()=>{removeCalls+=1;},deleteExpired:async()=>{deleteCalls+=1;return 0;},
  };
  const response=await createLocationSnapCleanupPost({secret:'cron-secret',repository})(request());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:{deleted:0}});
  assert.equal(removeCalls,0);
  assert.equal(deleteCalls,0);
});

test('production cleanup repository uses atomic database claims, not a stale row selection',async()=>{
  const calls:string[]=[];
  const repo=supabaseRepository(()=>({rpc:async(name:string)=>{calls.push(name);return {data:name==='duet_claim_media_cleanup'?[{media_id:'m',path:'c/u/m'}]:1,error:null};}} as unknown as SupabaseClient));
  assert.deepEqual(await repo.listExpired(),[{id:'m',mediaId:'m',path:'c/u/m'}]);
  assert.equal(await repo.deleteExpired(['m']),1);
  assert.deepEqual(calls,['duet_purge_expired_moods','duet_claim_media_cleanup','duet_finish_media_cleanup']);
});

test('Vercel cleanup GET accepts only its bearer header before touching storage',async()=>{
 let calls=0;
 const repository:LocationSnapCleanupRepository={listExpired:async()=>{calls++;return[]},removeObjects:async()=>{},deleteExpired:async()=>0};
 const handler=createLocationSnapCleanupPost({secret:'Bearer cron-secret',header:'authorization',repository});
 for(const headers of [{},{'x-cron-secret':'cron-secret'},{authorization:'Bearer wrong'}] as Record<string,string>[]){
  assert.equal((await handler(new Request('https://duet.example/api/cron/location-snaps',{headers}))).status,401);
 }
 assert.equal(calls,0);
 assert.equal((await handler(new Request('https://duet.example/api/cron/location-snaps',{headers:{authorization:'Bearer cron-secret'}}))).status,200);
 assert.equal(calls,1);
});
