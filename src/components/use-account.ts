'use client';
import {useEffect,useRef,useState} from 'react';
import type {AuthChangeEvent,Session,UserResponse} from '@supabase/supabase-js';
import {createAccountLifecycle,type AccountSnapshot} from '../lib/account-lifecycle';
import {accountUser,type PublicProfile} from '../lib/onboarding';
import {browserClient} from '../lib/supabase/browser';
import {requestData} from '../lib/client-api';
import type {Pet} from '../lib/pets';
type AccountData={pets:Pet[];profile:PublicProfile;couple:{coupleId:string|null;members:Array<{user_id:string}>;status?:string;isHost?:boolean;canCreateSpace?:boolean}};
export function useAccount() {
  const [state,setState]=useState<AccountSnapshot<AccountData>>({userId:undefined,data:null,error:''});
  const [email,setEmail]=useState('');const lifecycle=useRef<ReturnType<typeof createAccountLifecycle<AccountData>>|null>(null);
  useEffect(()=>{
    let client:ReturnType<typeof browserClient>;try{client=browserClient();}catch(error){setState({userId:undefined,data:null,error:error instanceof Error?error.message:'Configuration missing'});return;}
    const controller=createAccountLifecycle<AccountData>(async id=>{
      const [profile,couple]=await Promise.all([requestData<PublicProfile&{id:string}>('/api/duet/profile'),requestData<AccountData['couple']>('/api/duet/couple')]);
      if(profile.id!==id)throw new Error('Your account changed. Try again.');
      const pets=couple.coupleId&&couple.status!=='deletion_approved'?await requestData<Pet[]>('/api/duet/pets'):[];
      return {profile,couple,pets};
    },setState);lifecycle.current=controller;let authSeen=false;let disposed=false;
    const {data:{subscription}}=client.auth.onAuthStateChange((_event:AuthChangeEvent,session:Session|null)=>{
      authSeen=true;setEmail(session?.user.email??'');void controller.identify(session?.user.id??null);
    });
    void client.auth.getUser().then((result:UserResponse)=>{
      if(disposed||authSeen)return;const user=accountUser(result);setEmail(user?.email??'');return controller.identify(user?.id??null);
    }).catch((error:unknown)=>{if(!disposed&&!authSeen)setState({userId:undefined,data:null,error:error instanceof Error?error.message:'Could not check sign-in.'});});
    return()=>{disposed=true;controller.dispose();subscription.unsubscribe();lifecycle.current=null;};
  },[]);
  const refresh=()=>lifecycle.current?.refresh()??Promise.resolve();
  const signOut=async()=>{await requestData('/api/auth/sign-out',{method:'POST'});await browserClient().auth.signOut({scope:'local'});await lifecycle.current?.identify(null);};
  return {...state,email,refresh,signOut};
}
export type AccountState=ReturnType<typeof useAccount>;
export function accountToolsLabel(account:AccountState){return account.email||'Signed-in account';}
