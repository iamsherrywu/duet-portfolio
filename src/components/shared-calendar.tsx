'use client';
import {usePartnerName} from './use-partner-name';
import {LoadingStatus,StatusText} from './loading-status';
import {StoryArchive} from './story-archive';
import {ChatIcon} from './chat-icons';
import {MainNavigation} from './main-navigation';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { isRecord, requestData, signedMediaUrl } from '../lib/client-api';
import {PersonalScheduleForm,scheduleTime,type PersonalSchedule} from './personal-schedule-form';
import type {CommonSlot} from '../lib/date-planning';
import {scheduleLabel} from '../lib/schedule-form';

type CalendarEntry={id:string;kind:string;title:string;body:string;status:string;event_date:string;author_id:string};
type CalendarStory={id:string;author_id:string;media_id:string;caption:string|null;sent_at:string;calendar_date:string;linked_entry_id:string|null};
const pad=(value:number)=>String(value).padStart(2,'0');
const todayInShanghai=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const monthDays=(month:string)=>{
  const [year,monthNumber]=month.split('-').map(Number);
  const count=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
  const offset=(new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay()+6)%7;
  return {count,offset,year,monthNumber};
};
const validEntry=(row:unknown):row is CalendarEntry=>isRecord(row)&&typeof row.id==='string'&&typeof row.title==='string'&&typeof row.event_date==='string';
const validStory=(row:unknown):row is CalendarStory=>isRecord(row)&&typeof row.id==='string'&&typeof row.media_id==='string'&&typeof row.calendar_date==='string';

const dayRange=(date:string)=>{const start=new Date(`${date}T00:00:00+08:00`);return {from:start.toISOString(),to:new Date(start.getTime()+86400000).toISOString()};};
const overlapsDay=(row:PersonalSchedule,date:string)=>{const range=dayRange(date);return Date.parse(row.starts_at)<Date.parse(range.to)&&Date.parse(row.ends_at)>Date.parse(range.from);};
export function ScheduleAgenda({userId,schedules,free,status,onEdit,onCancel,busy=false}:{userId:string;schedules:PersonalSchedule[];free:CommonSlot[];status:'ready'|'loading'|'error';onEdit:(row:PersonalSchedule)=>void;onCancel:(row:PersonalSchedule)=>void;busy?:boolean}){
 const partnerName=usePartnerName(userId);
 if(status!=='ready')return <p role="status">{status==='loading'?<LoadingStatus/>:'Could not load free time. Try again.'}</p>;
 return <section aria-label="Schedules" className="schedule-agenda approved-agenda"><h4 className="sr-only">Schedules · Asia/Shanghai</h4>
  {!schedules.length&&<p className="approved-agenda-empty">No events today.</p>}
  <ul>{schedules.map(row=><li key={row.id}><details><summary className="approved-agenda-row"><time dateTime={row.starts_at}>{row.all_day?'All-day':scheduleTime(row.starts_at).slice(11)}</time><strong>{row.title}</strong><span className={row.owner_id===userId?'agenda-owner-self':'agenda-owner-other'}>{row.owner_id===userId?'Me':partnerName}</span></summary><div className="approved-agenda-detail"><p>{scheduleLabel(row)}</p>{row.note&&<p>{row.note}</p>}
   {row.owner_id===userId&&<><button type="button" disabled={busy} onClick={()=>onEdit(row)}>Edit</button> <button type="button" disabled={busy} onClick={()=>onCancel(row)}>Cancel</button></>}
  </div></details></li>)}</ul>
  <h4 className="sr-only">Free together</h4>{free.length?<ul>{free.map(slot=><li className="approved-agenda-row agenda-free-row" key={slot.start}><time dateTime={slot.start} title={`${scheduleTime(slot.start).replace('T',' ')}–${scheduleTime(slot.end).replace('T',' ')}`}>{scheduleTime(slot.start).slice(11)}</time><strong>Free together</strong><span>Both</span></li>)}</ul>:<p className="approved-agenda-empty">No shared free time.</p>}
 </section>;
}

function AddEventIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;}
function CalendarBotIcon(){return <ChatIcon name="robot"/>;}

export function SharedCalendar({userId,detailsOpen,onToggleDetails,onOpenAssistant,petContent,detailsContent}:{userId:string;detailsOpen:boolean;onToggleDetails:()=>void;onOpenAssistant?:()=>void;petContent?:ReactNode;detailsContent?:ReactNode}) {
 const partnerName=usePartnerName(userId);
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [today]=useState(()=>todayInShanghai());
  const [month,setMonth]=useState(()=>today.slice(0,7));
  const [selectedDate,setSelectedDate]=useState(today);
  const [entries,setEntries]=useState<CalendarEntry[]>([]);
  const [stories,setStories]=useState<CalendarStory[]>([]);
  const [images,setImages]=useState<Record<string,string>>({});
  const [message,setMessage]=useState('Loading calendar…');
  const [revision,setRevision]=useState(0);
  const [schedules,setSchedules]=useState<PersonalSchedule[]>([]);
  const [monthReady,setMonthReady]=useState('');
  const [monthError,setMonthError]=useState(false);
  const [dayData,setDayData]=useState<{date:string;revision:number;free:CommonSlot[];status:'ready'|'loading'|'error'}>({date:'',revision:-1,free:[],status:'loading'});
  const [addMenu,setAddMenu]=useState(false);
  const [editing,setEditing]=useState<PersonalSchedule|null|undefined>(undefined);
  const [busy,setBusy]=useState(false);
  const [memoryToDelete,setMemoryToDelete]=useState<CalendarEntry|null>(null),[deletingMemory,setDeletingMemory]=useState(false),[deleteError,setDeleteError]=useState(''),[memoryNotice,setMemoryNotice]=useState('');
  const deleteDialog=useRef<HTMLDialogElement>(null),deletePending=useRef(false),deleteTitle=useId();
  useEffect(()=>{if(!memoryToDelete)return;const dialog=deleteDialog.current;dialog?.showModal();return()=>dialog?.close();},[memoryToDelete]);
  const deleteMemory=async()=>{
    if(!memoryToDelete||memoryToDelete.author_id!==userId||memoryToDelete.kind!=='memory'||deletePending.current)return;
    const selected=memoryToDelete;deletePending.current=true;setDeletingMemory(true);setDeleteError('');
    try{await requestData(`/api/duet/entries/${selected.id}`,{method:'DELETE'});setEntries(rows=>rows.filter(row=>row.id!==selected.id));setStories(rows=>rows.filter(row=>!(row.author_id===userId&&row.linked_entry_id===selected.id)));setMemoryToDelete(null);setMemoryNotice('Memory deleted.');setRevision(value=>value+1);}
    catch(error){setDeleteError(error instanceof Error?error.message:'Could not delete the memory. Try again.');}
    finally{deletePending.current=false;setDeletingMemory(false);}
  };
  const scheduleDialog=useRef<HTMLDialogElement>(null),scheduleTitle=useId();
  useEffect(()=>{if(!detailsOpen)return;const node=scheduleDialog.current;node?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{node?.close();document.body.style.overflow=overflow;};},[detailsOpen]);

  useEffect(()=>{
    let disposed=false;
    const [year,monthNumber]=month.split('-').map(Number);
    const from=`${month}-01`;
    const to=`${month}-${pad(new Date(Date.UTC(year,monthNumber,0)).getUTCDate())}`;
    setMonthReady('');setMonthError(false);setEntries([]);setStories([]);setSchedules([]);setImages({});
    const start=dayRange(from).from;const finish=dayRange(to).to;
    void Promise.all([requestData<unknown>(`/api/duet/calendar?from=${from}&to=${to}`),requestData<PersonalSchedule[]>(`/api/duet/calendar/schedules?${new URLSearchParams({from:start,to:finish})}`)]).then(async ([result,nextSchedules])=>{
      const row=isRecord(result)?result:{};
      const nextEntries=Array.isArray(row.entries)?row.entries.filter(validEntry):[];
      const nextStories=Array.isArray(row.stories)?row.stories.filter(validStory):[];
      const urls=await Promise.all(nextStories.map(async story=>[story.id,await signedMediaUrl(story.media_id).catch(()=> '')] as const));
      if(disposed)return;
      setEntries(nextEntries);setStories(nextStories);setImages(Object.fromEntries(urls));setSchedules(nextSchedules);setMonthReady(month);setMessage('');
    }).catch(error=>{if(!disposed){setMonthError(true);setMessage(error instanceof Error?error.message:'Could not load calendar.');}});
    return()=>{disposed=true;};
  },[month,revision]);
  useEffect(()=>{
    let disposed=false;
    setDayData({date:selectedDate,revision,free:[],status:'loading'});
    void requestData<CommonSlot[]>(`/api/duet/calendar/free-time?${new URLSearchParams(dayRange(selectedDate))}`).then(free=>{if(!disposed)setDayData({date:selectedDate,revision,free,status:'ready'});}).catch(()=>{if(!disposed)setDayData({date:selectedDate,revision,free:[],status:'error'});});
    return()=>{disposed=true;};
  },[selectedDate,revision]);

  const {count,offset,year,monthNumber}=monthDays(month);
  const days=Array.from({length:offset+count},(_,index)=>index<offset?null:index-offset+1);
  const selectedEntries=useMemo(()=>entries.filter(entry=>entry.event_date===selectedDate),[entries,selectedDate]);
  const selectedStories=useMemo(()=>stories.filter(story=>story.calendar_date===selectedDate),[stories,selectedDate]);
  const moveMonth=(delta:number)=>{
    setEditing(undefined);
    const [currentYear,currentMonth]=month.split('-').map(Number);
    const next=new Date(currentYear,currentMonth-1+delta,1);
    const nextMonth=`${next.getFullYear()}-${pad(next.getMonth()+1)}`;setMonth(nextMonth);
    const [nextYear,nextMonthNumber]=nextMonth.split('-').map(Number);
    const date=`${nextMonth}-${pad(Math.min(new Date(Date.UTC(nextYear,nextMonthNumber,0)).getUTCDate(),Number(selectedDate.slice(8,10))))}`;
    setSelectedDate(date);
  };
  const hasItems=(day:number)=>{
    const date=`${month}-${pad(day)}`;
    return entries.some(entry=>entry.event_date===date)||stories.some(story=>story.calendar_date===date)||schedules.some(row=>overlapsDay(row,date));
  };

  return <>
  <section className="duet-calendar production-calendar" aria-label="Calendar">
    <div className="calendar-heading">
      <div className="calendar-quick-actions">
        <button type="button" className="calendar-quick-action" aria-label="Add event or date proposal" title="Add" aria-expanded={addMenu} onClick={()=>setAddMenu(value=>!value)}><AddEventIcon/></button>
        {addMenu&&<div className="calendar-add-menu"><button type="button" onClick={()=>{setAddMenu(false);setEditing(null);}}>My schedule</button><button type="button" onClick={()=>{setAddMenu(false);onOpenAssistant?.();}}>Date proposal</button></div>}
        <button type="button" className="calendar-quick-action" aria-label="Open date planner" title="Date proposal" onClick={()=>{setAddMenu(false);onOpenAssistant?.();}}><CalendarBotIcon/></button>
      </div>
      <button type="button" className="calendar-schedule-toggle" onClick={()=>{setAddMenu(false);setArchiveOpen(true);}}>Story</button>
    </div>
    <div className="calendar-month-toolbar">
      <button type="button" onClick={()=>moveMonth(-1)} aria-label="Previous month">‹</button>
      <strong>{new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,monthNumber-1,1)))}</strong>
      <button type="button" onClick={()=>moveMonth(1)} aria-label="Next month">›</button>
    </div>
    <div className="calendar-grid" role="grid" aria-label={`${month} calendar`}>
      {['M','T','W','T','F','S','S'].map((day,i)=><span key={i} role="columnheader" style={{textAlign:'center',color:'var(--duet-muted)'}}>{day}</span>)}
      {days.map((day,index)=>day===null?<span key={`blank-${index}`}/>:<button key={day} type="button" onClick={()=>{setEditing(undefined);setSelectedDate(`${month}-${pad(day)}`);if(!detailsOpen)onToggleDetails();}} aria-pressed={selectedDate===`${month}-${pad(day)}`}
        style={{minHeight:42,borderRadius:8,border:selectedDate===`${month}-${pad(day)}`?'1px solid var(--duet-gold)':'1px solid transparent',background:selectedDate===`${month}-${pad(day)}`?'var(--duet-wine)':'transparent',color:selectedDate===`${month}-${pad(day)}`?'var(--duet-gold)':'#161616'}}>
        {day}{hasItems(day)&&<span aria-label="Has events" style={{display:'block',fontSize:9,color:'var(--duet-gold)'}}>•</span>}
      </button>)}
    </div>
    {editing!==undefined&&<PersonalScheduleForm key={editing?.id??selectedDate} selectedDate={selectedDate} existing={editing??undefined} onClose={()=>setEditing(undefined)} onSaved={()=>{setEditing(undefined);setRevision(value=>value+1);}}/>}
    {monthError&&!detailsOpen&&<p className="production-calendar-error" role="alert">{<StatusText value={message}/>}<button type="button" onClick={()=>setRevision(value=>value+1)}>Retry</button></p>}
    {detailsOpen&&<dialog ref={scheduleDialog} className="calendar-schedule-details approved-schedule-dialog" aria-labelledby={scheduleTitle} onCancel={event=>{event.preventDefault();onToggleDetails();}}><header className="approved-b-header"><button type="button" className="approved-b-back" aria-label="Back" onClick={onToggleDetails}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><h2 id={scheduleTitle}>{selectedDate.replaceAll('-',' / ')}</h2><span/></header><main className="approved-schedule-body">
    {monthReady!==month&&!monthError?<LoadingStatus/>:monthError?<p role="alert">Could not load schedules.</p>:<div className="daily-shared-schedules">{schedules.filter(row=>overlapsDay(row,selectedDate)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id)).map(row=><article className="daily-shared-schedule" key={row.id}><time>{row.all_day?'All-day':`${scheduleTime(row.starts_at).slice(11)}–${scheduleTime(row.ends_at).slice(11)}`}</time><div><strong>{row.title}</strong>{row.note&&<p>{row.note}</p>}</div><span>{row.owner_id===userId?'Me':partnerName}</span></article>)}{!schedules.some(row=>overlapsDay(row,selectedDate))&&<p className="approved-agenda-empty">No events today.</p>}</div>}
    </main></dialog>}

  </section>
  {petContent}
  {archiveOpen&&<StoryArchive onClose={()=>setArchiveOpen(false)}/>}
  {memoryToDelete&&<dialog ref={deleteDialog} className="approved-memory-confirm" aria-labelledby={deleteTitle} onCancel={event=>{event.preventDefault();if(!deletePending.current)setMemoryToDelete(null);}}><h2 id={deleteTitle}>Delete this memory?</h2><p className="approved-memory-name">{memoryToDelete.title}</p><p>This removes it from your shared calendar.</p>{deleteError&&<p role="alert">{deleteError}</p>}<div><button type="button" disabled={deletingMemory} onClick={()=>setMemoryToDelete(null)}>Keep it</button><button type="button" className="approved-memory-confirm-delete" disabled={deletingMemory} onClick={()=>void deleteMemory()}>{deletingMemory?'Deleting…':'Delete'}</button></div></dialog>}
  </>;
}
