import {z} from 'zod';
import {calendarTimeRange,instant} from '../calendar-time';
import {timezoneInput} from '../date-planning';
import {type Context,requireCouple,rpc} from '../supabase/server';
import {ok,readJson} from './http';
import {id} from './schemas';
export const scheduleInput=z.object({title:z.string().trim().min(1).max(200),note:z.string().max(2000).default(''),startsAt:instant,endsAt:instant,timezone:timezoneInput,allDay:z.boolean().optional()}).strict()
 .refine(value=>calendarTimeRange.safeParse({from:value.startsAt,to:value.endsAt}).success,{path:['endsAt'],message:'End time must be after start time, and the event must last no more than 366 days.'})
 .refine(value=>!value.allDay||[value.startsAt,value.endsAt].every(time=>new Intl.DateTimeFormat('en-GB',{timeZone:value.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(time))==='00:00:00'&&Date.parse(time)%1000===0),{path:['allDay'],message:'All-day events must start and end at local midnight.'});
export async function personalScheduleRoutes(request:Request,path:string[],ctx:Context):Promise<Response|null>{
 if(path[0]!=='calendar'||!['schedules','free-time'].includes(path[1]))return null;
 await requireCouple(ctx);
 if(request.method==='GET'&&path.length===2){
  const query=new URL(request.url).searchParams;
  const range=calendarTimeRange.parse(Object.fromEntries(query));
  return ok(await rpc(ctx,path[1]==='schedules'?'duet_list_personal_schedules':'duet_common_free_time',{p_from:range.from,p_to:range.to}));
 }
 if(path[1]!=='schedules')return null;
 if((request.method==='POST'&&path.length===2)||(request.method==='PATCH'&&path.length===3)){
  const input=await readJson(request,scheduleInput);
  const args={p_title:input.title,p_note:input.note,p_starts_at:input.startsAt,p_ends_at:input.endsAt,p_timezone:input.timezone,...(input.allDay===undefined?{}:{p_all_day:input.allDay})};
  if(request.method==='POST')return ok({id:await rpc(ctx,'duet_create_personal_schedule',args)},201);
  await rpc(ctx,'duet_update_personal_schedule',{...args,p_id:id.parse(path[2])});return ok({done:true});
 }
 if(request.method==='POST'&&path.length===4&&path[3]==='cancel'){
  await readJson(request,z.object({}).strict());
  await rpc(ctx,'duet_cancel_personal_schedule',{p_id:id.parse(path[2])});return ok({done:true});
 }
 return null;
}
