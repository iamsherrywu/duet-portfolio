'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {useRef,useState} from 'react';
import {requestData} from '../lib/client-api';
import {browserClient} from '../lib/supabase/browser';
export function AccountDeletion({appearance='details'}:{appearance?:'details'|'card'}) {
 const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [expanded,setExpanded]=useState(false);const busyRef=useRef(false);
 const remove=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');try{
  await requestData('/api/duet/account/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation})});
  await browserClient().auth.signOut({scope:'local'}).catch(()=>undefined);window.location.assign('/');
 }catch(e){setMessage(e instanceof Error?e.message:'Could not delete your account. Try again.');busyRef.current=false;setBusy(false)}};
 const controls=<div className="approved-d-close-controls"><p>Dissolve your shared space first. Then permanently delete your own account.</p><label>Type DELETE ACCOUNT<input autoComplete="off" disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><button type="button" disabled={busy||confirmation!=='DELETE ACCOUNT'} onClick={()=>void remove()}>{busy?'Deleting…':'Delete account'}</button>{message&&<p role="alert">{<StatusText value={message}/>}</p>}</div>;
 if(appearance==='card')return <section className="approved-d-warning-card"><span aria-hidden="true">!</span><div><b>Delete my account</b><small>First dissolve the shared space with both accounts’ confirmation. Then delete your account.</small>{!expanded?<button type="button" className="approved-d-danger-action" aria-expanded={false} onClick={()=>setExpanded(true)}>Request account deletion</button>:controls}</div></section>;
 return <details className="account-deletion"><summary>Delete account</summary>{controls}</details>;
}
