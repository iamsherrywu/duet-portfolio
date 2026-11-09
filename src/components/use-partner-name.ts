'use client';
import {useEffect,useState} from 'react';
import {requestData} from '../lib/client-api';
export function usePartnerName(userId:string){
 const [name,setName]=useState('Partner');
 useEffect(()=>{let active=true;const load=()=>void requestData<{profiles:Array<{id:string;display_name:string}>}>('/api/duet/couple').then(data=>{if(active)setName(data.profiles.find(p=>p.id!==userId)?.display_name||'Partner');}).catch(()=>undefined);load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[userId]);return name;
}
