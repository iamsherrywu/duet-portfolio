import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterworkNote } from '../src/lib/ai/checkin';
import { checkinInput } from '../src/lib/server/schemas';
import { database,users,asUser,paired } from './helpers/database';

test('maximum allowed checkin answers are saved and sent completely when the model is unavailable',async()=>{
  const db=await database();
  try {
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const b=checkinInput.parse({nonce:'30000000-0000-4000-8000-000000000001',values:{energy:'a'.repeat(2000),wish:'b'.repeat(2000),care:'c'.repeat(2000),smallThing:'d'.repeat(2000)}});
    const summary=await afterworkNote(b.values,{complete:async()=>{throw new Error('unavailable');}});
    for(const value of Object.values(b.values))assert.ok(summary.includes(value),'fallback must preserve every complete answer');
    assert.match(summary,/Energy today:/);
    await db.query('select public.duet_save_afterwork($1,$2,$3)',[b.nonce,JSON.stringify(b.values),summary]);
    const saved=await db.query<{answers:unknown}>('select answers from public.afterwork_checkins');
    assert.deepEqual(saved.rows[0].answers,b.values);
    await asUser(db,users.b);
    const sent=await db.query<{body:string}>("select body from public.messages where kind='afterwork'");
    assert.equal(sent.rows[0].body,summary);
  } finally {await db.close();}
});
