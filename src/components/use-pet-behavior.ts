'use client';
import {useEffect,useRef,useState} from 'react';
import type {PetKind} from '../lib/pets';
import {petAction} from '../lib/pet-motion';
import {behaviorDuration,behaviorForAction,nextPetBehavior,type PetBehavior} from '../lib/pet-behavior';
export function usePetBehavior(kind:PetKind,status:string,active:boolean){
 const [behavior,setBehavior]=useState<PetBehavior>('idle'),[enabled,setEnabled]=useState(false),[revision,setRevision]=useState(0);
 const trigger=useRef<(state:PetBehavior)=>void>(()=>{});
 useEffect(()=>{
 const media=window.matchMedia('(prefers-reduced-motion: reduce)');let timer:ReturnType<typeof setTimeout>|undefined,current:PetBehavior='idle';
 const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
 const tick=()=>{current=nextPetBehavior(kind,current);setBehavior(current);timer=setTimeout(tick,behaviorDuration(current)+(current==='idle'?Math.random()*2000:0));};
 const start=()=>{
 clear();const running=active&&!document.hidden&&!media.matches;setEnabled(running);trigger.current=()=>{};
 if(!running){setBehavior('idle');return;}
 current=behaviorForAction(petAction(status));setBehavior(current);
 timer=setTimeout(tick,behaviorDuration(current)+(kind==='cat'?450:1550));
 trigger.current=state=>{clear();current=state;setBehavior(state);setRevision(value=>value+1);timer=setTimeout(tick,behaviorDuration(state));};
 };
 start();media.addEventListener('change',start);document.addEventListener('visibilitychange',start);
 return()=>{clear();trigger.current=()=>{};media.removeEventListener('change',start);document.removeEventListener('visibilitychange',start);};
 },[kind,status,active]);
 return {behavior,enabled,revision,greet:()=>trigger.current(kind==='cat'?'swipe':'wag')};
}
