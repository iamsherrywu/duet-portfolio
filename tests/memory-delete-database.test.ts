import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import type {PGlite} from '@electric-sql/pglite';
import {admin,asUser,database,paired,scalar,users} from './helpers/database';

let db:PGlite;
before(async()=>{db=await database();await paired(db,users.a,users.b);await paired(db,users.c,users.d);});
after(async()=>{await db?.close();});
async function media(owner:string,purpose:'memory'|'story') {
  await asUser(db,owner);
  const row=await scalar<{id:string}>(db,'select public.duet_register_media($1,\'image/png\') as value',[purpose]);
  await admin(db);await db.exec('set role service_role');await db.query('select public.duet_media_uploaded($1)',[row.id]);
  await asUser(db,owner);return row.id;
}
async function memory(owner=users.a,photos:string[]=[],kind='memory') {
  await asUser(db,owner);
  if(photos.length)return scalar<string>(db,"select public.duet_create_memory('A memory','','shared',current_date,$1::uuid[]) as value",[photos]);
  return scalar<string>(db,"insert into public.entries(couple_id,author_id,kind,title,visibility,event_date) values(private.current_couple(),auth.uid(),$1,'A moment','shared',current_date) returning id as value",[kind]);
}
async function savedStory(owner=users.a,entry:string|null=null) {
  const mediaId=await media(owner,'story');
  const snap=await scalar<{id:string;sent_at:string;expires_at:string}>(db,"select public.duet_create_location_snap($1,'A photo',false) as value",[mediaId]);
  await db.query('select public.duet_save_location_snap($1,$2)',[snap.id,entry]);
  return {...snap,mediaId};
}
async function calendar(user=users.a) {
  await asUser(db,user);
  return scalar<{entries:Array<{id:string}>;stories:Array<{id:string;linked_entry_id:string|null}>}>(db,'select public.duet_list_shared_calendar(current_date-2,current_date+2) as value');
}

test('deleting own memory atomically unarchives only own linked stories and revokes expired story/media access',async()=>{
  const photos=[await media(users.a,'memory'),await media(users.a,'memory')];
  const entry=await memory(users.a,photos);const otherEntry=await memory();
  const own=await savedStory(users.a,entry);
  const partner=await savedStory(users.b,entry);
  const standalone=await savedStory();
  const otherLink=await savedStory(users.a,otherEntry);
  const otherCouple=await savedStory(users.c,await memory(users.c));
  await admin(db);
  await db.query("update public.location_snaps set expires_at=now()-interval '1 second' where id=any($1::uuid[])",[[own.id,partner.id,standalone.id,otherLink.id,otherCouple.id]]);
  await asUser(db,users.b);
  assert.equal((await db.query('select id from public.media where id=any($1::uuid[])',[[...photos,own.mediaId]])).rows.length,3);
  await asUser(db,users.a);
  assert.equal((await db.query('delete from public.entries where id=$1 returning id',[entry])).rows.length,1);
  for(const viewer of [users.a,users.b]) {
    const view=await calendar(viewer);
    assert.equal(view.entries.some(row=>row.id===entry),false);
    assert.equal(view.stories.some(row=>row.id===own.id),false);
    assert.equal(view.stories.find(row=>row.id===partner.id)?.linked_entry_id,null);
    assert.ok(view.stories.some(row=>row.id===standalone.id));
    assert.equal(view.stories.find(row=>row.id===otherLink.id)?.linked_entry_id,otherEntry);
    assert.equal(view.stories.some(row=>row.id===otherCouple.id),false);
    await assert.rejects(db.query('select public.duet_get_location_snap($1)',[own.id]),/not_found/);
    assert.equal((await db.query('select id from public.media where id=$1',[own.mediaId])).rows.length,0);
  }
  await asUser(db,users.b);
  assert.equal((await db.query('select id from public.media where id=any($1::uuid[])',[photos])).rows.length,0);
  await asUser(db,users.a);
  assert.equal((await db.query('select id from public.media where id=any($1::uuid[])',[photos])).rows.length,2); // Uploaded originals still belong to their author.
  await admin(db);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.entry_media where entry_id=$1',[entry]),0);
  assert.equal(await scalar<number>(db,'select count(*)::int as value from public.media where id=$1',[own.mediaId]),1); // No hard media deletion.
  const row=await db.query('select saved_to_calendar_at,calendar_date,linked_entry_id from public.location_snaps where id=$1',[own.id]);
  assert.deepEqual(row.rows,[{saved_to_calendar_at:null,calendar_date:null,linked_entry_id:null}]);
  await db.exec('set role service_role');
  const claims=(await db.query<{media_id:string}>('select * from public.duet_claim_media_cleanup()')).rows.map(row=>row.media_id);
  assert.ok(claims.includes(own.mediaId));
  for(const retained of [partner,standalone,otherLink,otherCouple])assert.ok(!claims.includes(retained.mediaId));
});

