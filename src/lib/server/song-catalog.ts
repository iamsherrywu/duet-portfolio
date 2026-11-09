export type SongText={title:string;artist:string;album:string;version:string};
const normalize=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[鋼]/g,'钢').replace(/[樂]/g,'乐').replace(/[^\p{L}\p{N}]/gu,'');
const versionPatterns=[/piano|钢琴/i,/instrumental|纯音乐|伴奏/i,/live|现场|現場/i,/remix|混音/i,/cover|翻唱|翻奏/i,/acoustic|不插电|不插電/i,/spedup|speedup|加速/i,/slowed|慢速/i];
const versions=(s:string)=>versionPatterns.map((p,i)=>p.test(normalize(s))?i:-1).filter(i=>i>=0);
const titleBase=(s:string)=>normalize(s.replace(/[（(\[][^(（\[]*[)）\]]/g,''));
export function matchSong(seed:SongText,rows:unknown[]):SongText|null {
 if(!seed.title.trim())return null;
 let best:SongText|null=null,bestScore=0;
 const title=titleBase(seed.title),artist=normalize(seed.artist),required=versions(seed.title+' '+seed.version);
 for(const raw of rows){
  if(!raw||typeof raw!=='object')continue;const r=raw as Record<string,unknown>;
  if(typeof r.trackName!=='string'||typeof r.artistName!=='string'||!r.artistName.trim()||r.trackName.length>200||r.artistName.length>200)continue;
  const candidateTitle=titleBase(r.trackName),candidateArtist=normalize(r.artistName);
  // Title must agree; never pick an arbitrary track merely because the artist matches.
  if(!title||title!==candidateTitle)continue;
  const candidateVersions=versions(r.trackName+' '+(typeof r.collectionName==='string'?r.collectionName:''));
  if(required.some(v=>!candidateVersions.includes(v)))continue;
  if(!required.length&&versions(r.trackName).length)continue;
  let score=60;
  if(artist){if(artist===candidateArtist)score+=30;
   else if(artist.length>=3&&(candidateArtist.includes(artist)||artist.includes(candidateArtist)))score+=18;
   else continue;
  }
  const album=typeof r.collectionName==='string'?r.collectionName.slice(0,300):'';
  if(seed.album&&normalize(seed.album)===normalize(album))score+=15;
  if(normalize(seed.title)===normalize(r.trackName))score+=10;
  if(score>bestScore){bestScore=score;best={title:r.trackName,artist:r.artistName,album:album||seed.album,version:seed.version};}
 }
 return best;
}
export async function lookupSong(seed:SongText,transport:typeof fetch=fetch):Promise<SongText|null>{
 if(!seed.title.trim())return null;
 try{
  const url=new URL('https://itunes.apple.com/search');
  // Search by title/version: an OCR-truncated artist must not exclude the correct result.
  url.search=new URLSearchParams({term:`${seed.title} ${seed.version}`.trim(),entity:'song',media:'music',limit:'25',country:/[\u3400-\u9fff]/.test(seed.title)?'HK':'US'}).toString();
  const response=await transport(url,{signal:AbortSignal.timeout(3500)});if(!response.ok)return null;
  const data=await response.json();return matchSong(seed,Array.isArray(data.results)?data.results:[]);
 }catch{return null;}
}
