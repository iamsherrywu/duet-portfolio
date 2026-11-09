import sharp from 'sharp';
import type {AIProvider,RecognitionOptions} from '../ai/provider';
import {lookupSong,type SongText} from './song-catalog';
import {locateAlbumCover} from './screenshot-layout';
type Song=Awaited<ReturnType<AIProvider['recognizeSong']>>;
type Dependencies={read:(dataUrl:string,options?:RecognitionOptions)=>Promise<Song>;lookup?:(song:SongText)=>Promise<SongText|null>};
const dataUrl=(bytes:Buffer)=>`data:image/jpeg;base64,${bytes.toString('base64')}`;
export async function recognizeScreenshot(bytes:Buffer,{read,lookup=lookupSong}:Dependencies):Promise<Song>{
 const localCover=await locateAlbumCover(bytes).catch(()=>null);
 const vision=await sharp(bytes).resize({width:1280,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
 const original=await read(dataUrl(vision),{mode:'read'});
 let song={...original,cover:localCover??original.cover};
 const candidate=await lookup(song).catch(()=>null);
 if(candidate)song={...song,...candidate,uncertainFields:[]};
 // Only a successful but incomplete read is eligible for another model request.
 // Provider/timeouts never cause a second attempt, and known fields survive refinement failure.
 if((song.title||song.artist||song.cover)&&(!song.title.trim()||!song.artist.trim()||song.uncertainFields?.length)){
  try{
   const metadata=await sharp(bytes).metadata();let focused=sharp(bytes);
   // When a cover was located, artist/title text is usually immediately below it.
   if(localCover&&song.title&&metadata.width&&metadata.height){
    const top=Math.max(0,Math.floor((localCover.y+localCover.height)*metadata.height)-16);
    if(metadata.height-top>=64)focused=focused.extract({left:0,top,width:metadata.width,height:metadata.height-top});
   }
   const zoom=await focused.resize({width:1600,height:1600,fit:'inside',withoutEnlargement:false}).sharpen().jpeg({quality:92}).toBuffer();
   // Keep the album available even when the focused crop excludes it.
   // A small cover reference adds no separate model request.
   let referenceImage=dataUrl(vision);
   if(song.cover&&metadata.width&&metadata.height){
    try{
     const left=Math.min(metadata.width-1,Math.max(0,Math.floor(song.cover.x*metadata.width)));
     const top=Math.min(metadata.height-1,Math.max(0,Math.floor(song.cover.y*metadata.height)));
     const width=Math.max(1,Math.min(metadata.width-left,Math.round(song.cover.width*metadata.width)));
     const height=Math.max(1,Math.min(metadata.height-top,Math.round(song.cover.height*metadata.height)));
     referenceImage=dataUrl(await sharp(bytes).extract({left,top,width,height}).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer());
    }catch{/* Full screenshot still supplies the cover if localization failed. */}
   }
   const extra=await read(dataUrl(zoom),{mode:'complete',referenceImage,known:{title:song.title,artist:song.artist,album:song.album,version:song.version}});
   song={...song,title:(!song.title||song.uncertainFields?.includes('title'))?extra.title||song.title:song.title,artist:(!song.artist||song.uncertainFields?.includes('artist'))?extra.artist||song.artist:song.artist,album:song.album||extra.album,version:song.version||extra.version,uncertainFields:extra.uncertainFields??song.uncertainFields};
   // extra.cover belongs to the focused image, not to the original screenshot.
  }catch{/* Keep all usable first-pass fields. */}
 }
 return song;
}
