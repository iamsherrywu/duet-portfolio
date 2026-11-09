'use client';
import {useCallback,useEffect,useState} from 'react';
import {requestData} from '../lib/client-api';
import {jsonBody} from './home-space';
type Entry={id:string;kind:string;title:string;body:string;status:string;event_date:string|null};
export function CalendarLists() {
  const [kind,setKind]=useState('todo');const [entries,setEntries]=useState<Entry[]>([]);const [title,setTitle]=useState('');const [body,setBody]=useState('');const [date,setDate]=useState('');const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(()=>requestData<Entry[]>(`/api/duet/entries?kind=${kind}`).then(setEntries),[kind]);
  useEffect(()=>{void load().catch(error=>setStatus(error.message));},[load]);
  return <section><h2>Shared lists</h2><div>{[['todo','To-dos / dates'],['anniversary','Anniversaries'],['wish','Wishlist'],['memory','Memories']].map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div>
    {!entries.length&&<p>No entries yet.</p>}{entries.map(entry=><article key={entry.id}><h3>{entry.title}</h3><p>{entry.body}</p><p>{entry.event_date||'No date set'}{entry.status==='done'?' · Done':''}</p>{['todo','wish'].includes(kind)&&entry.status!=='done'&&<button type="button" disabled={busy} onClick={()=>{setBusy(true);void requestData(`/api/duet/entries/${entry.id}/status`,jsonBody({status:'done'})).then(load).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>Mark done</button>}</article>)}
    <details><summary>＋ Add shared entry</summary><form onSubmit={event=>{event.preventDefault();setBusy(true);void requestData('/api/duet/entries',jsonBody({kind,title,body,event_date:date||null,visibility:'shared'})).then(()=>{setTitle('');setBody('');setDate('');setStatus('Added and visible to both.');}).then(load).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>
      <label>Title<input required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)}/></label><label>Details<textarea maxLength={8000} value={body} onChange={event=>setBody(event.target.value)}/></label><label>Date (optional)<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><button disabled={busy}>Save for both</button>
    </form></details><p role="status">{status}</p>
  </section>;
}
