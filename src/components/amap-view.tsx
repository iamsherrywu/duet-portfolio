'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {useEffect,useRef,useState} from 'react';
import {avatarInitial} from '../lib/avatar-initial';
// The SDK is loaded only on the authenticated shared-location page.
type LngLat={getLng():number;getLat():number};
type Marker={on(event:string,handler:()=>void):void};
type MapInstance={add(marker:Marker):void;setFitView():void;destroy():void};
type SDK={Map:new(el:HTMLElement,options:object)=>MapInstance;Marker:new(options:object)=>Marker;Pixel:new(x:number,y:number)=>unknown;convertFrom(points:number[][],type:string,cb:(status:string,result:{locations?:LngLat[]})=>void):void;Geocoder:new(options:object)=>{getAddress(point:LngLat,cb:(status:string,result:{regeocode?:{formattedAddress?:string}})=>void):void}};
declare global{interface Window{AMap?:SDK;_AMapSecurityConfig?:{serviceHost:string}}}
let loading:Promise<SDK>|undefined;
async function loadSDK(){
 if(window.AMap)return window.AMap;
 if(!loading)loading=(async()=>{
  const response=await fetch('/api/maps/config',{cache:'no-store'});if(!response.ok)throw Error('Map unavailable. Please retry.');const config=await response.json();
  if(!config.key)throw Error('Street map is not configured yet.');
  window._AMapSecurityConfig={serviceHost:location.origin+'/_AMapService'};
  return new Promise<SDK>((resolve,reject)=>{const script=document.createElement('script');const timeout=setTimeout(()=>{script.remove();reject(Error('Map loading timed out.'));},15000);
   script.src='https://webapi.amap.com/maps?v=2.0&plugin=AMap.Geocoder&key='+encodeURIComponent(config.key);
   script.onload=()=>{clearTimeout(timeout);window.AMap?resolve(window.AMap):reject(Error('Map unavailable.'));};script.onerror=()=>{clearTimeout(timeout);script.remove();reject(Error('Map unavailable.'));};document.head.append(script);
  });
 })().catch(error=>{loading=undefined;throw error;});
 return loading;
}
export type StreetPoint={id:string;name:string;latitude:number;longitude:number;accuracy?:number;updatedAt?:string;storyId?:string;storyAuthorId?:string};
export function AMapView({points,onOpenStory}:{points:StreetPoint[];onOpenStory:(value:{snapId?:string;authorId?:string})=>void}){
 const container=useRef<HTMLDivElement>(null),openStory=useRef(onOpenStory);openStory.current=onOpenStory;
 const [error,setError]=useState(''),[retry,setRetry]=useState(0),[detail,setDetail]=useState<{point:StreetPoint;address:string}|null>(null);
 const serialized=JSON.stringify(points);
 useEffect(()=>{
  let disposed=false,map:MapInstance|undefined;setDetail(null);setError('');
  void loadSDK().then(sdk=>{if(disposed||!container.current)return;
   map=new sdk.Map(container.current,{zoom:16,viewMode:'2D'});
   const rows:StreetPoint[]=JSON.parse(serialized);if(!rows.length)return;
   sdk.convertFrom(rows.map(p=>[p.longitude,p.latitude]),'gps',(status,result)=>{
    if(disposed)return;if(status!=='complete'||result.locations?.length!==rows.length){setError('Could not place locations. Please retry.');return;}
    const geocoder=new sdk.Geocoder({extensions:'all',radius:100});
    result.locations.forEach((position,i)=>{const point=rows[i];const content=document.createElement('button');content.type='button';content.className='duet-amap-pin';content.textContent=point.storyId?'▣':avatarInitial(point.name,'P');content.setAttribute('aria-label',point.storyId?'Open map story':point.name);
     const marker=new sdk.Marker({position,content,offset:new sdk.Pixel(-20,-20)});map!.add(marker);
     marker.on('click',()=>{if(point.storyId){openStory.current({snapId:point.storyId});return;}if(point.storyAuthorId)openStory.current({authorId:point.storyAuthorId});setDetail({point,address:'Loading address…'});geocoder.getAddress(position,(state,data)=>{if(!disposed)setDetail(current=>current?.point.id===point.id?{point,address:state==='complete'&&data.regeocode?.formattedAddress?data.regeocode.formattedAddress:'Address unavailable.'}:current);});});
    });map!.setFitView();
   });
  }).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:'Map unavailable.');});
  return()=>{disposed=true;map?.destroy();};
 },[serialized,retry]);
 return <><div className="duet-street-map" ref={container} aria-label="Street map"/>{error&&<p role="status">{error} <button onClick={()=>setRetry(v=>v+1)}>Retry</button></p>}{detail&&<div className="duet-map-address"><strong>{detail.point.name}</strong><p>{<StatusText value={detail.address}/>}</p>{typeof detail.point.accuracy==='number'&&<small>Accuracy ±{Math.round(detail.point.accuracy)} m</small>}{detail.point.updatedAt&&<small>Updated {new Date(detail.point.updatedAt).toLocaleTimeString()}</small>}</div>}</>;
}
