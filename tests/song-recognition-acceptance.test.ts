import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {AIProvider} from '../src/lib/ai/provider';
import {mediaRoutes,type SongRecognitionDependencies} from '../src/lib/server/media';
import type {Context} from '../src/lib/supabase/server';

const ctx={} as Context;
async function recognize(image:Buffer,overrides:Partial<SongRecognitionDependencies>={}){
 const stored:Array<{purpose:string;bytes:Buffer}>=[];
 const form=new FormData();form.append('file',new File([new Uint8Array(image)],'screenshot.png',{type:'image/png'}));
 const deps:SongRecognitionDependencies={requireCouple:async()=> 'couple',rateLimit:async()=>{},
 saveMedia:async(_ctx,bytes,purpose)=>{stored.push({purpose,bytes});return{id:purpose,path:purpose};},
 recognizeSong:async()=>({title:'Song',artist:'Artist',album:'Album',version:'',cover:null}),...overrides};
 const response=await mediaRoutes(new Request('http://localhost/api/duet/media/recognize',{method:'POST',headers:{'content-length':String(image.length+1024)},body:form}),['media','recognize'],ctx,deps);
 return {data:(await response!.json()).data,stored};
}

test('acceptance: two empty artist responses fall back honestly after the bounded completion attempt',async()=>{
 let requests=0;
 const provider=new AIProvider({baseUrl:'https://unused.test',key:'synthetic',model:'test'},async()=>{requests++;return Response.json({choices:[{message:{content:JSON.stringify({title:'富士山下 (鋼琴版)',artist:'',album:'',version:'鋼琴版',cover:null})}}]});});
 const image=await sharp({create:{width:40,height:60,channels:3,background:'#fff'}}).png().toBuffer();
 const {data}=await recognize(image,{recognizeSong:url=>provider.recognizeSong(url)});
 assert.equal(data.title,'富士山下 (鋼琴版)');assert.equal(data.artist,'');assert.equal(data.needsManualEntry,true);assert.equal(requests,2);
});

test('acceptance: non-square image and cover rectangle crop around rectangle center',async()=>{
 const width=120,height=200;const pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;pixels[i]=x;pixels[i+1]=y;pixels[i+2]=100;}
 const image=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
 const {stored,data}=await recognize(image,{recognizeSong:async()=>({title:'Song',artist:'Artist',album:'',version:'',cover:{x:.25,y:.2,width:.5,height:.5}})});
 // Rectangle: left=30, top=40, width=60, height=100. Centered square starts at (30,60).
 const cropped=stored.find(x=>x.purpose==='song')!;const {data:rgb,info}=await sharp(cropped.bytes).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,60);assert.equal(info.height,60);assert.equal(rgb[0],30);assert.equal(rgb[1],60);assert.equal(data.coverMediaId,'song');assert.equal(data.needsManualEntry,false);
});

test('acceptance: cover storage failure keeps text and model failure returns manual fallback without retries',async()=>{
 const image=await sharp({create:{width:40,height:60,channels:3,background:'#fff'}}).png().toBuffer();
 const {data}=await recognize(image,{recognizeSong:async()=>({title:'Song',artist:'Artist',album:'',version:'',cover:{x:0,y:0,width:1,height:1}}),saveMedia:async(_ctx,_bytes,purpose)=>{if(purpose==='song')throw Error('storage failure');return{id:'screenshot',path:'screenshot'};}});
 assert.equal(data.title,'Song');assert.equal(data.artist,'Artist');assert.equal(data.needsManualEntry,false);assert.equal(data.needsManualCover,true);
 let calls=0;const failed=await recognize(image,{recognizeSong:async()=>{calls++;throw Error('timeout');}});
 assert.equal(calls,1);assert.equal(failed.data.needsManualEntry,true);assert.equal(failed.data.sourceMediaId,undefined);assert.equal(failed.stored.length,0);
});
