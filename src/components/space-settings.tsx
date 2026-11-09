'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {useCallback,useEffect,useRef,useState} from 'react';
import {requestData} from '../lib/client-api';
import {jsonBody} from './home-space';
type Deletion={id:string;requested_by:string;status:string};
export function SpaceSettings({userId,onDeleted,appearance='details'}:{userId:string;onDeleted:()=>void;appearance?:'details'|'card'}) {
 const [requests,setRequests]=useState<Deletion[]>([]);const [message,setMessage]=useState('');const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);const busyRef=useRef(false);
 const [expanded,setExpanded]=useState(false);const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{const result=await requestData<Deletion[]>('/api/duet/deletions');setRequests(result);},[]);
 useEffect(()=>{void load().catch(error=>setMessage(error.message)).finally(()=>setLoading(false));},[load]);
 const act=async(work:()=>Promise<{deleted?:boolean}>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');try{const result=await work();if(result.deleted){setMessage('Shared space deleted.');onDeleted();}else await load();setConfirmation('');}catch(error){setMessage(error instanceof Error?error.message:'Something went wrong. Try again.');await load().catch(()=>undefined);}finally{busyRef.current=false;setBusy(false);}};
 const pending=requests.find(row=>row.status==='pending');const approved=requests.find(row=>row.status==='approved');
 const controls=<div className="approved-d-close-controls">
  <p>Both accounts must confirm before shared chats, Calendar and Pets are deleted. Email accounts stay active.</p>
  {requests[0]?.status==='rejected'&&<p role="status">Request declined. Nothing was deleted.</p>}
  {pending?<div><p>{pending.requested_by===userId?'Waiting for confirmation.':'A request to dissolve this shared space is waiting for your confirmation.'}</p>{pending.requested_by!==userId&&<><button type="button" disabled={busy} onClick={()=>void act(()=>requestData(`/api/duet/deletions/${pending.id}/respond`,jsonBody({confirm:false})))}>Decline</button><label>Type DELETE SPACE to agree<input autoComplete="off" disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label><button type="button" disabled={busy||confirmation!=='DELETE SPACE'} onClick={()=>void act(()=>requestData(`/api/duet/deletions/${pending.id}/respond`,jsonBody({confirm:true})))}>Confirm dissolution</button></>}</div>:approved?<><p>Both agreed. File cleanup is pending or retrying. The space stays closed until cleanup finishes.</p><button type="button" disabled={busy} onClick={()=>void act(()=>requestData(`/api/duet/deletions/${approved.id}/finalize`,jsonBody({})))}>Retry deletion</button></>:<><label>Type REQUEST DELETION to send a request<input autoComplete="off" disabled={busy||loading} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label><button type="button" disabled={busy||loading||confirmation!=='REQUEST DELETION'} onClick={()=>void act(()=>requestData('/api/duet/deletions',jsonBody({})))}>Request dissolution</button></>}
  <button className="approved-d-text-button" type="button" disabled={busy||loading} onClick={()=>void load().then(()=>setMessage('')).catch(error=>setMessage(error.message))}>Refresh status</button>
 </div>;
 if(appearance==='card')return <section className="approved-d-warning-card"><span aria-hidden="true">!</span><div><b>Dissolve shared space</b><small>Shared chats, Calendar and Pets will be closed for both accounts.</small>{!expanded&&!pending&&!approved&&<button type="button" className="approved-d-danger-action" disabled={busy||loading} onClick={()=>setExpanded(true)} aria-expanded={false}>{loading?<LoadingStatus/>:'Request dissolution'}</button>}{(expanded||pending||approved)&&controls}{message&&<p role="status">{<StatusText value={message}/>}</p>}</div></section>;
 return <details><summary>Dissolve shared space</summary>{controls}{message&&<p role="status">{<StatusText value={message}/>}</p>}</details>;
}
