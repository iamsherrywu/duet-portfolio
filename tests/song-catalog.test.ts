import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchSong,lookupSong} from '../src/lib/server/song-catalog';
const row=(title:string,artist:string,album='Album')=>({trackName:title,artistName:artist,collectionName:album});
test('catalog matches truncated artist while excluding original recording for piano version',()=>{
 const result=matchSong({title:'富士山下 (鋼琴版)',artist:'se T',album:'',version:'鋼琴版'},[row('富士山下','陳奕迅'),row('富士山下 (鋼琴版)','Rose T'),row('Other','Rose T')]);
 assert.equal(result?.artist,'Rose T');assert.equal(result?.title,'富士山下 (鋼琴版)');
 assert.equal(matchSong({title:'富士山下 (鋼琴版)',artist:'',album:'',version:'鋼琴版'},[row('富士山下','陳奕迅')]),null);
});
test('catalog rejects unrelated title and artist and prefers matching album',()=>{
 const seed={title:'Mantra',artist:'JENNIE',album:'Single',version:''};
 assert.equal(matchSong(seed,[row('Mantra','Other')]),null);
 assert.equal(matchSong(seed,[row('Another','JENNIE')]),null);
 assert.equal(matchSong({title:'gameboy',artist:'ROSE',album:'',version:''},[row('gameboy','ROSÉ')])?.artist,'ROSÉ');
 assert.equal(matchSong(seed,[row('Mantra','JENNIE','Album'),row('Mantra','JENNIE','Single')])?.album,'Single');
});
test('catalog makes one bounded metadata search, preserves version clues and degrades on outage',async()=>{
 let calls=0;const seed={title:'Song (Live)',artist:'A',album:'',version:'Live'};
 const result=await lookupSong(seed,async(input,init)=>{calls++;const u=new URL(String(input));assert.ok(u.searchParams.get('term')?.includes('Live'));assert.ok(init?.signal);return Response.json({results:[row('Song (Live)','A')]});});
 assert.equal(calls,1);assert.equal(result?.artist,'A');
 assert.equal(await lookupSong(seed,async()=>{throw Error('offline');}),null);
});
