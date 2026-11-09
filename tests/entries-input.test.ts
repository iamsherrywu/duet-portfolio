import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryInput } from '../src/lib/server/schemas';

const first='20000000-0000-4000-8000-000000000001';
const second='20000000-0000-4000-8000-000000000002';

test('memory input accepts an ordered group of photos and applies existing defaults', () => {
  assert.deepEqual(entryInput.parse({kind:'memory',title:'A day out',media_ids:[first,second]}),{
    kind:'memory',title:'A day out',body:'',visibility:'shared',event_date:null,media_id:null,media_ids:[first,second],
  });
});

test('memory input rejects duplicate photos and photo groups on non-memory entries', () => {
  assert.throws(()=>entryInput.parse({kind:'memory',title:'Duplicate',media_ids:[first,first]}));
  assert.throws(()=>entryInput.parse({kind:'todo',title:'Todo',media_ids:[first]}));
});

test('legacy single-photo memory input remains accepted', () => {
  assert.equal(entryInput.parse({kind:'memory',title:'Old shape',media_id:first}).media_id,first);
});
