'use client';
import {useEffect,useRef,useState} from 'react';
import {createHomeVideoPlayback,type HomeVideoSnapshot} from '../lib/home-video-playback';
const poster='/duet/home/10-28-poster.jpg',lastFrame='/duet/home/10-28-last-frame.jpg';
const desktopVideo='/duet/home/10-28-silent.mp4',mobileVideo='/duet/home/10-28-mobile.mp4';
export function HomeHeroVideo({active}:{active:boolean}){
 const video=useRef<HTMLVideoElement>(null),container=useRef<HTMLElement>(null),player=useRef<ReturnType<typeof createHomeVideoPlayback>|null>(null);
 const [state,setState]=useState<HomeVideoSnapshot>({ready:false,playing:false,completed:false,pending:false,failed:false}),[hasFrame,setHasFrame]=useState(false);
 const [inView,setInView]=useState(false),[mobileSource,setMobileSource]=useState(false);
 useEffect(()=>{
  const node=video.current,root=container.current;if(!node||!root)return;
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  const compact=window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  setMobileSource(compact||connection?.saveData===true||['slow-2g','2g','3g'].includes(connection?.effectiveType??''));
  const controller=createHomeVideoPlayback(node,setState);player.current=controller;
  controller.setActive(active);controller.setPageVisible(!document.hidden);
  const visible=()=>controller.setPageVisible(!document.hidden);
  document.addEventListener('visibilitychange',visible);
  const updateView=(value:boolean)=>{setInView(value);controller.setInView(value);};
  const observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>updateView(entries[0]?.isIntersecting===true&&entries[0].intersectionRatio>=.15),{threshold:[0,.15]}):null;
  if(observer)observer.observe(root);else updateView(true);
  if(node.readyState>=2)controller.ready();
  return()=>{observer?.disconnect();document.removeEventListener('visibilitychange',visible);controller.dispose();player.current=null;};
 },[]);
 useEffect(()=>{player.current?.setActive(active);},[active]);
 useEffect(()=>{
  if(!active||!inView||state.ready||state.failed)return;
  const timer=window.setTimeout(()=>{if((video.current?.readyState??0)<2)player.current?.failed();},12000);
  return()=>window.clearTimeout(timer);
 },[active,inView,state.ready,state.failed]);
 const playing=state.playing||state.pending;
 const label=state.failed?'Retry animation':state.completed?'Replay animation':playing?'Pause animation':'Play animation';
 return <section ref={container} className="home-hero-video" hidden={!active} aria-label="Home animation">
  <video ref={video} src={mobileSource?mobileVideo:desktopVideo} poster={poster} muted playsInline preload={active&&inView?'auto':'none'} disablePictureInPicture disableRemotePlayback tabIndex={-1} aria-hidden="true"
   onLoadedData={()=>player.current?.ready()} onCanPlay={()=>player.current?.ready()}
   onPlaying={()=>{if(player.current?.snapshot().completed)return;setHasFrame(true);player.current?.playing();}}
   onWaiting={()=>player.current?.waiting()} onPause={()=>player.current?.paused()} onEnded={()=>player.current?.ended()} onError={()=>player.current?.failed()}/>
  {(!hasFrame||state.completed||state.failed)&&<img className="home-hero-cover" src={state.completed||state.failed?lastFrame:poster} alt="" aria-hidden="true" width={1280} height={720}/>}
  <button type="button" className="home-hero-toggle" aria-label={label} title={label} disabled={!state.ready&&!state.failed} onClick={()=>{if(state.completed)setHasFrame(false);player.current?.toggle();}}>
   {playing?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>:state.completed?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>}
  </button>
 </section>;
}
