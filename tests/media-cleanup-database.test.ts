import assert from 'node:assert/strict';
import {test} from 'node:test';
import {database,admin,asUser,paired,scalar,users} from './helpers/database';

test('cleanup atomically claims expired stories and orphan avatars, blocks rebinding and retains saved photos',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const make=async(purpose:string)=>{
      const m=await scalar<{id:string}>(db,'select public.duet_register_media($1,$2) as value',[purpose,'image/png']);
      await admin(db);await db.exec('set role service_role');await db.query('select public.duet_media_uploaded($1)',[m.id]);await asUser(db,users.a);return m.id;
    };
    const expired=await make('story');const saved=await make('story');const orphan=await make('story');const avatar=await make('location_avatar');const oldAvatar=await make('location_avatar');
    await db.query('select public.duet_set_location_avatar($1)',[oldAvatar]);await db.query('select public.duet_set_location_avatar($1)',[avatar]);
    const snap=await scalar<{id:string}>(db,"select public.duet_create_location_snap($1,'expired',false) as value",[expired]);
    const keep=await scalar<{id:string}>(db,"select public.duet_create_location_snap($1,'saved',false) as value",[saved]);
    await db.query('select public.duet_save_location_snap($1)',[keep.id]);
    await admin(db);
    await db.exec("update public.location_snaps set expires_at=clock_timestamp()-interval '1 second'; update public.media set detached_at=clock_timestamp()-interval '2 days'");
    await db.exec('set role service_role');
    const claimed=(await db.query<{media_id:string}>('select * from public.duet_claim_media_cleanup()')).rows.map(row=>row.media_id).sort();
    assert.deepEqual(claimed,[expired,orphan,oldAvatar].sort());
    assert.equal((await db.query('select * from public.duet_claim_media_cleanup()')).rows.length,0);
    await admin(db);await db.exec("update public.media set cleanup_claimed_at=clock_timestamp()-interval '6 minutes' where cleanup_claimed_at is not null");
    await db.exec('set role service_role');assert.equal((await db.query('select * from public.duet_claim_media_cleanup()')).rows.length,3);
    // Simulate an old save invocation with an early captured timestamp: a claim still wins.
    await admin(db);await db.query("update public.location_snaps set expires_at=clock_timestamp()+interval '1 hour' where id=$1",[snap.id]);
    await asUser(db,users.a);await assert.rejects(db.query('select public.duet_save_location_snap($1)',[snap.id]),/not_found|media_cleanup/);
    await assert.rejects(db.query('select public.duet_create_location_snap($1,null,false)',[orphan]),/not_found|media_cleanup/);
    await assert.rejects(db.query('select public.duet_set_location_avatar($1)',[oldAvatar]),/not_found|media_cleanup/);
    await admin(db);await db.exec('set role service_role');
    assert.equal(await scalar<number>(db,'select public.duet_finish_media_cleanup($1::uuid[]) as value',[claimed]),3);
    assert.equal(await scalar<number>(db,'select public.duet_finish_media_cleanup($1::uuid[]) as value',[claimed]),0);
    assert.equal((await db.query('select id from public.media where id=any($1::uuid[])',[[saved,avatar]])).rows.length,2);
    await asUser(db,users.a);await assert.rejects(db.query('select * from public.duet_claim_media_cleanup()'),/permission denied/);
  }finally{await admin(db);await db.close();}
});
