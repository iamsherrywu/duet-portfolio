'use client';
import { createBrowserClient } from '@supabase/ssr';
let client:ReturnType<typeof createBrowserClient>|undefined;
export function browserClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url || !key) throw new Error('Supabase is not configured.');
  return client ??=createBrowserClient(url,key);
}
export function subscribeToCouple(coupleId:string,onChange:()=>void,db=browserClient()) {
  let channel=db.channel(`couple:${coupleId}:${crypto.randomUUID()}`);
  for(const table of ['messages','daily_feeds','pets','entries','blind_boxes','conversation_reads','deletion_requests','location_shares','location_snaps']) {
    channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`couple_id=eq.${coupleId}`},onChange);
  }
  channel.subscribe();
  return ()=>{void db.removeChannel(channel);};
}
