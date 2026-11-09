import {z} from 'zod';

export const timezoneInput=z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}});
export const datePlanInput=z.object({title:z.string().trim().min(1).max(200),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timezone:timezoneInput,plan:z.string().trim().min(1).max(7600)}).strict()
  .refine(value=>Date.parse(value.startsAt)<Date.parse(value.endsAt),{path:['endsAt'],message:'End time must be after start time.'});
export type DatePlan=z.infer<typeof datePlanInput>;
export type Availability={owner_id:string;starts_at:string;ends_at:string;expires_at:string};
export type CommonSlot={start:string;end:string};
export function thisWeekSlots(slots:CommonSlot[],now=Date.now()):CommonSlot[] {
  const local=new Date(now+8*3600000);
  const monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(local.getUTCDay()+6)%7)-8*3600000;
  return slots.flatMap(slot=>{const start=Math.max(Date.parse(slot.start),now,monday);const end=Math.min(Date.parse(slot.end),monday+7*86400000);return start<end?[{start:new Date(start).toISOString(),end:new Date(end).toISOString()}]:[];});
}

export function commonAvailability(rows:Availability[],now=Date.now()):CommonSlot[] {
  const active=rows.filter(row=>Date.parse(row.expires_at)>now&&Date.parse(row.ends_at)>now&&Date.parse(row.starts_at)<Date.parse(row.ends_at));
  const owners=[...new Set(active.map(row=>row.owner_id))];
  if(owners.length!==2)return [];
  const unique=new Map<string,CommonSlot>();
  for(const left of active.filter(row=>row.owner_id===owners[0]))for(const right of active.filter(row=>row.owner_id===owners[1])) {
    const start=Math.max(Date.parse(left.starts_at),Date.parse(right.starts_at),now+1000);
    const end=Math.min(Date.parse(left.ends_at),Date.parse(right.ends_at));
    if(start<end) {
      const slot={start:new Date(start).toISOString(),end:new Date(end).toISOString()};
      unique.set(`${slot.start}/${slot.end}`,slot);
    }
  }
  return [...unique.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||Date.parse(a.end)-Date.parse(b.end));
}

export function validateDatePlan(value:unknown,slots:CommonSlot[],now=Date.now()):DatePlan {
  const plan=datePlanInput.parse(value);const start=Date.parse(plan.startsAt);const end=Date.parse(plan.endsAt);
  if(start<=now||!slots.some(slot=>start>=Date.parse(slot.start)&&end<=Date.parse(slot.end)))throw new Error('Choose a proposal time within your shared availability.');
  return plan;
}

export function parseModelJson(text:string):unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
}
