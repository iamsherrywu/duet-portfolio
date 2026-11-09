import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, users, asUser, paired, scalar } from './helpers/database';

test('partner cannot read raw AI logs, and secret history stays excluded after privacy ends', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    await paired(db, users.c, users.d);
    await asUser(db, users.a);
    const open = await scalar<{ turn_id:string; history:{role:string;body:string}[] }>(db, 'select public.duet_agent_begin_turn($1,null) as value', ['今天想去散步']);
    await db.exec('reset role; set role service_role');
    await db.query('select public.duet_agent_finish_turn($1,$2)', [open.turn_id, '可以去公园']);
    await asUser(db, users.a);
    const secret = await scalar<{ turn_id:string }>(db, 'select public.duet_agent_begin_turn($1,true) as value', ['这段保密：秘密暗号是芒果']);
    await db.exec('reset role; set role service_role');
    await db.query('select public.duet_agent_finish_turn($1,$2)', [secret.turn_id, '我记住了芒果']);
    await asUser(db, users.a);
    const next = await scalar<{ turn_id:string; history:{role:string;body:string}[] }>(db, 'select public.duet_agent_begin_turn($1,false) as value', ['结束保密，聊聊晚饭']);
    assert.ok(next.history.every(m => !m.body.includes('芒果')));
    await db.exec('reset role; set role service_role');
    await db.query('select public.duet_agent_finish_turn($1,$2)', [next.turn_id, '今晚可以吃面']);
    const context = await scalar<{body:string}[]>(db, 'select public.duet_partner_context($1) as value', [users.b]);
    assert.ok(context.some(m => m.body.includes('散步')));
    assert.ok(context.every(m => !m.body.includes('芒果')));
    const outsider = await scalar<{body:string}[]>(db, 'select public.duet_partner_context($1) as value', [users.c]);
    assert.equal(outsider.length, 0);
    await asUser(db, users.b);
    assert.equal((await db.query('select * from public.agent_messages')).rows.length, 0);
    await assert.rejects(db.query('select public.duet_partner_context($1)', [users.b]), /permission denied/);
    await assert.rejects(db.query('select public.duet_agent_finish_turn($1,$2)', [secret.turn_id, 'forge']), /permission denied/);
  } finally { await db.close(); }
});

test('concurrent AI turns cannot change privacy while a response is pending', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    await asUser(db, users.a);
    await db.query('select public.duet_agent_begin_turn($1,true)', ['保密']);
    await assert.rejects(db.query('select public.duet_agent_begin_turn($1,false)', ['结束保密']), /turn_pending/);
  } finally { await db.close(); }
});
