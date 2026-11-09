import assert from 'node:assert/strict';
import {test} from 'node:test';
import {admin,asUser,database,paired,scalar,users} from './helpers/database';

type DB=Awaited<ReturnType<typeof database>>;
const future=(hours:number)=>new Date(Date.now()+hours*3600000).toISOString();
async function slots(db:DB) {
  for(const user of [users.a,users.b]) {
    await asUser(db,user);
    await db.query('select public.duet_add_date_availability($1,$2,$3,$4)',[future(24),future(28),'Asia/Shanghai',future(30)]);
  }
  await asUser(db,users.a);
}
async function proposal(db:DB) {
  const context=await scalar<{hash:string}>(db,"select public.duet_get_date_context('{}'::uuid[]) as value");
  return scalar<string>(db,'select public.duet_create_date_proposal($1,$2,$3,$4,$5,$6,$7,$8::uuid[]) as value',
    ['todo','Dinner',future(25),future(26),'Asia/Shanghai','A quiet dinner',context.hash,[]]);
}

test('date planning database blocks confidential or another user source and enforces couple isolation',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const shared=await scalar<{turn_id:string}>(db,"select public.duet_agent_begin_turn('I like parks',false) as value");
    await admin(db);await db.exec('set role service_role');await db.query('select public.duet_agent_finish_turn($1,$2)',[shared.turn_id,'Noted']);await asUser(db,users.a);
    const secret=await scalar<{turn_id:string}>(db,"select public.duet_agent_begin_turn('Private preference',true) as value");
    await assert.rejects(db.query('select public.duet_share_date_preference($1,$2)',['Private',secret.turn_id]),/invalid_date_source/);
    await asUser(db,users.b);
    await assert.rejects(db.query('select public.duet_share_date_preference($1,$2)',['Parks',shared.turn_id]),/invalid_date_source/);
    await asUser(db,users.a);
    const pref=await scalar<string>(db,'select public.duet_share_date_preference($1,$2) as value',['Parks',shared.turn_id]);
    await asUser(db,users.b);assert.equal((await db.query('select id from public.date_preferences where id=$1',[pref])).rows.length,1);
    await assert.rejects(db.query('select public.duet_delete_date_preference($1)',[pref]),/not_found/);
    await paired(db,users.c,users.d);assert.equal((await db.query('select id from public.date_preferences where id=$1',[pref])).rows.length,0);
    await assert.rejects(db.query('select public.duet_delete_date_preference($1)',[pref]),/not_found/);
  }finally{await admin(db);await db.close();}
});

test('date planning database creates one shared event only after both confirm and retries are idempotent',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await slots(db);const id=await proposal(db);
    const first=await scalar<{status:string;entry_id:string|null}>(db,'select public.duet_confirm_date_proposal($1,1) as value',[id]);
    assert.equal(first.status,'pending');assert.equal(first.entry_id,null);assert.equal((await db.query('select id from public.entries')).rows.length,0);
    await asUser(db,users.b);
    const second=await scalar<{status:string;entry_id:string}>(db,'select public.duet_confirm_date_proposal($1,1) as value',[id]);
    assert.equal(second.status,'completed');assert.ok(second.entry_id);
    assert.deepEqual(await scalar(db,'select public.duet_confirm_date_proposal($1,1) as value',[id]),second);
    const entries=(await db.query<{kind:string;visibility:string}>('select kind,visibility from public.entries')).rows;
    assert.deepEqual(entries,[{kind:'todo',visibility:'shared'}]);
  }finally{await admin(db);await db.close();}
});

test('date planning database edits invalidate confirmations and stale versions cannot confirm',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await slots(db);const id=await proposal(db);
    await db.query('select public.duet_confirm_date_proposal($1,1)',[id]);
    await asUser(db,users.b);
    await db.query('select public.duet_edit_date_proposal($1,1,$2,$3,$4,$5,$6,$7)',[id,'anniversary','Walk',future(25),future(26),'Asia/Shanghai','Walk together']);
    await assert.rejects(db.query('select public.duet_confirm_date_proposal($1,1)',[id]),/stale_proposal/);
    assert.equal((await db.query('select user_id from public.date_proposal_confirmations where proposal_id=$1',[id])).rows.length,0);
    const pending=await scalar<{status:string}>(db,'select public.duet_confirm_date_proposal($1,2) as value',[id]);assert.equal(pending.status,'pending');
    await asUser(db,users.a);await db.query('select public.duet_confirm_date_proposal($1,2)',[id]);
    assert.equal((await db.query<{kind:string}>("select kind from public.entries")).rows[0].kind,'anniversary');
  }finally{await admin(db);await db.close();}
});

test('date planning database refuses changed input; expired legacy availability does not block free calendars',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await slots(db);
    const context=await scalar<{hash:string}>(db,"select public.duet_get_date_context('{}'::uuid[]) as value");
    const pref=await scalar<string>(db,"select public.duet_share_date_preference('Parks',null) as value");
    await assert.rejects(db.query('select public.duet_create_date_proposal($1,$2,$3,$4,$5,$6,$7,$8::uuid[])',['todo','Plan',future(25),future(26),'Asia/Shanghai','Plan',context.hash,[]]),/date_context_changed/);
    await db.query('select public.duet_delete_date_preference($1)',[pref]);
    const id=await proposal(db);await db.query('select public.duet_cancel_date_proposal($1,1)',[id]);
    await assert.rejects(db.query('select public.duet_confirm_date_proposal($1,1)',[id]),/proposal_not_pending/);
    assert.equal((await db.query('select id from public.entries')).rows.length,0);
    await admin(db);await db.exec("update public.date_availability set expires_at=now()-interval '1 second'");await asUser(db,users.a);
    assert.ok(await proposal(db));
  }finally{await admin(db);await db.close();}
});
