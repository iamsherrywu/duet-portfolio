import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {locateAlbumCover} from '../src/lib/server/screenshot-layout';
test('local cover detection finds a large square independently of model coordinates',async()=>{
 const patch=await sharp({create:{width:160,height:160,channels:3,background:'#e2b165'}}).png().toBuffer();
 const image=await sharp({create:{width:300,height:500,channels:3,background:'#223344'}}).composite([{input:patch,left:70,top:40}]).png().toBuffer();
 const box=await locateAlbumCover(image);assert.ok(box);assert.ok(Math.abs(box.x*300-70)<5);assert.ok(Math.abs(box.y*500-40)<5);assert.ok(Math.abs(box.width*300-160)<5);
});
test('uniform image has no invented cover',async()=>{
 const image=await sharp({create:{width:300,height:500,channels:3,background:'#222'}}).png().toBuffer();assert.equal(await locateAlbumCover(image),null);
});
test('texture without a distinct rectangular boundary does not become an arbitrary cover',async()=>{
 const pixels=Buffer.alloc(160*240*3);let seed=42;for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}
 const image=await sharp(pixels,{raw:{width:160,height:240,channels:3}}).png().toBuffer();assert.equal(await locateAlbumCover(image),null);
});
