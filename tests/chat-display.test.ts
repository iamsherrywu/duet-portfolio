import test from 'node:test';
import assert from 'node:assert/strict';
import {filterChatMessages,partnerHasRead} from '../src/lib/chat-display';
test('search matches message body case-insensitively without changing timeline order',()=>{
  assert.deepEqual(filterChatMessages([{id:'a',body:'Hello'}, {id:'b',body:'world'}, {id:'c',body:'HELLO again'}],' hello ').map(row=>row.id),['a','c']);
});
test('read receipt requires another member read cursor at or after the message',()=>{
  const reads=[{user_id:'a',last_read_at:'2026-10-23T10:00:00Z'},{user_id:'b',last_read_at:'2026-10-23T09:00:00Z'}];
  assert.equal(partnerHasRead('a','2026-10-23T09:00:00Z',reads),true);
  assert.equal(partnerHasRead('a','2026-10-23T09:01:00Z',reads),false);
  assert.equal(partnerHasRead('a','2026-10-23T09:00:00Z',reads.slice(0,1)),false);
});
