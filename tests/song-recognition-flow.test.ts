import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {recognizeScreenshot} from '../src/lib/server/song-recognition';
const image=()=>sharp({create:{width:160,height:240,channels:3,background:'#222'}}).png().toBuffer();
const seed={title:'富士山下 (鋼琴版)',artist:'',album:'',version:'鋼琴版',cover:null};
test('catalog completes artist before a second model call',async()=>{
 let calls=0;const result=await recognizeScreenshot(await image(),{read:async()=>{calls++;return seed;},lookup:async()=>({...seed,artist:'Pianist',album:'Piano Album'})});
 assert.equal(result.artist,'Pianist');assert.equal(calls,1);
});
test('one focused refinement completes missing artist and preserves original screenshot cover coordinates',async()=>{
 let calls=0,lookups=0;const cover={x:.1,y:.1,width:.7,height:.5};
 const result=await recognizeScreenshot(await image(),{read:async(_image,options)=>{calls++;if(calls===1)return {...seed,cover};assert.equal(options?.mode,'complete');return {...seed,artist:'Pianist',cover:{x:0,y:0,width:1,height:1}};},lookup:async()=>{lookups++;return null;}});
 assert.equal(calls,2);assert.equal(lookups,1);assert.equal(result.artist,'Pianist');assert.deepEqual(result.cover,cover);
});
test('provider error never triggers another paid call; refinement error retains useful text',async()=>{
 let calls=0;await assert.rejects(recognizeScreenshot(await image(),{read:async()=>{calls++;throw Error('timeout');},lookup:async()=>null}));assert.equal(calls,1);
 calls=0;const result=await recognizeScreenshot(await image(),{read:async()=>{calls++;if(calls===1)return seed;throw Error('timeout');},lookup:async()=>null});assert.equal(calls,2);assert.equal(result.title,seed.title);
});
test('complete text does not trigger optional paid refinement',async()=>{
 let calls=0;const result=await recognizeScreenshot(await image(),{read:async()=>{calls++;return {...seed,artist:'Known'};},lookup:async()=>null});assert.equal(calls,1);assert.equal(result.artist,'Known');
});

test('explicitly truncated artist triggers one refinement even when text is nonempty',async()=>{
 let calls=0;const result=await recognizeScreenshot(await image(),{read:async()=>{calls++;return calls===1?{...seed,artist:'se T',uncertainFields:['artist']}:{...seed,artist:'Rose T',uncertainFields:[]};},lookup:async()=>null});
 assert.equal(calls,2);assert.equal(result.artist,'Rose T');assert.deepEqual(result.uncertainFields,[]);
});
test('fallback receives the album image as well as the readable text crop',async()=>{
 const cover={x:.1,y:.1,width:.7,height:.5};let calls=0;
 const result=await recognizeScreenshot(await image(),{read:async(_image,options)=>{calls++;if(calls===1)return {...seed,cover};assert.match(options?.referenceImage??'',/^data:image\/jpeg;base64,/);assert.equal(options?.known?.title,seed.title);return {...seed,artist:'Pianist',album:'Album'};},lookup:async()=>null});
 assert.equal(calls,2);assert.equal(result.album,'Album');
});
test('cover-only evidence gets one fallback; a blank image with no clues does not',async()=>{
 let calls=0;await recognizeScreenshot(await image(),{read:async()=>{calls++;return {title:'',artist:'',album:'',version:'',cover:null};},lookup:async()=>null});assert.equal(calls,1);
});

test('recognized album cover can recover text when the first read has no title or artist',async()=>{
 let calls=0;const result=await recognizeScreenshot(await image(),{read:async(_image,options)=>{calls++;if(calls===1)return {title:'',artist:'',album:'',version:'',cover:{x:.1,y:.1,width:.7,height:.5}};assert.ok(options?.referenceImage);return {...seed,artist:'Pianist'};},lookup:async()=>null});assert.equal(calls,2);assert.equal(result.title,seed.title);assert.equal(result.artist,'Pianist');
});
