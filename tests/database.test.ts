import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { database, users, asUser, admin, paired, scalar } from './helpers/database';

let db: PGlite;
let first: string;
let second: string;
before(async () => {
  db = await database();
  first = await paired(db, users.a, users.b);
  second = await paired(db, users.c, users.d);
});
after(async () => { await db?.close(); });

test('invitations expire at 24h and cannot be reused by a different person', async () => {
  const isolated = await database();
  try {
    await asUser(isolated, users.a);
    await isolated.query('select public.duet_create_couple()');
    const expired = await scalar(isolated, 'select public.duet_create_invitation() as value');
    await admin(isolated);
    const lifetime = await scalar<number>(isolated, 'select extract(epoch from expires_at-created_at)::int as value from public.invitations');
    assert.equal(lifetime, 86400);
    await isolated.exec("update public.invitations set expires_at=now()-interval '1 second'");
    await asUser(isolated, users.b);
    await assert.rejects(isolated.query('select public.duet_accept_invitation($1)', [expired]), /invalid_invitation/);
    await asUser(isolated, users.a);
    const valid = await scalar(isolated, 'select public.duet_create_invitation() as value');
    await asUser(isolated, users.b);
    await isolated.query('select public.duet_accept_invitation($1)', [valid]);
    await asUser(isolated, users.outsider);
    await assert.rejects(isolated.query('select public.duet_accept_invitation($1)', [valid]), /invalid_invitation/);
  } finally { await isolated.close(); }
});

test('invite registration eligibility requires a live invitation and is service-role only', async () => {
  const isolated=await database();
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const allowed=(tokenHash:string|null)=>scalar<boolean>(isolated,'select public.duet_invite_registration_allowed($1) as value',[tokenHash]);
  try {
    await asUser(isolated,users.a);
    const couple=await scalar<string>(isolated,'select public.duet_create_couple() as value');
    const expiredToken=await scalar<string>(isolated,'select public.duet_create_invitation() as value');
    const expiredHash=hash(expiredToken);
    await admin(isolated);
    await isolated.query("update public.invitations set expires_at=now()-interval '1 second' where token_hash=$1",[expiredHash]);
    await isolated.exec('set role service_role');
    assert.equal(await allowed(expiredHash),false);
    assert.equal(await allowed(null),false); // Creator allowlisting alone is not registration permission.
    assert.equal(await allowed(hash('unknown invitation')),false);
    await isolated.exec('reset role');

    await asUser(isolated,users.a);
    const usedToken=await scalar<string>(isolated,'select public.duet_create_invitation() as value');
    const usedHash=hash(usedToken);
    await admin(isolated);
    await isolated.query('update public.invitations set used_at=now() where token_hash=$1',[usedHash]);
    await asUser(isolated,users.a);
    const validToken=await scalar<string>(isolated,'select public.duet_create_invitation() as value');
    const validHash=hash(validToken);
    await admin(isolated);
    await isolated.exec('set role service_role');
    assert.equal(await allowed(usedHash),false);
    assert.equal(await allowed(validHash),true);
    await isolated.exec('reset role');

    await asUser(isolated,users.b);
    await isolated.query('select public.duet_accept_invitation($1)',[validToken]);
    await admin(isolated);
    const fullToken='full-couple-registration-token';
    const fullHash=hash(fullToken);
    await isolated.query('insert into public.invitations(couple_id,token_hash,created_by) values($1,$2,$3)',[couple,fullHash,users.a]);
    await isolated.exec('set role service_role');
    assert.equal(await allowed(fullHash),false);
    await isolated.exec('reset role');

    await isolated.query("update public.couples set status='deletion_approved' where id=$1",[couple]);
    const inactiveHash=hash('inactive-couple-registration-token');
    await isolated.query('insert into public.invitations(couple_id,token_hash,created_by) values($1,$2,$3)',[couple,inactiveHash,users.a]);
    await isolated.exec('set role service_role');
    assert.equal(await allowed(inactiveHash),false);
    await isolated.exec('reset role');

    await asUser(isolated,users.outsider);
    await assert.rejects(allowed(validHash),/permission denied/);
  } finally { await isolated.close(); }
});

