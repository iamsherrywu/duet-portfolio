'use client';
import {MainNavigation} from './main-navigation';
import {useEffect,useId,useRef,useState} from 'react';
import {requestData} from '../lib/client-api';
import {buildSchedulePayload,scheduleInitialValues,type PersonalSchedule} from '../lib/schedule-form';
export {buildSchedulePayload,scheduleTime,type PersonalSchedule} from '../lib/schedule-form';

const pad=(value:number)=>String(value).padStart(2,'0');
function SchedulePicker({value,label,allDay,onDone,onClose}:{value:string;label:string;allDay:boolean;onDone:(value:string)=>void;onClose:()=>void}){
 const [draft,setDraft]=useState(value),[mode,setMode]=useState<'date'|'time'>('date');
 const headingId=useId();const picker=useRef<HTMLDivElement>(null);
 const [year,month,day]=draft.slice(0,10).split('-').map(Number),[hour,minute]=draft.slice(11).split(':').map(Number);
 const setDate=(nextYear:number,nextMonth:number,nextDay:number)=>setDraft(`${nextYear}-${pad(nextMonth)}-${pad(Math.min(nextDay,new Date(Date.UTC(nextYear,nextMonth,0)).getUTCDate()))}T${draft.slice(11)}`);
 const setTime=(nextHour:number,nextMinute:number)=>setDraft(`${draft.slice(0,10)}T${pad(nextHour)}:${pad(nextMinute)}`);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;picker.current?.querySelector<HTMLSelectElement>('select')?.focus();return()=>previous?.focus();},[]);
 const years=Array.from({length:21},(_,i)=>year-10+i);
 return <div className="schedule-picker-shade" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={picker} className="schedule-compact-picker" role="dialog" aria-labelledby={headingId} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>
  <p className="approved-picker-kicker">DATE &amp; TIME</p><h3 id={headingId}>{label}</h3>
  <div className="schedule-picker-modes"><button type="button" aria-pressed={mode==='date'} onClick={()=>setMode('date')}>Date</button>{!allDay&&<button type="button" aria-pressed={mode==='time'} onClick={()=>setMode('time')}>Time</button>}</div>
  {mode==='date'?<div className="schedule-picker-wheels" aria-label="Choose a date">
   <label className="approved-picker-wheel"><span>Month</span><select size={3} aria-label="Month" value={month} onChange={event=>setDate(year,Number(event.target.value),day)}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Intl.DateTimeFormat('en-US',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,i,1)))}</option>)}</select></label>
   <label className="approved-picker-wheel"><span>Day</span><select size={3} aria-label="Day" value={day} onChange={event=>setDate(year,month,Number(event.target.value))}>{Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
   <label className="approved-picker-wheel"><span>Year</span><select size={3} aria-label="Year" value={year} onChange={event=>setDate(Number(event.target.value),month,day)}>{years.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
  </div>:<div className="schedule-picker-wheels" aria-label="Choose a time">
   <label className="approved-picker-wheel"><span>Hour</span><select size={3} aria-label="Hour" value={hour%12||12} onChange={event=>setTime(Number(event.target.value)%12+(hour>=12?12:0),minute)}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
   <span aria-hidden="true">:</span><label className="approved-picker-wheel"><span>Min</span><select size={3} aria-label="Minute" value={minute} onChange={event=>setTime(hour,Number(event.target.value))}>{Array.from({length:60},(_,i)=><option key={i} value={i}>{pad(i)}</option>)}</select></label>
   <label className="approved-picker-wheel"><span>AM/PM</span><select size={3} aria-label="AM or PM" value={hour>=12?'PM':'AM'} onChange={event=>setTime(hour%12+(event.target.value==='PM'?12:0),minute)}><option value="AM">AM</option><option value="PM">PM</option></select></label>
  </div>}
  <div className="schedule-picker-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" onClick={()=>onDone(draft)}>Done</button></div>
 </div></div>;
}
export function PersonalScheduleForm({selectedDate,existing,onSaved,onClose}:{selectedDate:string;existing?:PersonalSchedule;onSaved:()=>void;onClose:()=>void}){
 const initial=scheduleInitialValues(selectedDate,existing);
 const [title,setTitle]=useState(existing?.title??''),[note,setNote]=useState(existing?.note??'');
 const [start,setStart]=useState(initial.start),[end,setEnd]=useState(initial.end),[allDay,setAllDay]=useState(initial.allDay);
 const [expanded,setExpanded]=useState<'start'|'end'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const busyRef=useRef(false),dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.focus();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{node?.close();document.body.style.overflow=overflow;};},[]);
 const input={title,note,start:allDay?start.slice(0,10):start,end:allDay?end.slice(0,10):end,allDay};
 let invalid='';try{buildSchedulePayload(input);}catch(e){invalid=e instanceof Error?e.message:'Check your event.';}
 const dateText=(value:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',weekday:'short',timeZone:'Asia/Shanghai'}).format(new Date(`${value}:00+08:00`));
 const timeText=(value:string)=>new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(`${value}:00+08:00`));
 const close=()=>{if(!busyRef.current)onClose();};
 return <dialog ref={dialog} className="schedule-dialog production-schedule-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(expanded)setExpanded(null);else close();}}><form className="approved-agenda-form" inert={!!expanded} aria-label={existing?'Edit schedule':'New schedule'} onSubmit={event=>{
 event.preventDefault();if(busyRef.current)return;let payload;try{payload=buildSchedulePayload(input);}catch(e){setError(e instanceof Error?e.message:'Check your event.');return;}
 busyRef.current=true;setBusy(true);setError('');void requestData(`/api/duet/calendar/schedules${existing?`/${existing.id}`:''}`,{method:existing?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(onSaved).catch(e=>setError(e instanceof Error?e.message:'Could not save. Try again.')).finally(()=>{busyRef.current=false;setBusy(false);});
 }}><header className="schedule-toolbar approved-b-header"><button type="button" className="approved-b-back" aria-label="Back" disabled={busy} onClick={close}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><h2 id={titleId}>{existing?'Edit event':'New event'}</h2><span/></header><div className="schedule-body"><p className="approved-b-kicker">{existing?'EDIT EVENT':'NEW EVENT'}</p>
 <div className="schedule-group"><label className="schedule-title"><span>Title</span><input autoFocus required placeholder="Title" aria-label="Title" maxLength={200} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);setError('');}}/></label></div>
 <div className="schedule-group">
 {(['start','end']as const).map(key=>{const value=key==='start'?start:end;return <button key={key} type="button" className="schedule-row schedule-date-row" aria-expanded={expanded===key} disabled={busy} onClick={()=>setExpanded(key)}><span>{key==='start'?'Starts':'Ends'}</span><span className="schedule-row-value">{dateText(value)}{!allDay&&<span className="schedule-time">{timeText(value)}</span>}</span></button>;})}
 <label className="schedule-row schedule-all-day" hidden={!existing?.all_day||!!expanded}>All-day<input className="schedule-switch" type="checkbox" role="switch" checked={allDay} disabled={busy} onChange={e=>{setAllDay(e.target.checked);setError('');}}/></label></div>
 <div className="schedule-group"><label className="schedule-note"><span>Notes</span><textarea aria-label="Notes" placeholder="Optional details" maxLength={2000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label></div>{(error||(title.trim()&&invalid))&&<p className="schedule-error" role="alert">{error||invalid}</p>}</div><footer className="approved-b-footer"><button type="submit" className="production-primary" disabled={busy||!!invalid}>{busy?'Saving…':'Commit'}</button></footer></form>
 {expanded&&<SchedulePicker key={expanded} value={expanded==='start'?start:end} label={expanded==='start'?'Starts':'Ends'} allDay={allDay} onClose={()=>setExpanded(null)} onDone={value=>{if(expanded==='start')setStart(value);else setEnd(value);setError('');setExpanded(null);}}/>}
 <MainNavigation active="calendar" onSelect={tab=>{close();window.dispatchEvent(new CustomEvent('duet:navigate',{detail:tab}));}}/></dialog>;
}
