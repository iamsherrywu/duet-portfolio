import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMapModel, groupStoriesByAuthor, selectStoryViewerItems, imageFit } from '../src/lib/story-view';

const now=Date.parse('2026-10-21T12:00:00Z');
const story=(id:string,authorId:string,extra:Record<string,unknown>={})=>({
  id,author_id:authorId,media_id:`media-${id}`,caption:'',sent_at:'2026-10-21T11:00:00Z',
  expires_at:'2026-10-21T13:00:00Z',latitude:null as number|null,longitude:null as number|null,
  is_viewed:false,...extra,
});

test('story view groups only active stories by author and derives the viewer-specific ring',()=>{
  const rows=groupStoriesByAuthor([
    story('one','user-a'),story('two','user-a',{is_viewed:true}),
    story('three','user-b',{is_viewed:true}),story('expired','user-b',{expires_at:'2026-10-21T11:00:00Z'}),
  ],'viewer',now);
  assert.deepEqual(rows.map(row=>[row.authorId,row.storyIds,row.ring]),[
    ['user-a',['one','two'],'unseen'],['user-b',['three'],'seen'],
  ]);
});

test('story view keeps current-location avatars separate and clusters fixed nearby story points within the viewport',()=>{
  const model=buildMapModel(
    [{user_id:'user-a',latitude:31.2,longitude:121.5},{user_id:'user-b',latitude:31.3,longitude:121.6}],
    [story('one','user-a',{latitude:31.2,longitude:121.5}),story('two','user-b',{latitude:31.20001,longitude:121.50001}),story('three','user-b',{latitude:30.2,longitude:120.5})],
    now,
  );
  assert.equal(model.live.length,2);
  assert.equal(model.stories.length,2);
  assert.equal(model.stories.find(point=>point.snapIds.length===2)?.snapIds.length,2);
  const fixedAtLiveSpot=model.stories.find(point=>point.snapIds.includes('one'))!;
  const liveAvatar=model.live.find(point=>point.userId==='user-a')!;
  assert.notDeepEqual([fixedAtLiveSpot.x,fixedAtLiveSpot.y],[liveAvatar.x,liveAvatar.y]);
  for(const point of [...model.live,...model.stories]) {
    assert.ok(point.x>=8&&point.x<=92);
    assert.ok(point.y>=8&&point.y<=92);
  }
});

test('story view opens the selected photo group in position order and an avatar opens the author sequence',()=>{
  const rows=[
    story('group-one-b','user-a',{group_id:'group-one',group_position:2,sent_at:'2026-10-21T11:00:00Z'}),
    story('other','user-a',{group_id:'group-two',group_position:1,sent_at:'2026-10-21T11:30:00Z'}),
    story('group-one-a','user-a',{group_id:'group-one',group_position:1,sent_at:'2026-10-21T11:00:00Z'}),
    story('three','user-b'),
  ];
  assert.deepEqual(selectStoryViewerItems(rows,{snapId:'group-one-b'},now).map(item=>item.id),['group-one-a','group-one-b']);
  assert.deepEqual(selectStoryViewerItems(rows,{authorId:'user-a'},now).map(item=>item.id),['group-one-a','group-one-b','other']);
});

test('story map exposes one representative pin for each multi-photo group',()=>{
  const model=buildMapModel([], [
    story('group-one-a','user-a',{group_id:'group-one',group_position:1,latitude:31.2,longitude:121.5}),
    story('group-one-b','user-a',{group_id:'group-one',group_position:2,latitude:31.2,longitude:121.5}),
  ],now);
  assert.equal(model.stories.length,1);
  assert.deepEqual(model.stories[0].snapIds,['group-one-a']);
});

test('story view uses contain sizing for landscape and portrait media',()=>{
  assert.equal(imageFit(1600,900),'contain');
  assert.equal(imageFit(900,1600),'contain');
  assert.equal(imageFit(0,0),'contain');
});
