import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commonFreeTime} from '../src/lib/calendar-time';
const t=(h:number)=>new Date(Date.UTC(2099,0,1)+h*3600000).toISOString();
test('busy intervals merge, clip and subtract; adjacency and empty calendars stay free',()=>{
  const window={start:t(0),end:t(24)};
  assert.deepEqual(commonFreeTime([],window,0),[window]);
  assert.deepEqual(commonFreeTime([{starts_at:t(-1),ends_at:t(1)},{starts_at:t(9),ends_at:t(11)},{starts_at:t(10),ends_at:t(12)},{starts_at:t(12),ends_at:t(13)}],window,0),[{start:t(1),end:t(9)},{start:t(13),end:t(24)}]);
  assert.deepEqual(commonFreeTime([],window,Date.parse(t(10))),[{start:t(10),end:t(24)}]);
  assert.throws(()=>commonFreeTime([{starts_at:'bad',ends_at:t(1)}],window,0));
  assert.throws(()=>commonFreeTime([],{start:t(1),end:t(0)},0));
});
test('long stored busy intervals do not inherit the query window length limit',()=>{
 const window={start:t(0),end:t(24)};
 assert.deepEqual(commonFreeTime([{starts_at:'2100-01-01T00:00:00Z',ends_at:'2102-01-01T00:00:00Z'}],window,0),[window]);
 assert.deepEqual(commonFreeTime([{starts_at:'2098-01-01T00:00:00Z',ends_at:'2100-01-01T00:00:00Z'}],window,0),[]);
});
