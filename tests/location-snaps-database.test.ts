import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin, asUser, database, paired, scalar, users } from './helpers/database';

async function readyStoryMedia(db: Awaited<ReturnType<typeof database>>, owner: string) {
  await asUser(db, owner);
  const media = await scalar<{ id: string }>(db, "select public.duet_register_media('story','image/png') as value");
  await admin(db);
  await db.exec('set role service_role');
  await db.query('select public.duet_media_uploaded($1)', [media.id]);
  await asUser(db, owner);
  return media.id;
}

async function createSnap(db: Awaited<ReturnType<typeof database>>, owner: string, withLocation = false, caption = '') {
  const mediaId = await readyStoryMedia(db, owner);
  const snap = await scalar<{ id: string; sent_at: string; expires_at: string; latitude: number | null; longitude: number | null; caption: string | null }>(
    db,
    'select public.duet_create_location_snap($1,$2,$3) as value',
    [mediaId, caption, withLocation],
  );
  return { ...snap, mediaId };
}

test('location snaps database: server derives author, couple, timestamps and optional current coordinates', async () => {
  const db = await database();
  try {
    const coupleId = await paired(db, users.a, users.b);
    await asUser(db, users.a);
    const chat = await createSnap(db, users.a, false, 'A small moment');
    assert.equal(chat.latitude, null);
    assert.equal(chat.longitude, null);
    assert.equal(chat.caption, 'A small moment');

    await db.query('select public.duet_start_location_share(31.2,121.5,18)');
    const map = await createSnap(db, users.a, true, 'At the river');
    assert.equal(map.latitude, 31.2);
    assert.equal(map.longitude, 121.5);

    await admin(db);
    const row = (await db.query<{ couple_id: string; author_id: string; media_id: string; sent_at: string; expires_at: string }>(
      'select couple_id,author_id,media_id,sent_at::text,expires_at::text from public.location_snaps where id=$1', [map.id],
    )).rows[0];
    assert.equal(row.couple_id, coupleId);
    assert.equal(row.author_id, users.a);
    assert.equal(row.media_id, map.mediaId);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.sent_at), 24 * 60 * 60 * 1000);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('location snaps database: grouped photos share one author, location, timestamp and expiry',async()=>{
  const db=await database();
  try {
    const coupleId=await paired(db,users.a,users.b);
    const mediaIds=[] as string[];
    for(let index=0;index<3;index++)mediaIds.push(await readyStoryMedia(db,users.a));
    await asUser(db,users.a);
    const result=await scalar<{group_id:string;items:Array<{id:string;group_position:number}>}>(db,
      'select public.duet_create_location_story_group($1::uuid[],$2,$3,$4,$5,$6) as value',
      [mediaIds,'A day together',31.2,121.5,18,30],
    );
    assert.equal(result.items.length,3);
    assert.deepEqual(result.items.map(item=>item.group_position),[1,2,3]);
    await admin(db);
    const rows=(await db.query<{id:string;couple_id:string;author_id:string;media_id:string;story_group_id:string;group_position:number;sent_at:string;expires_at:string;latitude:number;longitude:number}>(
      'select id,couple_id,author_id,media_id,story_group_id,group_position,sent_at::text,expires_at::text,latitude,longitude from public.location_snaps where story_group_id=$1 order by group_position',
      [result.group_id],
    )).rows;
    assert.equal(rows.length,3);
    assert.ok(rows.every(row=>row.couple_id===coupleId&&row.author_id===users.a&&row.story_group_id===result.group_id));
    assert.deepEqual(rows.map(row=>row.media_id),mediaIds);
    assert.deepEqual(rows.map(row=>row.group_position),[1,2,3]);
    assert.equal(new Set(rows.map(row=>row.sent_at)).size,1);
    assert.equal(new Set(rows.map(row=>row.expires_at)).size,1);
    assert.ok(rows.every(row=>row.latitude===31.2&&row.longitude===121.5));
    assert.equal(Date.parse(rows[0].expires_at)-Date.parse(rows[0].sent_at),24*60*60*1000);
    const share=(await db.query<{expires_at:string;latitude:number;longitude:number}>(
      'select expires_at::text,latitude,longitude from public.location_shares where couple_id=$1 and user_id=$2',[coupleId,users.a],
    )).rows[0];
    assert.ok(Math.abs(Date.parse(share.expires_at)-Date.now()-30*60*1000)<60_000);
    assert.deepEqual([share.latitude,share.longitude],[31.2,121.5]);

    await asUser(db,users.b);
    const visible=await scalar<Array<{id:string;group_id:string;group_position:number}>>(db,"select public.duet_list_location_snaps('chat') as value");
    assert.deepEqual(visible.filter(item=>rows.some(row=>row.id===item.id)).map(item=>[item.group_id,item.group_position]),[[result.group_id,1],[result.group_id,2],[result.group_id,3]]);
    await paired(db,users.c,users.d);
    await asUser(db,users.c);
    const isolated=await scalar<Array<{id:string}>>(db,"select public.duet_list_location_snaps('chat') as value");
    assert.equal(isolated.some(item=>rows.some(row=>row.id===item.id)),false);
  } finally {await admin(db);await db.close();}
});

test('location snaps database: missing GPS creates a chat-only group without refreshing current location',async()=>{
  const db=await database();
  try {
    const coupleId=await paired(db,users.a,users.b);
    await asUser(db,users.a);
    await db.query('select public.duet_start_location_share(31.2,121.5,18)');
    const before=(await db.query<{updated_at:string;expires_at:string}>(
      'select updated_at::text,expires_at::text from public.location_shares where couple_id=$1 and user_id=$2',[coupleId,users.a],
    )).rows[0];
    const mediaIds=[await readyStoryMedia(db,users.a),await readyStoryMedia(db,users.a)];
    const result=await scalar<{items:Array<{id:string}>}>(db,
      'select public.duet_create_location_story_group($1::uuid[],$2,null,null,null,null) as value',[mediaIds,'No location'],
    );
    await admin(db);
    const rows=(await db.query<{latitude:number|null;longitude:number|null;group_position:number}>(
      'select latitude,longitude,group_position from public.location_snaps where id=any($1::uuid[]) order by group_position',
      [result.items.map(item=>item.id)],
    )).rows;
    assert.equal(rows.length,2);
    assert.ok(rows.every(row=>row.latitude===null&&row.longitude===null));
    assert.deepEqual(rows.map(row=>row.group_position),[1,2]);
    const after=(await db.query<{updated_at:string;expires_at:string}>(
      'select updated_at::text,expires_at::text from public.location_shares where couple_id=$1 and user_id=$2',[coupleId,users.a],
    )).rows[0];
    assert.deepEqual(after,before);
  } finally {await admin(db);await db.close();}
});

test('location snaps database: stale or stopped position blocks only map attachment', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    await asUser(db, users.a);
    await db.query('select public.duet_start_location_share(31.2,121.5,18)');
    await admin(db);
    await db.query("update public.location_shares set updated_at=now()-interval '6 minutes' where user_id=$1", [users.a]);
    await asUser(db, users.a);
    const mediaId = await readyStoryMedia(db, users.a);
    await assert.rejects(db.query('select public.duet_create_location_snap($1,null,true)', [mediaId]), /location_not_fresh/);
    const chat = await scalar<{ latitude: number | null }>(db, 'select public.duet_create_location_snap($1,null,false) as value', [mediaId]);
    assert.equal(chat.latitude, null);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('location snaps database: reads and media are couple-scoped and viewer state is independent', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    const snap = await createSnap(db, users.a);
    await asUser(db, users.b);
    const firstView = await scalar<Array<{ id: string; is_viewed: boolean }>>(db, "select public.duet_list_location_snaps('chat') as value");
    assert.equal(firstView.find(item => item.id === snap.id)?.is_viewed, false);
    assert.equal((await db.query('select id from public.media where id=$1', [snap.mediaId])).rows.length, 1);
    await db.query('select public.duet_mark_location_snap_viewed($1)', [snap.id]);
    const viewed = await scalar<Array<{ id: string; is_viewed: boolean }>>(db, "select public.duet_list_location_snaps('chat') as value");
    assert.equal(viewed.find(item => item.id === snap.id)?.is_viewed, true);

    await paired(db, users.c, users.d);
    await asUser(db, users.c);
    assert.deepEqual(await scalar(db, "select public.duet_list_location_snaps('chat') as value"), []);
    await assert.rejects(db.query('select public.duet_get_location_snap($1)', [snap.id]), /not_found/);
    assert.equal((await db.query('select id from public.media where id=$1', [snap.mediaId])).rows.length, 0);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('location snaps database: author-only save is idempotent and archived media survives expiry', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    const saved = await createSnap(db, users.a, false, 'Keep this one');
    const temporary = await createSnap(db, users.a, false, 'Only for today');
    const coupleId=await scalar<string>(db,'select couple_id as value from public.couple_members where user_id=$1',[users.a]);
    const personalEntry=await scalar<string>(db,"insert into public.entries(couple_id,author_id,kind,title,visibility,event_date) values($1,$2,'anniversary','Private date','personal',current_date) returning id as value",[coupleId,users.a]);
    const sharedEntry=await scalar<string>(db,"insert into public.entries(couple_id,author_id,kind,title,visibility,event_date) values($1,$2,'anniversary','Shared date','shared',current_date) returning id as value",[coupleId,users.a]);
    await asUser(db, users.b);
    await assert.rejects(db.query('select public.duet_save_location_snap($1,null)', [saved.id]), /not_story_author/);

    await asUser(db, users.a);
    await assert.rejects(db.query('select public.duet_save_location_snap($1,$2)',[saved.id,personalEntry]),/invalid_calendar_entry/);
    const archive = await scalar<{calendar_date:string;linked_entry_id:string}>(db, 'select public.duet_save_location_snap($1,$2) as value', [saved.id,sharedEntry]);
    const repeated = await scalar<{calendar_date:string;linked_entry_id:string}>(db, 'select public.duet_save_location_snap($1,$2) as value', [saved.id,sharedEntry]);
    assert.deepEqual(repeated, archive);
    assert.equal(archive.linked_entry_id,sharedEntry);
    await admin(db);
    await db.query("update public.location_snaps set expires_at=now()-interval '1 second' where id=any($1::uuid[])", [[saved.id, temporary.id]]);

    await asUser(db, users.b);
    const chat = await scalar<Array<{id:string}>>(db, "select public.duet_list_location_snaps('chat') as value");
    assert.equal(chat.some(item => item.id === saved.id || item.id === temporary.id), false);
    assert.equal((await db.query('select id from public.media where id=$1', [saved.mediaId])).rows.length, 1);
    assert.equal((await db.query('select id from public.media where id=$1', [temporary.mediaId])).rows.length, 0);
    await asUser(db, users.a);
    assert.equal((await db.query('select id from public.media where id=$1', [temporary.mediaId])).rows.length, 0);
    await asUser(db, users.b);
    const archived = await scalar<{id:string;saved_to_calendar_at:string}>(db, 'select public.duet_get_location_snap($1) as value', [saved.id]);
    assert.equal(archived.id, saved.id);
    await assert.rejects(db.query('select public.duet_get_location_snap($1)', [temporary.id]), /not_found/);
    await assert.rejects(db.query('select public.duet_save_location_snap($1,null)', [temporary.id]), /not_found/);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('location snaps database: cleanup RPC deletes only expired unsaved media and is service-role only', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    const saved = await createSnap(db, users.a);
    const expired = await createSnap(db, users.a);
    await asUser(db, users.a);
    await db.query('select public.duet_save_location_snap($1,null)', [saved.id]);
    await admin(db);
    await db.query("update public.location_snaps set expires_at=now()-interval '1 second' where id=any($1::uuid[])", [[saved.id, expired.id]]);
    await asUser(db, users.a);
    await assert.rejects(db.query('select public.duet_delete_expired_location_snaps($1::uuid[])', [[saved.id, expired.id]]), /permission denied/i);
    await db.exec('reset role; set role service_role');
    const deleted = await scalar<number>(db, 'select public.duet_delete_expired_location_snaps($1::uuid[]) as value', [[saved.id, expired.id]]);
    assert.equal(deleted, 1);
    await admin(db);
    assert.equal((await db.query('select id from public.location_snaps where id=$1', [saved.id])).rows.length, 1);
    assert.equal((await db.query('select id from public.location_snaps where id=$1', [expired.id])).rows.length, 0);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('location snaps database: chat message can quote only an active story in the same couple', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    const snap = await createSnap(db, users.a);
    await asUser(db, users.b);
    const message = await scalar<string>(db, "select public.duet_send_message('text','Nice photo',jsonb_build_object('story_id',$1::uuid)) as value", [snap.id]);
    const stored = (await db.query<{metadata:Record<string,unknown>}>('select metadata from public.messages where id=$1', [message])).rows[0];
    assert.deepEqual(stored.metadata, {story_id:snap.id});
    await paired(db, users.c, users.d);
    await asUser(db, users.c);
    await assert.rejects(db.query("select public.duet_send_message('text','No access',jsonb_build_object('story_id',$1::uuid))", [snap.id]), /not_found/);
  } finally {
    await admin(db);
    await db.close();
  }
});
