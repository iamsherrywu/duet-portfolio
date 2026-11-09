'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {useEffect,useState} from 'react';
import {requestData} from '../lib/client-api';
import {jsonBody} from './home-space';
export function WeeklyDate({onOpenAssistant}:{onOpenAssistant:()=>void}) {
 const [message,setMessage]=useState('Checking this week’s date ideas…');const [busy,setBusy]=useState(false);
 const check=async()=>{setBusy(true);try{const result=await requestData<{message:string}>('/api/duet/date-planning/weekly',jsonBody({}));setMessage(result.message);}catch(error){setMessage(error instanceof Error?error.message:'Could not check suggestions.');}finally{setBusy(false);}};
 useEffect(()=>{void check();},[]);
 return <details className="approved-weekly-date"><summary>This week</summary><p role="status">{<StatusText value={message}/>}</p><button type="button" onClick={onOpenAssistant}>Date Proposal</button><button type="button" disabled={busy} onClick={()=>void check()}>Refresh</button></details>;
}
