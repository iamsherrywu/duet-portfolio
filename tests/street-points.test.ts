import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildStreetPoints} from '../src/lib/street-points';
import type {StoryRecord} from '../src/lib/story-view';
const now=Date.now();
const story=(id:string,author_id:string,expired=false):StoryRecord=>({id,author_id,media_id:id,caption:'',sent_at:new Date(now-1000).toISOString(),expires_at:new Date(now+(expired?-1:60000)).toISOString(),latitude:31,longitude:121});
test('own posts merge into own avatar while partner posts remain separate',()=>{
 const points=buildStreetPoints([{user_id:'me',latitude:30,longitude:120,updated_at:'now'}],[story('a','me'),story('b','me'),story('c','partner')],[{id:'me',display_name:'Sherry'}],'me',now);
 assert.equal(points.length,2);assert.equal(points[0].storyAuthorId,'me');assert.equal(points[0].storyId,undefined);assert.equal(points[0].latitude,30);assert.equal(points[1].storyId,'c');
});
test('unexpired own post provides one avatar after live sharing expires; expired posts disappear',()=>{
 const points=buildStreetPoints([],[story('a','me'),story('b','me'),story('c','me',true)],[],'me',now);
 assert.equal(points.length,1);assert.equal(points[0].storyAuthorId,'me');assert.equal(points[0].latitude,31);
 assert.deepEqual(buildStreetPoints([],[story('c','me',true)],[],'me',now),[]);
});
