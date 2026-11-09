import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isOnline} from '../src/lib/online-presence';
test('online requires an active fresh heartbeat; absent, hidden, expired and invalid records stay offline',()=>{
 const now=Date.now();const row=(age:number,online=true)=>({online,last_seen_at:new Date(now-age).toISOString()});
 assert.equal(isOnline(row(14000),now),true);
 for(const r of [null,row(0,false),row(45000),row(60000),row(-10000),{online:true,last_seen_at:'bad'}])assert.equal(isOnline(r,now),false);
});
