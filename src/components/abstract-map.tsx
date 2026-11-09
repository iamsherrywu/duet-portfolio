'use client';
import {LoadingStatus,StatusText} from './loading-status';

import { useEffect, useState } from 'react';
import { buildMapModel, type LiveLocation, type StoryRecord } from '../lib/story-view';
import { isRecord, requestData } from '../lib/client-api';
import {AMapView} from './amap-view';
import {buildStreetPoints} from '../lib/street-points';
import { browserClient, subscribeToCouple } from '../lib/supabase/browser';

type Profile={id:string;display_name:string};
type Share=LiveLocation&{expires_at:string;updated_at:string;accuracy_m?:number};
const isStory=(item:unknown):item is StoryRecord=>isRecord(item)&&typeof item.id==='string'&&typeof item.author_id==='string'&&typeof item.media_id==='string'&&typeof item.sent_at==='string'&&typeof item.expires_at==='string'&&typeof item.latitude==='number'&&typeof item.longitude==='number';

export function AbstractMap({onOpenStory,refreshKey=0}:{onOpenStory:(selection:{snapId?:string;authorId?:string})=>void;refreshKey?:number}) {
  const [userId,setUserId]=useState('');
  const [locations,setLocations]=useState<Share[]>([]);
  const [stories,setStories]=useState<StoryRecord[]>([]);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [message,setMessage]=useState('Loading shared map…');
  const [revision,setRevision]=useState(0);
  const [now,setNow]=useState(()=>Date.now());

  useEffect(()=>{
    let disposed=false;let unsubscribe:(()=>void)|null=null;
    const refresh=async()=>{
      const [locationRows,storyRows,couple,auth]=await Promise.all([
        requestData<unknown>('/api/duet/location'),requestData<unknown>('/api/duet/stories?scope=map'),requestData<unknown>('/api/duet/couple'),browserClient().auth.getUser(),
      ]);
      const locationData=Array.isArray(locationRows)?locationRows.filter((row):row is Share=>isRecord(row)&&typeof row.user_id==='string'&&typeof row.latitude==='number'&&typeof row.longitude==='number'&&Date.parse(String(row.expires_at))>Date.now()):[];
      const storyData=Array.isArray(storyRows)?storyRows.filter(isStory):[];
      const coupleData=isRecord(couple)?couple:null;
      const profileRows=coupleData&&Array.isArray(coupleData.profiles)?coupleData.profiles.filter((row):row is Profile=>isRecord(row)&&typeof row.id==='string'):[];
      if(disposed)return;
      setUserId(auth.data.user?.id??'');setLocations(locationData);setStories(storyData);setProfiles(profileRows);setMessage('');
      if(!unsubscribe&&typeof coupleData?.coupleId==='string')unsubscribe=subscribeToCouple(coupleData.coupleId,()=>setRevision(value=>value+1));
    };
    void refresh().catch(error=>{if(!disposed)setMessage(error instanceof Error?error.message:'Could not load the map.');});
    return()=>{disposed=true;unsubscribe?.();};
  },[revision,refreshKey]);

  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer);},[]);
  const currentLocations=locations.filter(location=>Date.parse(location.expires_at)>now);
  const model=buildMapModel(currentLocations,stories,now);
  const profileFor=(userId:string)=>profiles.find(profile=>profile.id===userId);
  return <section className="duet-map-section approved-c05-map" aria-label="Shared map">
    <p className="approved-location-note">Sharing is limited to 1 hour. Posting a story refreshes your shared map location.</p>
    <AMapView onOpenStory={onOpenStory} points={buildStreetPoints(currentLocations,stories,profiles,userId,now)}/>

    {(model.live.length>0||model.stories.length>0)&&<div className="duet-map-legend"><span><i/>Live location</span><span>▣ Map stories</span></div>}
    {message&&(model.live.length>0||model.stories.length>0)&&<p className="duet-chat-status" role="status">{<StatusText value={message}/>}</p>}
  </section>;
}
