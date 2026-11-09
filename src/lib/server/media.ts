import { z } from 'zod';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import type {RecognitionOptions} from '../ai/provider';
import {createRecognitionCache} from '../recognition-cache';
import {recognizeScreenshot} from './song-recognition';
import {lookupSong,type SongText} from './song-catalog';
import { type Context, requireCouple, rateLimit, rpc, adminClient } from '../supabase/server';
import { ok, AppError, databaseError, readJson } from './http';
import { id } from './schemas';
import { model } from './ai';
import { runPrivateUpload, storageUploadBody } from './upload';
import {audioMime,validateAudioHeader} from '../audio';

type RecognizedSong=Awaited<ReturnType<ReturnType<typeof model>['recognizeSong']>>;
export type SongRecognitionDependencies={
  requireCouple:typeof requireCouple;
  rateLimit:typeof rateLimit;
  saveMedia:typeof saveMedia;
  recognizeSong:(dataUrl:string,options?:RecognitionOptions)=>Promise<RecognizedSong>;
  lookupSong?:(song:SongText)=>Promise<SongText|null>;
  cache?:(key:string,load:()=>Promise<RecognitionResult>)=>Promise<RecognitionResult>;
};
type RecognitionResult=Awaited<ReturnType<typeof recognizeSongFromBytes>>;
const recognitionCache=createRecognitionCache<RecognitionResult>(32,600000,Date.now,value=>!value.needsManualEntry&&!value.uncertainFields?.length);
const songRecognitionDependencies:SongRecognitionDependencies={
  requireCouple,rateLimit,saveMedia,lookupSong,cache:recognitionCache,recognizeSong:(dataUrl,options)=>model().recognizeSong(dataUrl,options),
};

export async function mediaRoutes(request:Request,path:string[],ctx:Context,dependencies=songRecognitionDependencies):Promise<Response|null> {
  if(path[0]!=='media')return null;
  if(path.length===2 && path[1]==='recognize' && request.method==='POST') {
    await dependencies.requireCouple(ctx);
    const length=Number(request.headers.get('content-length'));
    if(!length || length>4*1024*1024+65536)throw new AppError(413,'too_large','This image request is too large. Compress the image to 4 MB or less.');
    const form=await request.formData();const file=form.get('file');
    if(!(file instanceof File) || file.size>4*1024*1024)throw new AppError(400,'invalid_file','Choose an image of 4 MB or less.');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new AppError(415,'invalid_file','Use a PNG, JPEG, or WebP image.');
    let bytes:Buffer;
    try {bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:36000000}).rotate().png().toBuffer();}
    catch {throw new AppError(400,'invalid_file','This image cannot be read or its dimensions are too large.');}
    if(bytes.length>10*1024*1024)throw new AppError(413,'too_large','The processed image is too large. Resize it and try again.');
    const load=async()=>{
      await dependencies.rateLimit(ctx,'media');await dependencies.rateLimit(ctx,'ai');
      try {return await recognizeSongFromBytes(ctx,bytes,dependencies);}
      catch {return {title:'',artist:'',album:'',version:'',cover:null,coverMediaId:null,needsManualEntry:true,needsManualCover:true};}
    };
    const result=dependencies.cache
      ? await dependencies.cache(ctx.user.id+':'+createHash('sha256').update(bytes).digest('hex'),load)
      : await load();
    return ok(result);
  }
  if(path.length===1 && request.method==='POST') {
    await requireCouple(ctx);await rateLimit(ctx,'media');
    const length=Number(request.headers.get('content-length'));
    if(!length || length>4*1024*1024+65536)throw new AppError(413,'too_large','This image request is too large. Compress the image to 4 MB or less.');
    const form=await request.formData();const file=form.get('file');
    if(!(file instanceof File) || file.size>4*1024*1024)throw new AppError(400,'invalid_file','Choose an image of 4 MB or less.');
    const purpose=z.enum(['screenshot','song','chat','memory','feed','location_avatar','story']).parse(form.get('purpose'));
    const audio=audioMime(file.type);
    if(audio) {
      if(purpose!=='chat')throw new AppError(415,'invalid_file','Voice messages are available in shared chat only.');
      const bytes=Buffer.from(await file.arrayBuffer());
      if(!validateAudioHeader(bytes,audio))throw new AppError(415,'invalid_file','Invalid audio file format.');
      return ok(await saveMedia(ctx,bytes,purpose,audio),201);
    }
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new AppError(415,'invalid_file','Use a PNG, JPEG, or WebP image.');
    let bytes:Buffer;
    try {bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:36000000}).rotate().png().toBuffer();}
    catch {throw new AppError(400,'invalid_file','This image cannot be read or its dimensions are too large.');}
    if(bytes.length>10*1024*1024)throw new AppError(413,'too_large','The processed image is too large. Resize it and try again.');
    return ok(await saveMedia(ctx,bytes,purpose),201);
  }
  if(path.length===2 && request.method==='GET') {
    await requireCouple(ctx);const media=await visibleMedia(ctx,id.parse(path[1]));
    const {data,error}=await adminClient().storage.from('duet-private').createSignedUrl(media.path,120);
    if(error || !data)throw new AppError(503,'storage_unavailable','Unable to open this image right now.');
    return ok({url:data.signedUrl,expiresIn:120});
  }
  if(path.length===3 && path[2]==='recognize' && request.method==='POST') {
    await readJson(request,z.object({}).strict());await dependencies.requireCouple(ctx);await dependencies.rateLimit(ctx,'ai');
    const media=await visibleMedia(ctx,id.parse(path[1]));
    if(media.owner_id!==ctx.user.id)throw new AppError(403,'forbidden','You can only recognize screenshots you uploaded.');
    const {data,error}=await adminClient().storage.from('duet-private').download(media.path);
    if(error || !data)throw new AppError(503,'storage_unavailable','Unable to read this screenshot right now.');
    const bytes=Buffer.from(await data.arrayBuffer());
    try {return ok(await recognizeSongFromBytes(ctx,bytes,dependencies));}
    catch {return ok({needsManualEntry:true,needsManualCover:true,sourceMediaId:media.id});}
  }
  return null;
}

