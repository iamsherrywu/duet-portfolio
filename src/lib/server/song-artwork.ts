import sharp from 'sharp';
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function selectArtwork(rows:unknown[],title:string,artist:string,album=''):string|null {
 for(const raw of rows){
  const r=raw as Record<string,unknown>;
  if(!r||typeof r.trackName!=='string'||typeof r.artistName!=='string'||typeof r.artworkUrl100!=='string')continue;
  if(normalized(r.trackName)!==normalized(title)||normalized(r.artistName)!==normalized(artist))continue;
  if(album&& (typeof r.collectionName!=='string'||normalized(r.collectionName)!==normalized(album)))continue;
  const url=new URL(r.artworkUrl100);if(url.protocol==='https:'&&url.hostname.endsWith('.mzstatic.com'))return url.href;
 }
 return null;
}
export async function findSongArtwork(title:string,artist:string,album=''):Promise<Buffer|null>{
 const url=new URL('https://itunes.apple.com/search');url.search=new URLSearchParams({term:`${title} ${artist}`,entity:'song',limit:'25'}).toString();
 const response=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)return null;
 const data=await response.json();const artwork=selectArtwork(Array.isArray(data.results)?data.results:[],title,artist,album);if(!artwork)return null;
 const image=await fetch(artwork,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!image.ok||!image.body)return null;
 const reader=image.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();return null;}chunks.push(value);}
 return sharp(Buffer.concat(chunks),{limitInputPixels:16000000}).resize(600,600,{fit:'cover'}).png().toBuffer();
}
