import {calendarTimeRange} from './calendar-time';

export type PersonalSchedule={id:string;owner_id:string;title:string;note:string;starts_at:string;ends_at:string;timezone:string;all_day?:boolean};
export const scheduleTime=(value:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T');
export function shiftDate(value:string,days:number){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Choose a valid date.');
 const date=new Date(`${value}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('Choose a valid date.');
 date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function buildSchedulePayload(input:{title:string;note:string;start:string;end:string;allDay?:boolean}){
 const allDay=input.allDay??false;
 const start=allDay?`${shiftDate(input.start,0)}T00:00`:input.start;
 const end=allDay?`${shiftDate(input.end,1)}T00:00`:input.end;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end))throw new Error('Choose valid start and end times.');
 const a=new Date(`${start}:00+08:00`),b=new Date(`${end}:00+08:00`);
 if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||scheduleTime(a.toISOString())!==start||scheduleTime(b.toISOString())!==end)throw new Error('Choose valid start and end times.');
 const startsAt=a.toISOString(),endsAt=b.toISOString();
 if(Date.parse(endsAt)<=Date.parse(startsAt))throw new Error(allDay?'End date must be on or after start date.':'End time must be after start time.');
 if(!calendarTimeRange.safeParse({from:startsAt,to:endsAt}).success)throw new Error('Events can span up to 366 days.');
 if(!input.title.trim()||input.title.trim().length>200||input.note.length>2000)throw new Error('Check the title and notes.');
 return {title:input.title.trim(),note:input.note,startsAt,endsAt,timezone:'Asia/Shanghai',allDay};
}
export function scheduleInitialValues(selectedDate:string,existing?:PersonalSchedule){
 const start=existing?scheduleTime(existing.starts_at):`${selectedDate}T09:00`;
 const end=existing?scheduleTime(existing.ends_at):`${selectedDate}T10:00`;
 return {start,end:existing?.all_day?`${shiftDate(end.slice(0,10),-1)}T10:00`:end,allDay:existing?.all_day??false};
}
export function scheduleLabel(row:PersonalSchedule){
 const start=scheduleTime(row.starts_at),end=scheduleTime(row.ends_at);
 if(row.all_day){const last=shiftDate(end.slice(0,10),-1);return start.slice(0,10)===last?`${last} · All-day`:`${start.slice(0,10)} – ${last} · All-day`;}
 return `${start.replace('T',' ')} – ${end.replace('T',' ')}`;
}
