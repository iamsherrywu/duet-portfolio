'use client';
import {usePartnerName} from './use-partner-name';
import {LoadingStatus,StatusText} from './loading-status';

import {useCallback,useEffect,useRef,useState} from 'react';
import {requestData} from '../lib/client-api';

type Preference={id:string;owner_id:string;body:string};
type Proposal={id:string;title:string;plan:string;kind:'todo'|'anniversary';starts_at:string;ends_at:string;timezone:string;status:string;version:number;confirmed_by:string[]};
type Source={id:string;body:string;visibility:string;role:string};
type Wish={id:string;title:string;visibility:string};
const localTime=(value:string)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
const json=(body:unknown,method='POST')=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

export function SyncButton({disabled,onClick}:{disabled:boolean;onClick:()=>void}){return <button type="button" disabled={disabled} onClick={onClick}>in sync</button>;}
export function DatePlanner({userId,initialRequirements='',onCalendarChanged}:{userId:string;initialRequirements?:string;onCalendarChanged?:()=>void}) {
 const partnerName=usePartnerName(userId);
  const [preferences,setPreferences]=useState<Preference[]>([]);const [proposals,setProposals]=useState<Proposal[]>([]);
  const [sources,setSources]=useState<Source[]>([]);const [wishes,setWishes]=useState<Wish[]>([]);const [wishIds,setWishIds]=useState<string[]>([]);
  const [sourceId,setSourceId]=useState('');const [draft,setDraft]=useState('');const [draftSource,setDraftSource]=useState<string|null>(null);
  const [requirements,setRequirements]=useState(initialRequirements),[when,setWhen]=useState(''),[mood,setMood]=useState('Something relaxed'),[area,setArea]=useState('');const [kind,setKind]=useState<'todo'|'anniversary'>('todo');
  const [selectedProposal,setSelectedProposal]=useState<string|null>(null);const [editing,setEditing]=useState<Proposal|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const pending=useRef(false);
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai';
  const load=useCallback(async()=>{
    const [prefs,plans,agent,entries]=await Promise.all([
      requestData<Preference[]>('/api/duet/date-planning/preferences'),
      requestData<Proposal[]>('/api/duet/date-planning/proposals'),requestData<{messages:Source[]}>('/api/duet/agent'),requestData<Wish[]>('/api/duet/entries?kind=wish'),
    ]);
    setPreferences(prefs);setProposals(plans);setSources((agent.messages??[]).filter(row=>row.visibility==='askable'&&row.role==='user'));setWishes(entries.filter(row=>row.visibility==='shared'));
  },[]);
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Could not load.'));},[load]);
  useEffect(()=>{if(!selectedProposal)return;const timer=window.setInterval(()=>void load().catch(()=>undefined),15000);return()=>window.clearInterval(timer);},[selectedProposal,load]);
  const action=async(work:()=>Promise<void>,success:string)=>{
    if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await work();await load();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Something went wrong. Try again.');}finally{pending.current=false;setBusy(false);}
  };
  const format=(value:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
  const selected=proposals.find(plan=>plan.id===selectedProposal);
  const proposalRequirements=[when.trim()&&`When: ${when.trim()}`,`Mood: ${mood}`,requirements.trim()&&`Ideas: ${requirements.trim()}`,area.trim()&&`Area: ${area.trim()}`].filter(Boolean).join('\n');

  return <section aria-label="Date planner" className="production-date-planner approved-date-planner">
    {!selected&&<>

    <details className="date-preferences approved-date-preferences"><summary>Preferences</summary>
      <div style={{display:'grid',gap:8,paddingBlock:12}}>
        <label>Use one of my Duet messages<select value={sourceId} onChange={event=>setSourceId(event.target.value)}><option value="">Choose a nonconfidential message</option>{sources.map(row=><option key={row.id} value={row.id}>{row.body.slice(0,80)}</option>)}</select></label>
        <button type="button" disabled={!sourceId||busy} onClick={()=>void action(async()=>{const result=await requestData<{preference:string;sourceMessageId:string}>('/api/duet/date-planning/share-preview',json({messageId:sourceId}));setDraft(result.preference);setDraftSource(result.sourceMessageId);},'Draft ready. Review before sharing.')}>Preview preference</button>
        <label>Preference draft (or write your own)<textarea value={draft} maxLength={1000} onChange={event=>setDraft(event.target.value)}/></label>
        <button type="button" disabled={!draft.trim()||busy} onClick={()=>void action(async()=>{await requestData('/api/duet/date-planning/preferences',json({body:draft,sourceMessageId:draftSource}));setDraft('');setDraftSource(null);},'Preference shared with your partner.')}>Share preference</button>
      </div>
      <ul>{preferences.map(pref=><li key={pref.id}>{pref.owner_id===userId?'Me':partnerName}: {pref.body} {pref.owner_id===userId&&<button type="button" disabled={busy} onClick={()=>void action(async()=>{await requestData(`/api/duet/date-planning/preferences/${pref.id}`,{method:'DELETE'});},'Preference removed.')}>Remove</button>}</li>)}</ul>
    </details>
    <form className="date-proposal-form approved-date-create" onSubmit={event=>{event.preventDefault();if(proposalRequirements.length>2000){setMessage('Shorten your ideas to continue.');return;}void action(async()=>{const result=await requestData<{id:string}>('/api/duet/date-planning/proposals',json({kind,requirements:proposalRequirements,wishIds,timezone}));setSelectedProposal(result.id);},'');}}>
      <h2>Make time for us</h2>
      <div className="approved-date-fields"><label>When<input value={when} maxLength={200} placeholder="Friday evening" onChange={event=>setWhen(event.target.value)}/></label>
      <label>Mood<select value={mood} onChange={event=>setMood(event.target.value)}><option>Something relaxed</option><option>Playful</option><option>Adventurous</option></select></label>
      <label>Ideas<textarea placeholder="Dinner and a walk" value={requirements} maxLength={1200} onChange={event=>setRequirements(event.target.value)}/></label>
      <label>Area<input value={area} maxLength={200} placeholder="Near home" onChange={event=>setArea(event.target.value)}/></label></div>
      <button type="submit" className="production-primary" disabled={busy}>{busy?'Planning…':'Pull Request'}</button>
      <details className="approved-date-options"><summary>Options</summary><label>Save as<select value={kind} onChange={event=>setKind(event.target.value as 'todo'|'anniversary')}><option value="todo">Shared to-do</option><option value="anniversary">One-time anniversary</option></select></label>
      {wishes.map(wish=><label className="approved-wish-choice" key={wish.id}><input type="checkbox" checked={wishIds.includes(wish.id)} onChange={event=>setWishIds(rows=>event.target.checked?[...rows,wish.id]:rows.filter(id=>id!==wish.id))}/>{wish.title}</label>)}</details>
    </form>
    {proposals.length>0&&<details className="approved-proposal-list"><summary>Date proposals · {proposals.length}</summary>{proposals.map(plan=><button type="button" key={plan.id} onClick={()=>{setSelectedProposal(plan.id);setMessage('');}}><strong>{plan.title}</strong><span>{format(plan.starts_at)}</span></button>)}</details>}
    </>}
    {selected&&<article className="approved-date-result"><p className="approved-b-kicker">{new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:selected.timezone}).format(new Date(selected.starts_at))}</p><h2>{selected.title}</h2><p className="approved-date-plan">{selected.plan}</p>
      <div className="approved-confirmation-rows"><div><b>Me</b><span>{selected.confirmed_by.includes(userId)?'Confirmed':'Waiting'}</span><small>You</small></div><div><b>{partnerName}</b><span>{selected.confirmed_by.some(id=>id!==userId)?'Confirmed':'Waiting'}</span><small>{partnerName}</small></div></div>
      {selected.status==='pending'&&!selected.confirmed_by.includes(userId)&&<SyncButton disabled={busy} onClick={()=>void action(async()=>{await requestData(`/api/duet/date-planning/proposals/${selected.id}/confirm`,json({version:selected.version}));onCalendarChanged?.();},'Confirmed.')}/>}
      {selected.status==='completed'&&<p className="approved-date-state">Added to Calendar</p>}{selected.status==='cancelled'&&<p className="approved-date-state">Cancelled</p>}
      <details className="approved-date-options"><summary>Options</summary><p>{format(selected.starts_at)}–{format(selected.ends_at)}</p>{selected.status==='pending'&&<><button type="button" disabled={busy} onClick={()=>setEditing({...selected})}>Edit</button><button type="button" disabled={busy} onClick={()=>void action(async()=>{await requestData(`/api/duet/date-planning/proposals/${selected.id}/cancel`,json({version:selected.version}));},'Proposal cancelled.')}>Cancel proposal</button></>}<button type="button" onClick={()=>{setSelectedProposal(null);setEditing(null);setMessage('');}}>New proposal</button><button type="button" disabled={busy} onClick={()=>void action(load,'')}>Refresh</button></details>
    </article>}
    {editing&&<form onSubmit={event=>{event.preventDefault();void action(async()=>{await requestData(`/api/duet/date-planning/proposals/${editing.id}`,json({version:editing.version,kind:editing.kind,title:editing.title,plan:editing.plan,startsAt:editing.starts_at,endsAt:editing.ends_at,timezone:editing.timezone},'PATCH'));setEditing(null);},'Proposal updated. Both partners must confirm again.');}} style={{display:'grid',gap:8,border:'1px solid var(--duet-gold)',padding:12}}>
      <h4>Edit proposal (resets both confirmations)</h4><input aria-label="Proposal title" maxLength={200} value={editing.title} onChange={event=>setEditing({...editing,title:event.target.value})}/>
      <textarea aria-label="Proposal details" maxLength={7600} value={editing.plan} onChange={event=>setEditing({...editing,plan:event.target.value})}/>
      <label>Start<input type="datetime-local" value={localTime(editing.starts_at)} onChange={event=>{if(event.target.value)setEditing({...editing,starts_at:new Date(event.target.value).toISOString(),timezone});}}/></label>
      <label>End<input type="datetime-local" value={localTime(editing.ends_at)} onChange={event=>{if(event.target.value)setEditing({...editing,ends_at:new Date(event.target.value).toISOString(),timezone});}}/></label>
      <button type="submit" disabled={busy}>Save version</button><button type="button" onClick={()=>setEditing(null)}>Discard edits</button>
    </form>}
    {message&&<p role="status">{<StatusText value={message}/>}</p>}
  </section>;
}
