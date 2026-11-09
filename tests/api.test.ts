import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readJson, assertOrigin, failure } from '../src/lib/server/http';
import { afterworkNote } from '../src/lib/ai/checkin';

test('mutation requests reject another origin, including trusted-looking suffixes', () => {
  assert.throws(()=>assertOrigin(new Request('https://duet.test/api',{method:'POST',headers:{origin:'https://duet.test.evil.test'}}),'https://duet.test'),/origin/);
  assert.doesNotThrow(()=>assertOrigin(new Request('https://duet.test/api',{method:'POST',headers:{origin:'https://duet.test'}}),'https://duet.test'));
});

test('JSON requests reject extra fields, empty answers, invalid JSON and oversized bodies', async () => {
  const shape=z.object({answer:z.string().trim().min(1).max(2000)}).strict();
  const request=(body:string)=>new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body});
  await assert.rejects(readJson(request('{"answer":"ok","owner_id":"someone"}'),shape));
  await assert.rejects(readJson(request('{"answer":" "}'),shape));
  await assert.rejects(readJson(request('bad'),shape));
  await assert.rejects(readJson(request('a'.repeat(40000)),shape),/too_large/);
  assert.deepEqual(await readJson(request('{"answer":"  海边  "}'),shape),{answer:'海边'});
});

test('unexpected exceptions become generic responses without exposing internals', async () => {
  const response=failure(new Error('secret-test-key: sql connection failed'));
  assert.equal(response.status,500);
  assert.ok(!(await response.text()).includes('secret-test-key'));
});

test('afterwork falls back to the actual answers if the model fails', async () => {
  const note=await afterworkNote({energy:'有点累',wish:'安静陪伴'}, {complete:async()=>{throw new Error('provider down');}});
  assert.ok(note.includes('有点累') && note.includes('安静陪伴'));
  assert.ok(!note.includes('provider down'));
});