async function recognizeSongFromBytes(ctx:Context,bytes:Buffer,dependencies:SongRecognitionDependencies) {
  const song=await recognizeScreenshot(bytes,{read:async(dataUrl,options)=>{
    if(options?.mode==='complete')await dependencies.rateLimit(ctx,'ai');
    return dependencies.recognizeSong(dataUrl,options);
  },lookup:dependencies.lookupSong??(async()=>null)});
  let coverMediaId:string|null=null;
  try { if(song.cover) {
    const metadata=await sharp(bytes).metadata();
    if(metadata.width && metadata.height) {
      const left=Math.min(metadata.width-1,Math.floor(song.cover.x*metadata.width));
      const top=Math.min(metadata.height-1,Math.floor(song.cover.y*metadata.height));
      const width=Math.max(1,Math.min(metadata.width-left,Math.round(song.cover.width*metadata.width)));
      const height=Math.max(1,Math.min(metadata.height-top,Math.round(song.cover.height*metadata.height)));
      const side=Math.min(width,height);
      const centerX=left+width/2,centerY=top+height/2;
      const cropLeft=Math.min(metadata.width-side,Math.max(0,Math.round(centerX-side/2)));
      const cropTop=Math.min(metadata.height-side,Math.max(0,Math.round(centerY-side/2)));
      const cover=await sharp(bytes).extract({left:cropLeft,top:cropTop,width:side,height:side}).png().toBuffer();
      coverMediaId=(await dependencies.saveMedia(ctx,cover,'song')).id;
    }
  }
  } catch { /* Preserve recognized text when cover processing fails. */ }
  return {...song,coverMediaId,needsManualEntry:!song.title||!song.artist,needsManualCover:!coverMediaId};
}

async function visibleMedia(ctx:Context,mediaId:string) {
  const {data,error}=await ctx.db.from('media').select('id,path,owner_id,purpose').eq('id',mediaId).maybeSingle();databaseError(error);
  if(!data)throw new AppError(404,'not_found','Image not found or unavailable.');return data;
}
export async function saveMedia(ctx:Context,bytes:Buffer,purpose:string,mime='image/png'):Promise<{id:string;path:string}> {
  const record=await rpc(ctx,'duet_register_media',{p_purpose:purpose,p_mime:mime});
  const admin=adminClient();
  await runPrivateUpload({
    upload:async()=>{
      const bucket=admin.storage.from('duet-private');
      for(let attempt=0;attempt<2;attempt++) {
        const {error}=await bucket.upload(record.path,storageUploadBody(bytes),{contentType:mime,upsert:false});
        if(!error)return;
        // A disconnected response can follow a successful write. Verify the exact
        // bytes before marking ready; never overwrite an existing object.
        const stored=await bucket.download(record.path);
        if(stored.data&&Buffer.from(await stored.data.arrayBuffer()).equals(bytes))return;
        console.warn('duet_storage_upload_failed',{attempt,status:'statusCode' in error?error.statusCode:null,name:error.name});
      }
      throw new AppError(503,'upload_pending','Photo upload failed. Your selection is kept. Please try sending again.');
    },
    markUploaded:async()=>{
      const {error}=await admin.rpc('duet_media_uploaded',{p_media:record.id});databaseError(error);
    },
  });
  return record;
}
