import test from 'node:test';
import assert from 'node:assert/strict';
import {database,paired,asUser,scalar,users,admin} from './helpers/database';

test('blind-box answers are sender-only inbox items, not shared chat; retries stay idempotent',async()=>{
  const db=await database();try {
    const couple=await paired(db,users.a,users.b);await paired(db,users.c,users.d);
    await admin(db);await db.query("insert into messages(couple_id,sender_id,kind,body,metadata) values($1,$2,'question','legacy answer','{\"source\":\"draw\"}')",[couple,users.b]);
    await asUser(db,users.a);
    const song=await scalar(db,"select duet_create_song('Song','Artist','','',null) as value");
    const box=await scalar(db,'select duet_send_blind_box($1::jsonb,\'\') as value',[JSON.stringify([{song_id:song,question:'How are you?'}])]);
    await asUser(db,users.b);
    const draw=await scalar<{draw_id:string}>(db,'select duet_prepare_draw($1) as value',[box]);
    await assert.rejects(()=>db.query('select duet_complete_draw($1,\' \')',[draw!.draw_id]),/answer_required/);
    await db.query('select duet_complete_draw($1,\'fine\')',[draw!.draw_id]);
    await db.query('select duet_complete_draw($1,\'fine\')',[draw!.draw_id]);
    assert.equal(await scalar<number>(db,"select count(*)::int as value from messages where metadata->>'source'='draw'"),0);
    assert.equal(JSON.stringify(await scalar(db,'select duet_list_messages() as value')).includes('legacy answer'),false);
    assert.equal(await scalar<number>(db,"select count(*)::int as value from prompt_answers where source_type='draw'"),0);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from blind_box_inbox'),0);
    await asUser(db,users.a);
    const rows=await db.query<{id:string;answer:string;read_at:string|null}>('select * from blind_box_inbox');
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].answer,'fine');assert.equal(rows.rows[0].read_at,null);
    await db.query('select duet_read_blind_box_answer($1)',[rows.rows[0].id]);
    assert.equal(await scalar<boolean>(db,'select read_at is not null as value from blind_box_inbox'),true);
    await asUser(db,users.c);assert.equal(await scalar<number>(db,'select count(*)::int as value from blind_box_inbox'),0);
    await assert.rejects(()=>db.query('select duet_read_blind_box_answer($1)',[rows.rows[0].id]),/not_found/);
  } finally {await db.close();}
});

test('moods replace rather than accumulate and expire; other couples cannot see them',async()=>{
  const db=await database();try {
    await paired(db,users.a,users.b);await paired(db,users.c,users.d);await asUser(db,users.a);
    await db.query("select duet_set_mood('开心')");await db.query("select duet_set_mood('累了')");
    await asUser(db,users.b);assert.equal(await scalar(db,'select mood as value from daily_moods'),'累了');
    await asUser(db,users.c);assert.equal(await scalar<number>(db,'select count(*)::int as value from daily_moods'),0);
    await admin(db);await db.exec("update daily_moods set expires_at=now()-interval '1 second'");
    await asUser(db,users.b);assert.equal(await scalar<number>(db,'select count(*)::int as value from daily_moods'),0);
    await assert.rejects(()=>db.query('select duet_purge_expired_moods()'),/permission denied/);
    await admin(db);await db.exec('set role service_role');
    await db.query('select duet_purge_expired_moods()');await admin(db);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from daily_moods'),0);
  }finally{await db.close();}
});

test('song stickers cannot reveal or react to unopened songs and only allow emoji choices',async()=>{
  const db=await database();try {
    await paired(db,users.a,users.b);await paired(db,users.c,users.d);await asUser(db,users.a);
    const song=await scalar(db,"select duet_create_song('S','A','','',null) as value");
    await db.query("select duet_react_to_song($1,'🔥')",[song]);
    await assert.rejects(()=>db.query("select duet_react_to_song($1,'not emoji')",[song]),/invalid_reaction/);
    await asUser(db,users.b);assert.equal(await scalar<number>(db,'select count(*)::int as value from song_reactions'),0);
    await assert.rejects(()=>db.query("select duet_react_to_song($1,'🎧')",[song]),/not_found/);
    await asUser(db,users.c);await assert.rejects(()=>db.query("select duet_react_to_song($1,'🎧')",[song]),/not_found/);
  }finally{await db.close();}
});

test('inbox pagination retains older unread answers and total count independently of a page',async()=>{
  const db=await database();try {
    const couple=await paired(db,users.a,users.b);await admin(db);
    await db.query("insert into prompt_answers(couple_id,author_id,source_type,source_id,prompt,answer) select $1,$2,'draw',gen_random_uuid(),'Q',n::text from generate_series(1,101) n",[couple,users.b]);
    await db.query('insert into blind_box_inbox(id,couple_id,recipient_id,author_id,prompt,answer) select id,couple_id,$1,author_id,prompt,answer from prompt_answers',[users.a]);
    await asUser(db,users.a);
    type Page={items:Array<{id:string}>;unreadCount:number;nextCursor:string|null};
    const page=await scalar<Page>(db,'select duet_list_blind_box_inbox() as value');
    assert.equal(page!.items.length,50);assert.equal(page!.unreadCount,101);assert.ok(page!.nextCursor);
    const next=await scalar<Page>(db,'select duet_list_blind_box_inbox($1) as value',[page!.nextCursor]);
    assert.equal(next!.items.length,50);assert.equal(next!.unreadCount,101);
    assert.equal(new Set([...page!.items,...next!.items].map(item=>item.id)).size,100);
    const last=await scalar<Page>(db,'select duet_list_blind_box_inbox($1) as value',[next!.nextCursor]);assert.equal(last!.items.length,1);assert.equal(last!.nextCursor,null);
    await asUser(db,users.b);const other=await scalar<Page>(db,'select duet_list_blind_box_inbox() as value');assert.equal(other!.unreadCount,0);assert.equal(other!.items.length,0);
  }finally{await db.close();}
});
