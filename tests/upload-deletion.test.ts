import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, users, asUser, paired, scalar } from './helpers/database';
import { runPrivateUpload } from '../src/lib/server/upload';

test('space deletion waits for an in-flight upload and cleans its object before dropping metadata',async()=>{
  const db=await database();
  const objects=new Map<string,Buffer>();
  try {
    const couple=await paired(db,users.a,users.b);
    await asUser(db,users.a);
    const media=await scalar<{id:string;path:string}>(db,"select public.duet_register_media('chat','image/png') as value");
    let release!:()=>void;
    const delayed=new Promise<void>(resolve=>{release=resolve;});
    const pendingUpload=runPrivateUpload({
      upload:async()=>{await delayed;objects.set(media.path,Buffer.from('image'));},
      markUploaded:async()=>{await db.exec('reset role; set role service_role');await db.query('select public.duet_media_uploaded($1)',[media.id]);},
    });
    const request=await scalar(db,'select public.duet_request_deletion() as value');
    await asUser(db,users.b);
    await db.query('select public.duet_respond_deletion($1,true)',[request]);
    await db.exec('reset role; set role service_role');
    await assert.rejects(db.query('select public.duet_prepare_cleanup($1,$2)',[request,users.b]),/uploads_pending/);
    assert.equal((await db.query('select * from public.media where id=$1',[media.id])).rows.length,1);
    release();await pendingUpload;
    assert.equal(await scalar(db,'select public.duet_prepare_cleanup($1,$2) as value',[request,users.b]),couple);
    for(const {path} of (await db.query<{path:string}>('select path from public.media where couple_id=$1',[couple])).rows)objects.delete(path);
    await db.query('select public.duet_finish_cleanup($1,$2)',[request,users.b]);
    assert.equal(objects.size,0);
    assert.equal((await db.query('select * from public.media where id=$1',[media.id])).rows.length,0);
    assert.equal((await db.query('select * from public.couples where id=$1',[couple])).rows.length,0);
  } finally {await db.close();}
});

test('failed or uncertain uploads retain pending cleanup metadata',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const media=await scalar<{id:string}>(db,"select public.duet_register_media('chat','image/png') as value");
    await db.exec('reset role; set role service_role');
    await assert.rejects(runPrivateUpload({
      upload:async()=>{throw new Error('network failed');},
      markUploaded:async()=>{await db.query('select public.duet_media_uploaded($1)',[media.id]);},
    }));
    assert.equal(await scalar(db,'select upload_state as value from public.media where id=$1',[media.id]),'pending');
  } finally {await db.close();}
});
