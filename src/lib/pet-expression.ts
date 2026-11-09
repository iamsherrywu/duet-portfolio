import atlases from './pet-expression-atlases.json';
import {petArt,type Pet} from './pets';
const frames:Record<string,number>={Happy:0,Excited:0,Calm:5,Zen:1,Tired:2,Busy:5,Low:3,Annoyed:4,'Missing You':3};
/** The approved Westie sprite keeps the same frontal gaze for every mood. */
export function petExpression(pet:Pick<Pet,'kind'|'breed'>,status:string){
 const art=petArt(pet);
 if(art.id!=='dog-westie')return null;
 const name='dog-moods-front';
 const atlas=atlases[name],parts=status.split(' · '),mood=parts.at(-1)==='Sleep'?'Zen':parts[0];
 const frame=frames[mood]??(pet.kind==='cat'?5:0),[x,y,width,height]=atlas.boxes[frame];
 const scale=82/Math.max(...atlas.boxes.map(box=>box[3]));
 return {src:`/mobile/assets/${name}.png`,frame,x,y,width,height,displayWidth:width*scale,displayHeight:height*scale,atlasWidth:atlas.width,atlasHeight:atlas.height,outline:atlas.outlines[frame]};
}
