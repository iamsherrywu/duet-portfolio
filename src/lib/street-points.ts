import type {StreetPoint} from '../components/amap-view';
import type {LiveLocation,StoryRecord} from './story-view';

export function buildStreetPoints(locations:(LiveLocation&{accuracy_m?:number;updated_at:string})[],stories:StoryRecord[],profiles:{id:string;display_name:string}[],viewerId:string,now:number):StreetPoint[]{
 const active=stories.filter(s=>Date.parse(s.expires_at)>now&&s.latitude!==null&&s.longitude!==null);
 const own=active.filter(s=>s.author_id===viewerId).sort((a,b)=>Date.parse(b.sent_at)-Date.parse(a.sent_at));
 const name=(id:string)=>profiles.find(p=>p.id===id)?.display_name||'Partner';
 const points:StreetPoint[]=locations.map(p=>({id:p.user_id,name:name(p.user_id),latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy_m,updatedAt:p.updated_at,...(p.user_id===viewerId&&own.length?{storyAuthorId:viewerId}:{})}));
 // An unexpired post remains accessible at its saved location after live sharing ends.
 if(own.length&&!locations.some(p=>p.user_id===viewerId))points.push({id:viewerId,name:name(viewerId),latitude:own[0].latitude!,longitude:own[0].longitude!,storyAuthorId:viewerId});
 for(const story of active)if(story.author_id!==viewerId)points.push({id:story.id,name:'Story',latitude:story.latitude!,longitude:story.longitude!,storyId:story.id});
 return points;
}