test('live linked stories keep their original 24h Chat life; sibling and independent saves are not removed',async()=>{
  const entry=await memory();const other=await memory();
  const mediaIds=[await media(users.a,'story'),await media(users.a,'story')];
  const group=await scalar<{items:Array<{id:string}>}>(db,"select public.duet_create_location_story_group($1::uuid[],'Two photos',null,null,null,null) as value",[mediaIds]);
  const [first,second]=group.items;
  await db.query('select public.duet_save_location_snap($1,$2)',[first.id,entry]);
  await db.query('select public.duet_save_location_snap($1,$2)',[second.id,other]);
  await admin(db);
  const before=(await db.query('select sent_at,expires_at,story_group_id from public.location_snaps where id=$1',[first.id])).rows[0];
  await asUser(db,users.a);await db.query('delete from public.entries where id=$1',[entry]);
  const view=await calendar();assert.equal(view.stories.some(row=>row.id===first.id),false);assert.equal(view.stories.find(row=>row.id===second.id)?.linked_entry_id,other);
  await asUser(db,users.b);
  const active=await scalar<Array<{id:string}>>(db,"select public.duet_list_location_snaps('chat') as value");
  assert.ok(active.some(row=>row.id===first.id));assert.ok(active.some(row=>row.id===second.id));
  assert.equal((await db.query('select id from public.media where id=$1',[mediaIds[0]])).rows.length,1);
  await admin(db);
  assert.deepEqual((await db.query('select sent_at,expires_at,story_group_id from public.location_snaps where id=$1',[first.id])).rows[0],before);
});

test('partner and other couples cannot delete the entry or cause linked story changes',async()=>{
  const entry=await memory();const snap=await savedStory(users.a,entry);
  for(const user of [users.b,users.c]) {
    await asUser(db,user);
    assert.equal((await db.query('delete from public.entries where id=$1 returning id',[entry])).rows.length,0);
  }
  const view=await calendar();assert.ok(view.entries.some(row=>row.id===entry));assert.equal(view.stories.find(row=>row.id===snap.id)?.linked_entry_id,entry);
});

test('a rolled-back deletion restores entry and story archive together; non-memory behavior stays unchanged',async()=>{
  const entry=await memory();const snap=await savedStory(users.a,entry);
  await db.exec('begin');await db.query('delete from public.entries where id=$1',[entry]);await db.exec('rollback');
  const view=await calendar();assert.ok(view.entries.some(row=>row.id===entry));assert.equal(view.stories.find(row=>row.id===snap.id)?.linked_entry_id,entry);
  const anniversary=await memory(users.a,[],'anniversary');const linked=await savedStory(users.a,anniversary);
  await db.query('delete from public.entries where id=$1',[anniversary]);
  assert.equal((await calendar()).stories.find(row=>row.id===linked.id)?.linked_entry_id,null);
});

test('save validates and locks the shared entry before the snap, keeps idempotency, and cannot bind to a deleted entry',async()=>{
  const entry=await memory();const snap=await savedStory(users.a,entry);
  const before=await scalar(db,'select public.duet_save_location_snap($1,$2) as value',[snap.id,entry]);
  assert.deepEqual(await scalar(db,'select public.duet_save_location_snap($1,$2) as value',[snap.id,entry]),before);
  const privateEntry=await memory();await db.query("update public.entries set visibility='personal' where id=$1",[privateEntry]);
  await assert.rejects(db.query('select public.duet_save_location_snap($1,$2)',[snap.id,privateEntry]),/invalid_calendar_entry/);
  await db.query('delete from public.entries where id=$1',[entry]);
  await assert.rejects(db.query('select public.duet_save_location_snap($1,$2)',[snap.id,entry]),/invalid_calendar_entry/);
  await admin(db);
  const def=await scalar<string>(db,"select pg_get_functiondef('public.duet_save_location_snap(uuid,uuid)'::regprocedure) as value");
  assert.ok(def.indexOf('for key share')>=0&&def.indexOf('for key share')<def.indexOf('select * into s from public.location_snaps'));
  assert.equal(await scalar<boolean>(db,"select has_function_privilege('anon','public.duet_save_location_snap(uuid,uuid)','execute') as value"),false);
  assert.equal(await scalar<boolean>(db,"select has_function_privilege('authenticated','private.unsave_deleted_memory_stories()','execute') as value"),false);
});
