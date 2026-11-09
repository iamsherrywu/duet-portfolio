import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHomeVideoPlayback} from '../src/lib/home-video-playback';
function fixture(){let plays=0,pauses=0;const media={currentTime:0,muted:false,defaultMuted:false,loop:true,play:async()=>{plays++;},pause:()=>{pauses++;},load:()=>{}};const player=createHomeVideoPlayback(media,()=>{});return {media,player,get plays(){return plays;},get pauses(){return pauses;}};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('autoplays silently only when ready, Home active, in view and page visible',async()=>{
 const f=fixture();f.player.setActive(true);f.player.setInView(true);assert.equal(f.plays,0);f.player.ready();await settle();assert.equal(f.plays,1);assert.equal(f.media.muted,true);assert.equal(f.media.defaultMuted,true);assert.equal(f.media.loop,false);
 f.player.setInView(false);assert.equal(f.player.snapshot().playing,false);f.player.setInView(true);await settle();assert.equal(f.plays,2);
 f.player.setActive(false);f.player.setInView(false);f.player.setInView(true);assert.equal(f.plays,2);f.player.setActive(true);await settle();assert.equal(f.plays,3);
 f.player.setPageVisible(false);assert.equal(f.player.snapshot().playing,false);f.player.setPageVisible(true);await settle();assert.equal(f.plays,4);f.player.dispose();
});
test('completion preserves the last frame and visibility changes never replay; only button resets time',async()=>{
 const f=fixture();f.player.setActive(true);f.player.setInView(true);f.player.ready();await settle();f.media.currentTime=32.6;f.player.ended();
 f.player.setActive(false);f.player.setInView(false);f.player.setActive(true);f.player.setInView(true);f.player.ready();await settle();assert.equal(f.plays,1);assert.equal(f.media.currentTime,32.6);assert.equal(f.player.snapshot().completed,true);
 f.player.toggle();await settle();assert.equal(f.plays,2);assert.equal(f.media.currentTime,0);assert.equal(f.player.snapshot().completed,false);f.player.dispose();
});
test('manual pause survives leaving/returning; autoplay rejection exposes a usable play button',async()=>{
 const f=fixture();f.player.setActive(true);f.player.setInView(true);f.player.ready();await settle();f.player.toggle();f.player.setInView(false);f.player.setInView(true);await settle();assert.equal(f.plays,1);f.player.toggle();await settle();assert.equal(f.plays,2);f.player.dispose();
 let blocked=true;const media={currentTime:0,muted:false,defaultMuted:false,loop:true,play:async()=>{if(blocked)throw new Error('NotAllowedError');},pause:()=>{},load:()=>{}};const player=createHomeVideoPlayback(media,()=>{});player.setActive(true);player.setInView(true);player.ready();await settle();assert.equal(player.snapshot().playing,false);blocked=false;player.toggle();await settle();assert.equal(player.snapshot().playing,true);player.dispose();
});
test('late play promises cannot resume an offscreen or disposed video',async()=>{
 let resolve!:()=>void,pauses=0;const media={currentTime:0,muted:false,defaultMuted:false,loop:true,play:()=>new Promise<void>(done=>{resolve=done;}),pause:()=>{pauses++;},load:()=>{}};const player=createHomeVideoPlayback(media,()=>{});player.setActive(true);player.setInView(true);player.ready();player.setInView(false);const before=pauses;resolve();await settle();assert.ok(pauses>before);assert.equal(player.snapshot().playing,false);player.dispose();
});
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HomeHeroVideo} from '../src/components/home-hero-video';
test('banner uses a silent inline video with no looping or native controls',()=>{
 const html=renderToStaticMarkup(createElement(HomeHeroVideo,{active:true}));
 assert.match(html,/playsInline=""/);assert.match(html,/muted=""/);assert.doesNotMatch(html,/ loop=| controls=/);assert.match(html,/10-28-silent.mp4/);
 assert.match(renderToStaticMarkup(createElement(HomeHeroVideo,{active:false})),/hidden=""/);
});
test('an older play promise does not pause a newer visible playback attempt',async()=>{
 const done:Array<()=>void>=[];let pauses=0;const media={currentTime:0,muted:false,defaultMuted:false,loop:true,play:()=>new Promise<void>(resolve=>done.push(resolve)),pause:()=>{pauses++;},load:()=>{}};const p=createHomeVideoPlayback(media,()=>{});p.setActive(true);p.setInView(true);p.ready();p.setInView(false);p.setInView(true);const before=pauses;done[0]();await settle();assert.equal(pauses,before);done[1]();await settle();assert.equal(p.snapshot().playing,true);p.dispose();
});
test('media errors require a button retry and retry waits for ready data',async()=>{
 const f=fixture();f.player.setActive(true);f.player.setInView(true);f.player.ready();await settle();f.player.failed();assert.equal(f.player.snapshot().failed,true);f.player.setInView(false);f.player.setInView(true);assert.equal(f.plays,1);f.player.toggle();assert.equal(f.player.snapshot().failed,false);assert.equal(f.plays,1);f.player.ready();await settle();assert.equal(f.plays,2);f.player.dispose();
});
