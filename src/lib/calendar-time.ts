import {z} from 'zod';
import type {CommonSlot} from './date-planning';
export const instant=z.iso.datetime({offset:true});
export const calendarTimeRange=z.object({from:instant,to:instant}).strict().refine(value=>{
  const duration=Date.parse(value.to)-Date.parse(value.from);
  return duration>0&&duration<=366*86400000;
},{message:'Choose a date range of 366 days or less.'});
export type BusyInterval={starts_at:string;ends_at:string};
/** Half-open intervals [start,end): adjacent events never overlap. Fail closed on bad facts. */
export function commonFreeTime(busy:BusyInterval[],window:CommonSlot,now=Date.now()):CommonSlot[]{
  const range=calendarTimeRange.parse({from:window.start,to:window.end});
  const end=Date.parse(range.to);let cursor=Math.max(Date.parse(range.from),now);
  const rows=busy.map(row=>{
    const start=Date.parse(instant.parse(row.starts_at));const finish=Date.parse(instant.parse(row.ends_at));
    if(start>=finish)throw new Error('Invalid start or end time for this busy period.');
    return {start,end:finish};
  }).filter(row=>row.start<end&&row.end>cursor).sort((a,b)=>a.start-b.start||a.end-b.end);
  const free:CommonSlot[]=[];
  const add=(start:number,finish:number)=>free.push({start:new Date(start).toISOString(),end:new Date(finish).toISOString()});
  for(const row of rows){if(row.start>cursor)add(cursor,row.start);cursor=Math.max(cursor,Math.min(row.end,end));}
  if(cursor<end)add(cursor,end);
  return free;
}
