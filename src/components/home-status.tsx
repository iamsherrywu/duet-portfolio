'use client';
import {MainNavigation} from './main-navigation';
import {useEffect,useId,useRef,useState} from 'react';
import {petArt,type Pet} from '../lib/pets';
export const MOODS=['Happy','Excited','Calm','Busy','Zen','Tired','Low','Missing You','Annoyed'];
export const ACTIONS=['Idle','Paw wave','Tail wag','Sleep','Eat','Play'];
export function activeMood(rows:Array<{user_id:string;mood:string;expires_at:string}>,owner:string,now=Date.now()){
 return rows.find(row=>row.user_id===owner&&Date.parse(row.expires_at)>now)?.mood??'';
}
export function PetStatus({name,value,own,onEdit}:{name:string;value:string;own:boolean;onEdit:()=>void}){
 const body=<><span className="pet-owner">{name}{own?' · Me':''}</span><span className="pet-status-value">{value||'No status yet'}{own&&<span aria-hidden="true"> ＋</span>}</span></>;
 return own?<button type="button" className="pet-status own" title={value||undefined} aria-label="Edit my mood and action" onClick={onEdit}>{body}</button>:<div className="pet-status" title={value||undefined} aria-label={`${name}'s status, read only`}>{body}</div>;
}
function StatusChoices({label,options,value,onChange,disabled}:{label:string;options:string[];value:string;onChange:(value:string)=>void;disabled:boolean}){
 const track=useRef<HTMLDivElement>(null);
 useEffect(()=>{track.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[]);
 return <fieldset disabled={disabled}><legend>{label}</legend><div className="status-rail"><div ref={track} className="status-options" role="group" aria-label={`${label} options`} tabIndex={0}>{options.map(item=><button type="button" key={item} aria-pressed={value===item} onClick={()=>onChange(item)}>{item}</button>)}</div><button type="button" className="status-more" aria-label={`More ${label.toLowerCase()} options`} disabled={disabled} onClick={()=>track.current?.scrollBy({left:180,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>›</button></div></fieldset>;
}
export function HomeStatusEditor({value,onSave,onClose,pets,userId,moods=[],onRename}:{value:string;onSave:(value:string)=>Promise<void>;onClose:()=>void;pets?:Pet[];userId?:string;moods?:Array<{user_id:string;mood:string;expires_at:string}>;onRename?:(name:string)=>Promise<void>}){
 const [oldMood,oldAction]=value.split(' · ');
 const own=pets?.find(pet=>pet.owner_id===userId);const [name,setName]=useState(own?.name||'');
 const canonicalAction=({Wave:'Paw wave','Tail Wag':'Tail wag','Play Fight':'Play'} as Record<string,string>)[oldAction]||oldAction;
 const [mood,setMood]=useState(oldMood||'Calm'),[action,setAction]=useState(ACTIONS.includes(canonicalAction)?canonicalAction:'Idle');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);const pending=useRef(false),dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelectorAll('.status-options [aria-pressed="true"]').forEach(item=>item.scrollIntoView({block:'nearest',inline:'nearest'}));return()=>node?.close();},[]);
 return <dialog className={`schedule-dialog status-dialog${pets?' approved-b08-dialog':''}`} ref={dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!pending.current)onClose();}}><form onSubmit={e=>{e.preventDefault();if(pending.current)return;const status=`${mood.trim()} · ${action}`;if(!mood.trim()||status.length>40){setError('Keep your status under 40 characters.');return;}pending.current=true;setBusy(true);setError('');void (async()=>{if(onRename&&name.trim()&&name.trim()!==own?.name)await onRename(name.trim());await onSave(status);})().then(onClose).catch(e=>setError(e instanceof Error?e.message:'Could not save. Try again.')).finally(()=>{pending.current=false;setBusy(false);});}}>
 <header className="schedule-toolbar"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><h2 id={titleId}>{pets?'Pets':'My status'}</h2><button type="submit" className="schedule-add" disabled={busy||!mood.trim()}>{busy?'Saving…':'Save'}</button></header><div className="schedule-body">
 {pets?<div className="approved-status-pet-cards">{[...pets].sort((a,b)=>a.kind===b.kind?0:a.kind==='cat'?-1:1).map(pet=>{const mine=pet.owner_id===userId;const [otherMood,otherAction]=activeMood(moods,pet.owner_id).split(' · ');return <section className="approved-status-pet-card" key={pet.id}><img src={petArt(pet).src} alt={pet.kind}/><div>{mine?<input aria-label="Pet name" value={name} maxLength={40} required disabled={busy} onChange={event=>setName(event.target.value)}/>:<strong>{pet.name}</strong>}<StatusChoices label="Mood" options={MOODS} value={mine?mood:otherMood||'Calm'} onChange={setMood} disabled={!mine||busy}/><StatusChoices label="Action" options={ACTIONS} value={mine?action:otherAction||'Idle'} onChange={setAction} disabled={!mine||busy}/><small>{mine?`${mood} · ${action}`:activeMood(moods,pet.owner_id)||'No status yet'}</small></div></section>;})}</div>:<><StatusChoices label="Mood" options={MOODS} value={mood} onChange={v=>{setMood(v);setError('');}} disabled={busy}/><StatusChoices label="Action" options={ACTIONS} value={action} onChange={setAction} disabled={busy}/></>}
 <details className="status-custom-details"><summary>Custom mood</summary><label className="status-custom"><span className="sr-only">Custom mood</span><input aria-label="Custom mood" value={mood} maxLength={40-action.length-3} disabled={busy} onChange={e=>setMood(e.target.value)}/></label></details>
 <p className="schedule-hint">Swipe to explore · Today only</p>{error&&<p className="schedule-error" role="alert">{error}</p>}</div></form>{pets&&<MainNavigation active="calendar" onSelect={tab=>{if(!pending.current){onClose();window.dispatchEvent(new CustomEvent('duet:navigate',{detail:tab}));}}}/>}</dialog>;
}
