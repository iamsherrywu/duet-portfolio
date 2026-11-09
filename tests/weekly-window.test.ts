import test from 'node:test';import assert from 'node:assert/strict';
import {thisWeekSlots} from '../src/lib/date-planning';
test('weekly suggestions only use remaining time in this Shanghai calendar week',()=>{
 const result=thisWeekSlots([{start:'2026-10-24T02:00:00Z',end:'2026-10-24T03:00:00Z'},{start:'2026-10-26T02:00:00Z',end:'2026-10-26T03:00:00Z'},{start:'2026-10-25T15:00:00Z',end:'2026-10-25T18:00:00Z'}],Date.parse('2026-10-23T00:00:00Z'));
 assert.deepEqual(result,[{start:'2026-10-24T02:00:00.000Z',end:'2026-10-24T03:00:00.000Z'},{start:'2026-10-25T15:00:00.000Z',end:'2026-10-25T16:00:00.000Z'}]);
});
