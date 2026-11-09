import sharp from 'sharp';
export type CoverBox={x:number;y:number;width:number;height:number};
// Conservative edge detector for a prominent square album on a player background.
// Return null when the four boundaries are weak; the model rectangle remains a fallback.
export async function locateAlbumCover(bytes:Buffer):Promise<CoverBox|null>{
 const {data,info}=await sharp(bytes).resize({width:320,height:480,fit:'inside',withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const {width:w,height:h,channels:c}=info;if(w<40||h<40)return null;
 const dx=new Float32Array(w*h),dy=new Float32Array(w*h),xs=new Float32Array(w),ys=new Float32Array(h);
 for(let y=1;y<h;y++)for(let x=1;x<w;x++){
  const i=y*w+x;let a=0,b=0;for(let k=0;k<c;k++){a+=Math.abs(data[i*c+k]-data[(i-1)*c+k]);b+=Math.abs(data[i*c+k]-data[(i-w)*c+k]);}
  dx[i]=a/c;dy[i]=b/c;xs[x]+=a/c/h;ys[y]+=b/c/w;
 }
 function peaks(values:Float32Array){const ranked=Array.from(values, (v,i)=>({v,i})).filter(p=>p.i>1&&p.i<values.length-2).sort((a,b)=>b.v-a.v);const chosen:number[]=[];for(const p of ranked){if(p.v<1)break;if(chosen.every(i=>Math.abs(i-p.i)>3))chosen.push(p.i);if(chosen.length===22)break;}return chosen.sort((a,b)=>a-b);}
 const xx=peaks(xs),yy=peaks(ys);let best:CoverBox|null=null,score=0;
 for(const left of xx)for(const right of xx){
  const side=right-left;if(side<w*.28||side>w*.94||side>h*.92)continue;
  for(const top of yy){
   const bottom=yy.reduce((nearest,y)=>Math.abs(y-top-side)<Math.abs(nearest-top-side)?y:nearest,yy[0]);
   if(Math.abs(bottom-top-side)>Math.max(3,side*.035))continue;
   const inset=Math.ceil(side*.12);let a=0,b=0,d=0,e=0,outside=0,count=0;
   for(let n=inset;n<side-inset;n++){const y=Math.min(h-1,top+n),x=Math.min(w-1,left+n);a+=dx[y*w+left];b+=dx[y*w+right];d+=dy[top*w+x];e+=dy[bottom*w+x];outside+=dx[y*w+Math.max(1,left-3)]+dx[y*w+Math.min(w-1,right+3)]+dy[Math.max(1,top-3)*w+x]+dy[Math.min(h-1,bottom+3)*w+x];count++;}
   const edges=[a,b,d,e].map(v=>v/count);const strength=edges.reduce((sum,v)=>sum+v,0)/4;
   if(Math.min(...edges)<5||strength<12||strength<outside/count/4*2+4)continue;
   // Geometric mean rewards four consistent boundaries rather than one text line.
   const value=Math.pow(edges.reduce((product,v)=>product*v,1),.25)*Math.sqrt(side/w);
   if(value>score){score=value;best={x:left/w,y:top/h,width:side/w,height:(bottom-top)/h};}
  }
 }
 return best;
}
