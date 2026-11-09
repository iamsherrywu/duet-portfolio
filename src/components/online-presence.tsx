'use client';
import {useEffect,useState} from 'react';
import {requestData} from '../lib/client-api';
export function OnlinePresence({enabled}:{enabled:boolean}){
 useEffect(()=>{if(!enabled)return;let ended=false;
 const send=()=>{if(ended)return;void fetch('/api/duet/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({online:document.visibilityState==='visible'}),keepalive:true}).catch(()=>undefined);};
 const hide=()=>void fetch('/api/duet/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({online:false}),keepalive:true}).catch(()=>undefined);
 send();const timer=setInterval(send,15000);document.addEventListener('visibilitychange',send);window.addEventListener('pagehide',hide);
 return()=>{ended=true;clearInterval(timer);document.removeEventListener('visibilitychange',send);window.removeEventListener('pagehide',hide);hide();};
 },[enabled]);return null;
}
export function PartnerOnlineDot(){
 const [online,setOnline]=useState(false);
 useEffect(()=>{let active=true;const load=()=>{if(document.visibilityState!=='visible'){setOnline(false);return;}void requestData<{online:boolean}>('/api/duet/presence').then(data=>{if(active)setOnline(data.online);}).catch(()=>{if(active)setOnline(false);});};load();const timer=setInterval(load,15000);document.addEventListener('visibilitychange',load);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[]);
 return online?<span className="partner-online-dot" role="img" aria-label="Online"/>:null;
}
