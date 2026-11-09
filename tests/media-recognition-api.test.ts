import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {mediaRoutes,type SongRecognitionDependencies} from '../src/lib/server/media';
import type {Context} from '../src/lib/supabase/server';

test('song recognition accepts one image upload and recognizes its in-memory bytes',async()=>{
  const image=await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).jpeg().toBuffer();
  const form=new FormData();form.append('file',new File([image],'screenshot.jpg',{type:'image/jpeg'}));
  const request=new Request('https://duet.example/api/duet/media/recognize',{method:'POST',headers:{'content-length':'1024'},body:form});
  const storedPurposes:string[]=[];const rateLimits:string[]=[];let analyzedDataUrl='';
  const dependencies:SongRecognitionDependencies={
    requireCouple:async()=> 'couple-1',
    rateLimit:async(_ctx,action)=>{rateLimits.push(action??'request');},
    saveMedia:async(_ctx,_bytes,purpose)=>{storedPurposes.push(purpose);return{id:`media-${storedPurposes.length}`,path:`${storedPurposes.length}.png`};},
    recognizeSong:async(dataUrl)=>{analyzedDataUrl=dataUrl;return{title:'Song Name',artist:'Artist Name',album:'Album',version:'',cover:null};},
  };
  const response=await mediaRoutes(request,['media','recognize'],{} as Context,dependencies);
  assert.ok(response);
  assert.equal(response.status,200);
  assert.match(analyzedDataUrl,/^data:image\/jpeg;base64,/);
  assert.deepEqual(storedPurposes,[]); // Full screenshot never stored on the new path.
  assert.deepEqual(rateLimits,['media','ai']);
  assert.deepEqual((await response.json()).data,{title:'Song Name',artist:'Artist Name',album:'Album',version:'',cover:null,coverMediaId:null,needsManualEntry:false,needsManualCover:true});
});

test('recognition cache reuses successful cover per account without model/storage/rate-limit calls on hits',async()=>{
 const {createRecognitionCache}=await import('../src/lib/recognition-cache');
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer();
 let modelCalls=0,uploads=0,limits=0;
 const dependencies:SongRecognitionDependencies={requireCouple:async()=> 'couple',rateLimit:async()=>{limits++;},saveMedia:async()=>{uploads++;return{id:'cover-'+uploads,path:'cover'};},recognizeSong:async()=>{modelCalls++;return{title:'Song',artist:'Artist',album:'',version:'',cover:{x:0,y:0,width:1,height:1}};},cache:createRecognitionCache()};
 const run=async(user:string)=>{const form=new FormData();form.append('file',new File([image],'image.png',{type:'image/png'}));return mediaRoutes(new Request('https://duet.example/api/duet/media/recognize',{method:'POST',headers:{'content-length':'1024'},body:form}),['media','recognize'],{user:{id:user}} as Context,dependencies);};
 await run('a');await run('a');assert.equal(modelCalls,1);assert.equal(uploads,1);assert.equal(limits,2);
 await run('b');assert.equal(modelCalls,2);assert.equal(uploads,2);
});

test('optional completion must pass a second AI rate-limit check before calling the model',async()=>{
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer();
 const form=new FormData();form.append('file',new File([image],'image.png',{type:'image/png'}));let checks=0,calls=0;
 const dependencies:SongRecognitionDependencies={requireCouple:async()=> 'couple',rateLimit:async(_ctx,action)=>{if(action==='ai'&&++checks===2)throw Error('quota');},saveMedia:async()=>{throw Error('unexpected storage');},recognizeSong:async()=>{calls++;return{title:'Song',artist:'',album:'',version:'',cover:null};}};
 const response=await mediaRoutes(new Request('https://duet.example/api/duet/media/recognize',{method:'POST',headers:{'content-length':'1024'},body:form}),['media','recognize'],{} as Context,dependencies);
 assert.equal(checks,2);assert.equal(calls,1);assert.equal((await response!.json()).data.title,'Song');
});
