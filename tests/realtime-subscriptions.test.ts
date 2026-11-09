import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subscribeToCouple} from '../src/lib/supabase/browser';
test('concurrent couple subscribers and rapid remounts do not reuse subscribed channels',()=>{
 const channels=new Map<string,{subscribed:boolean;on:()=>unknown;subscribe:()=>void}>();const removed:unknown[]=[];
 const db={channel(name:string){let c=channels.get(name);if(!c){c={subscribed:false,on(){if(this.subscribed)throw Error('callbacks after subscribe');return this;},subscribe(){this.subscribed=true;}};channels.set(name,c);}return c;},removeChannel(c:unknown){removed.push(c);return Promise.resolve();}};
 const stopA=subscribeToCouple('same-couple',()=>{},db as never);
 const stopB=subscribeToCouple('same-couple',()=>{},db as never);
 stopA();const stopC=subscribeToCouple('same-couple',()=>{},db as never);
 assert.equal(channels.size,3);assert.equal(removed.length,1);stopB();stopC();assert.equal(removed.length,3);
});
