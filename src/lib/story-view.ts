export type StoryRecord={
  id:string;
  author_id:string;
  media_id:string;
  caption:string;
  sent_at:string;
  expires_at:string;
  latitude:number|null;
  longitude:number|null;
  group_id?:string;
  group_position?:number;
  is_viewed?:boolean;
};

export type StoryGroup={authorId:string;storyIds:string[];ring:'unseen'|'seen'};
export function visibleStoryImage(image:{snapId:string;url:string}|null,id:string|undefined):string {return image&&image.snapId===id?image.url:'';}
export type LiveLocation={user_id:string;latitude:number;longitude:number};
export type MapPoint={x:number;y:number};
export type StoryMapPoint=MapPoint&{snapIds:string[];latitude:number;longitude:number};
export type MapModel={live:Array<MapPoint&{userId:string}>;stories:StoryMapPoint[]};

function activeStories(stories:StoryRecord[],now=Date.now()) {
  return stories.filter(story=>Date.parse(story.expires_at)>now);
}
function storyOrder(a:StoryRecord,b:StoryRecord) {
  return Date.parse(a.sent_at)-Date.parse(b.sent_at)
    ||(a.group_id&&a.group_id===b.group_id?(a.group_position??1)-(b.group_position??1):a.id.localeCompare(b.id));
}

export function groupStoriesByAuthor(stories:StoryRecord[],_viewerId:string,now=Date.now()):StoryGroup[] {
  const groups=new Map<string,StoryRecord[]>();
  for(const story of activeStories(stories,now))groups.set(story.author_id,[...(groups.get(story.author_id)??[]),story]);
  return [...groups.entries()].map(([authorId,items])=>({
    authorId,
    storyIds:items.sort((a,b)=>Date.parse(a.sent_at)-Date.parse(b.sent_at)).map(item=>item.id),
    ring:items.some(item=>!item.is_viewed)?'unseen':'seen',
  }));
}

function distanceMeters(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const rad=(degrees:number)=>degrees*Math.PI/180;
  const lat1=rad(a.latitude);const lat2=rad(b.latitude);
  const dLat=lat2-lat1;const dLon=rad(b.longitude-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

export function buildMapModel(locations:LiveLocation[],stories:StoryRecord[],now=Date.now()):MapModel {
  const active=activeStories(stories,now).filter((story):story is StoryRecord&{latitude:number;longitude:number}=>
    typeof story.latitude==='number'&&Number.isFinite(story.latitude)&&typeof story.longitude==='number'&&Number.isFinite(story.longitude));
  const grouped=new Map<string,StoryRecord&{latitude:number;longitude:number}>();
  for(const story of active)if(!grouped.has(story.group_id??story.id))grouped.set(story.group_id??story.id,story);
  const fixed=[...grouped.values()];
  const coordinates=[...locations,...fixed].filter(point=>Number.isFinite(point.latitude)&&Number.isFinite(point.longitude));
  if(!coordinates.length)return {live:[],stories:[]};
  const minLat=Math.min(...coordinates.map(point=>point.latitude));
  const maxLat=Math.max(...coordinates.map(point=>point.latitude));
  const minLon=Math.min(...coordinates.map(point=>point.longitude));
  const maxLon=Math.max(...coordinates.map(point=>point.longitude));
  const project=(latitude:number,longitude:number):MapPoint=>({
    x:maxLon===minLon?50:8+((longitude-minLon)/(maxLon-minLon))*84,
    y:maxLat===minLat?50:92-((latitude-minLat)/(maxLat-minLat))*84,
  });
  const clusters:Array<{latitude:number;longitude:number;snapIds:string[]}>=[];
  for(const story of fixed) {
    const cluster=clusters.find(item=>distanceMeters(item,story)<100);
    if(cluster) {
      const count=cluster.snapIds.length;
      cluster.latitude=(cluster.latitude*count+story.latitude)/(count+1);
      cluster.longitude=(cluster.longitude*count+story.longitude)/(count+1);
      cluster.snapIds.push(story.id);
    } else clusters.push({latitude:story.latitude,longitude:story.longitude,snapIds:[story.id]});
  }
  const live=locations.map(location=>({...project(location.latitude,location.longitude),userId:location.user_id}));
  const storyPoints=clusters.map(cluster=>({...project(cluster.latitude,cluster.longitude),...cluster}));
  for(const point of storyPoints) {
    if(live.some(location=>Math.hypot(point.x-location.x,point.y-location.y)<8)) {
      point.x=Math.max(8,Math.min(92,point.x>82?point.x-8:point.x+8));
      point.y=Math.max(8,Math.min(92,point.y>82?point.y-8:point.y+8));
    }
  }
  return {live,stories:storyPoints};
}

export function selectStoryViewerItems(stories:StoryRecord[],selection:{authorId?:string;snapId?:string},now=Date.now()):StoryRecord[] {
  const current=activeStories(stories,now);
  if(selection.snapId) {
    const selected=current.find(story=>story.id===selection.snapId);
    if(!selected)return [];
    return selected.group_id?current.filter(story=>story.group_id===selected.group_id).sort(storyOrder):[selected];
  }
  if(selection.authorId)return current.filter(story=>story.author_id===selection.authorId).sort(storyOrder);
  return [];
}

export function imageFit(_width:number,_height:number):'contain' {return 'contain';}