test('concurrent acceptance attempts can consume an invitation only once', async () => {
  const isolated=await database();
  try {
    await asUser(isolated,users.a);
    await isolated.query('select public.duet_create_couple()');
    const token=await scalar<string>(isolated,'select public.duet_create_invitation() as value');
    await asUser(isolated,users.b);
    const results=await Promise.allSettled([
      isolated.query('select public.duet_accept_invitation($1)',[token]),
      isolated.query('select public.duet_accept_invitation($1)',[token]),
    ]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(await scalar<number>(isolated,'select count(*)::int as value from public.couple_members'),2);
  } finally { await isolated.close(); }
});

test('a used invitation cannot add an outsider or a third member', async () => {
  await asUser(db, users.outsider);
  await assert.rejects(db.query('select public.duet_create_couple()'), /not_allowed/);
  await asUser(db, users.a);
  await assert.rejects(db.query('select public.duet_create_invitation()'), /space_full/);
  await asUser(db, users.b);
  await assert.rejects(db.query('select public.duet_create_couple()'), /already_paired/);
});

test('couple members and messages are isolated across the two spaces', async () => {
  await asUser(db, users.a);
  const id = await scalar(db, "select public.duet_send_message('text','hello', '{}') as value");
  assert.equal((await db.query('select id from public.couples')).rows.length, 1);
  await asUser(db, users.c);
  assert.equal((await db.query('select * from public.messages where id=$1', [id])).rows.length, 0);
  await assert.rejects(db.query('select public.duet_hide_message($1)', [id]), /not_found/);
  await assert.rejects(db.query("insert into public.messages(couple_id,sender_id,kind,body) values($1,$2,'text','forge')", [first, users.c]), /permission denied/);
});

test('messages cannot be deleted and hiding only affects the current user', async () => {
  await asUser(db, users.a);
  const id = await scalar(db, "select public.duet_send_message('text','keep me', '{}') as value");
  await db.query('select public.duet_hide_message($1)', [id]);
  const visibleToA=await scalar<{id:string}[]>(db,'select public.duet_list_messages() as value');
  assert.ok(!visibleToA.some(m=>m.id===id));
  assert.equal((await db.query('select * from public.message_hides where message_id=$1', [id])).rows.length, 1);
  await assert.rejects(db.query('delete from public.messages where id=$1', [id]), /permission denied/);
  await asUser(db, users.b);
  const visibleToB=await scalar<{id:string}[]>(db,'select public.duet_list_messages() as value');
  assert.ok(visibleToB.some(m=>m.id===id));
  assert.equal((await db.query('select * from public.message_hides where message_id=$1', [id])).rows.length, 0);
  assert.equal((await db.query('select * from public.messages where id=$1', [id])).rows.length, 1);
});

test('a partner cannot publish a private image by guessing its ID in a shared memory or feed', async () => {
  const isolated=await database();
  try {
    const couple=await paired(isolated,users.a,users.b);
    await asUser(isolated,users.a);
    const privatePhoto=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    const privateFeed=await scalar<{id:string}>(isolated,"select public.duet_register_media('feed','image/png') as value");
    await asUser(isolated,users.b);
    await assert.rejects(isolated.query("insert into public.entries(couple_id,author_id,kind,title,media_id) values($1,$2,'memory','forge',$3)",[couple,users.b,privatePhoto.id]),/row-level security/);
    const dog=await scalar(isolated,"select public.duet_claim_pet('dog','柴犬','圆圆') as value");
    await assert.rejects(isolated.query("select public.duet_feed_pet($1,'image',$2,'今天如何','开心')",[dog,privateFeed.id]),/not_found/);
  } finally {await isolated.close();}
});

test('a multiple-song box uses fallback questions and permits drawing every song', async () => {
  await asUser(db,users.a);
  const songs=[];
  for(const title of ['Morning','Evening'])songs.push(await scalar(db,"select public.duet_create_song($1,'Artist','','',null) as value",[title]));
  const box=await scalar(db,'select public.duet_send_blind_box($1,$2) as value',[JSON.stringify(songs.map(song_id=>({song_id}))),'两首']);
  await asUser(db,users.b);
  const seen=new Set<string>();
  for(let i=0;i<2;i++) {
    const draw=await scalar<{draw_id:string;question:string}>(db,'select public.duet_prepare_draw($1) as value',[box]);
    assert.ok(draw.question.length>0);
    const song=await scalar<{id:string}>(db,'select public.duet_complete_draw($1,$2) as value',[draw.draw_id,'开心']);
    seen.add(song.id);
  }
  assert.equal(seen.size,2);
  await assert.rejects(db.query('select public.duet_prepare_draw($1)',[box]),/box_empty/);
});

test('a personal memory image is not readable by the partner until explicitly shared', async () => {
  await asUser(db, users.a);
  const media = await scalar<{id:string;path:string}>(db, "select public.duet_register_media('memory','image/png') as value");
  const {rows} = await db.query<{id:string}>("insert into public.entries(couple_id,author_id,kind,title,visibility,media_id) values($1,$2,'memory','private','personal',$3) returning id", [first, users.a, media.id]);
  await asUser(db, users.b);
  assert.equal((await db.query('select * from public.media where id=$1',[media.id])).rows.length,0);
  await asUser(db, users.a);
  await db.query("update public.entries set visibility='shared' where id=$1",[rows[0].id]);
  await asUser(db, users.b);
  assert.equal((await db.query('select * from public.media where id=$1',[media.id])).rows.length,1);
});

test('a shared memory can group multiple photos in the selected order', async () => {
  const isolated=await database();
  try {
    await paired(isolated,users.a,users.b);
    await asUser(isolated,users.a);
    const firstPhoto=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    const secondPhoto=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/jpeg') as value");
    const memory=await scalar<string>(isolated,
      "select public.duet_create_memory('Weekend walk','By the river','shared',null,$1::uuid[]) as value",
      [[firstPhoto.id,secondPhoto.id]],
    );

    await asUser(isolated,users.b);
    const links=await isolated.query<{media_id:string;position:number}>(
      'select media_id,position from public.entry_media where entry_id=$1 order by position',[memory],
    );
    assert.deepEqual(links.rows,[
      {media_id:firstPhoto.id,position:0},
      {media_id:secondPhoto.id,position:1},
    ]);
    assert.equal((await isolated.query('select id from public.entries where id=$1',[memory])).rows.length,1);
    assert.equal((await isolated.query('select id from public.media where id in ($1,$2)',[firstPhoto.id,secondPhoto.id])).rows.length,2);
  } finally { await isolated.close(); }
});

test('photos attached to a personal multi-photo memory stay private until the memory is shared', async () => {
  const isolated=await database();
  try {
    const couple=await paired(isolated,users.a,users.b);
    await asUser(isolated,users.a);
    const firstPhoto=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    const secondPhoto=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    const memory=await scalar<string>(isolated,
      "select public.duet_create_memory('Private day','','personal',null,$1::uuid[]) as value",
      [[firstPhoto.id,secondPhoto.id]],
    );

    await asUser(isolated,users.b);
    assert.equal((await isolated.query('select id from public.entries where id=$1',[memory])).rows.length,0);
    assert.equal((await isolated.query('select media_id from public.entry_media where entry_id=$1',[memory])).rows.length,0);
    assert.equal((await isolated.query('select id from public.media where id in ($1,$2)',[firstPhoto.id,secondPhoto.id])).rows.length,0);

    await asUser(isolated,users.a);
    await isolated.query("update public.entries set visibility='shared' where id=$1 and couple_id=$2",[memory,couple]);
    await asUser(isolated,users.b);
    assert.equal((await isolated.query('select media_id from public.entry_media where entry_id=$1',[memory])).rows.length,2);
    assert.equal((await isolated.query('select id from public.media where id in ($1,$2)',[firstPhoto.id,secondPhoto.id])).rows.length,2);
  } finally { await isolated.close(); }
});

test('a user cannot attach a partner-owned photo to a new memory', async () => {
  const isolated=await database();
  try {
    await paired(isolated,users.a,users.b);
    await asUser(isolated,users.a);
    const photo=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    await asUser(isolated,users.b);
    await assert.rejects(isolated.query(
      "select public.duet_create_memory('Shared?','','shared',null,$1::uuid[])",[[photo.id]],
    ),/not_found/);
    assert.equal((await isolated.query("select id from public.entries where title='Shared?'")).rows.length,0);
  } finally { await isolated.close(); }
});

test('a legacy memory photo cannot be reused in another entry with broader visibility', async () => {
  const isolated=await database();
  try {
    const couple=await paired(isolated,users.a,users.b);
    await asUser(isolated,users.a);
    const photo=await scalar<{id:string}>(isolated,"select public.duet_register_media('memory','image/png') as value");
    await isolated.query(
      "insert into public.entries(couple_id,author_id,kind,title,visibility,media_id) values($1,$2,'memory','Private copy','personal',$3)",
      [couple,users.a,photo.id],
    );

    await assert.rejects(isolated.query(
      "insert into public.entries(couple_id,author_id,kind,title,visibility,media_id) values($1,$2,'memory','Shared copy','shared',$3)",
      [couple,users.a,photo.id],
    ),/media_in_use/);
  } finally { await isolated.close(); }
});

test('afterwork sends only the paper and duplicate submissions create one message', async () => {
  await asUser(db,users.a);
  const nonce='20000000-0000-4000-8000-000000000001';
  await db.query("select public.duet_save_afterwork($1,$2,$3)",[nonce,JSON.stringify({energy:'有点累'}),'今天想安静陪伴']);
  await db.query("select public.duet_save_afterwork($1,$2,$3)",[nonce,JSON.stringify({energy:'有点累'}),'今天想安静陪伴']);
  await asUser(db,users.b);
  assert.equal((await db.query('select * from public.afterwork_checkins')).rows.length,0);
  const {rows}=await db.query<{body:string;metadata:unknown}>("select * from public.messages where kind='afterwork'");
  assert.equal(rows.length,1);
  assert.equal(rows[0].body,'今天想安静陪伴');
  assert.ok(!JSON.stringify(rows[0].metadata).includes('有点累'));
});

test('one cat and one dog are adopted, feeding is once daily and answers become messages', async () => {
  await asUser(db, users.a);
  const cat = await scalar(db, "select public.duet_claim_pet('cat','布偶','团团') as value");
  await assert.rejects(db.query("select public.duet_claim_pet('dog','柴犬','圆圆')"), /already_adopted/);
  await db.query("select public.duet_feed_pet($1,'text','早安','今天想吃什么','面包')", [cat]);
  await assert.rejects(db.query("select public.duet_feed_pet($1,'text','早安','今天想吃什么','面包')", [cat]), /already_fed/);
  await asUser(db, users.b);
  const dog = await scalar(db, "select public.duet_claim_pet('dog','柴犬','圆圆') as value");
  await db.query("select public.duet_feed_pet($1,'emoji','☀️','今天想做什么','散步')", [dog]);
  assert.equal((await db.query("select * from public.messages where kind='morning' and couple_id=$1", [first])).rows.length, 1);
  assert.equal((await db.query("select * from public.prompt_answers where source_type='feed' and couple_id=$1", [first])).rows.length, 2);
});

test('unopened songs are hidden; a custom question must be answered once per draw', async () => {
  await asUser(db, users.a);
  const card = await scalar(db, "select public.duet_create_song('SONG','ARTIST','ALBUM','',null) as value");
  const box = await scalar(db, 'select public.duet_send_blind_box($1::jsonb, $2) as value', [JSON.stringify([{ song_id: card, question: '最想和我去哪？' }]), '给你']);
  await asUser(db, users.b);
  assert.equal((await db.query('select * from public.song_cards where id=$1', [card])).rows.length, 0);
  const draw = await scalar<{ draw_id: string; question: string }>(db, 'select public.duet_prepare_draw($1) as value', [box]);
  assert.equal(draw.question, '最想和我去哪？');
  assert.ok(!('song_id' in draw));
  await assert.rejects(db.query("select public.duet_complete_draw($1,'')", [draw.draw_id]), /answer_required/);
  await db.query("select public.duet_complete_draw($1,'海边')", [draw.draw_id]);
  await db.query("select public.duet_complete_draw($1,'海边')", [draw.draw_id]);
  assert.equal((await db.query('select * from public.song_cards where id=$1', [card])).rows.length, 1);
  assert.equal((await db.query("select * from public.prompt_answers where source_type='draw' and source_id=$1", [draw.draw_id])).rows.length, 0);
  await asUser(db,users.a);
  assert.equal((await db.query("select * from public.prompt_answers where source_type='draw' and source_id=$1", [draw.draw_id])).rows.length, 1);
  await asUser(db,users.b);
  await assert.rejects(db.query('select public.duet_prepare_draw($1)', [box]), /box_empty/);
});

test('deletion requires partner confirmation; rejection leaves the space accessible', async () => {
  await asUser(db, users.a);
  const request = await scalar(db, 'select public.duet_request_deletion() as value');
  await assert.rejects(db.query('select public.duet_respond_deletion($1,true)', [request]), /partner_required/);
  await asUser(db, users.b);
  await db.query('select public.duet_respond_deletion($1,false)', [request]);
  assert.equal(await scalar(db, 'select status as value from public.couples where id=$1', [first]), 'active');
  await asUser(db, users.a);
  const again = await scalar(db, 'select public.duet_request_deletion() as value');
  await asUser(db, users.b);
  await db.query('select public.duet_respond_deletion($1,true)', [again]);
  assert.equal((await db.query('select * from public.couples where id=$1', [first])).rows.length, 0);
  await assert.rejects(db.query("select public.duet_send_message('text','blocked','{}')"), /space_inactive/);
  await admin(db);
  assert.equal(await scalar(db, 'select status as value from public.couples where id=$1', [first]), 'deletion_approved');
  assert.equal(await scalar(db, 'select status as value from public.couples where id=$1', [second]), 'active');
  await db.query('delete from public.couples where id=$1',[first]);
  assert.equal((await db.query('select * from public.messages where couple_id=$1',[first])).rows.length,0);
});
