import {type Context,rpc,requireCouple} from '../supabase/server';
import {AppError,databaseError,ok,readJson} from './http';
import {datePlanningRoutes} from './date-planning';
import {z} from 'zod';

async function generateWeekly(ctx:Context,token:string) {
  const {data:wishes,error}=await ctx.db.from('entries').select('id').eq('kind','wish').eq('visibility','shared').eq('status','open').order('created_at',{ascending:false}).limit(20);databaseError(error);
  const response=await datePlanningRoutes(new Request('https://internal.invalid/api/duet/date-planning/proposals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'todo',requirements:'Suggest one date for both partners this week in concise English. Consider existing shared calendar events and avoid obvious conflicts; date-only events do not define precise busy periods. If the location is unknown, ask both partners to add it in the plan. Do not access location or invent weather.',wishIds:(wishes??[]).map(row=>row.id),timezone:'Asia/Shanghai',weeklyToken:token})}),['date-planning','proposals'],ctx);
  if(!response)throw new Error('No proposal');const result=await response.json();return result.data.id as string;
}
function weeklyStatusMessage(message:string|undefined) {
  const legacy:Record<string,string>={
    '正在准备本周约会建议…':'Preparing this week\'s date suggestion…',
    '本周建议正在准备，请稍后刷新。':'This week\'s suggestion is being prepared. Refresh shortly.',
    '本周约会建议已生成，请双方核对后确认。':'This week\'s date suggestion is ready. Review it and confirm separately.',
    '本周约会建议已生成，请到约会助手核对并分别确认。':'This week\'s date suggestion is ready. Review it in the date planner and confirm separately.',
    '本周暂无共同空档，请检查双方日程、调整安排或下周再试。':'No shared availability this week. Check both schedules, adjust your plans, or try next week.',
    '本周建议暂未生成，请检查双方日程或稍后重试；没有创建日程。':'Unable to generate this week\'s suggestion. Check both schedules or try later. No calendar event was created.',
  };
  return message?(legacy[message]??(/[\u3400-\u9fff]/.test(message)?"Check this week's suggestion in the date planner.":message)):'This week\'s suggestion is being prepared. Refresh shortly.';
}
export async function ensureWeeklyDate(ctx:Context,generate:(ctx:Context,token:string)=>Promise<string>=generateWeekly) {
  const reservation=await rpc(ctx,'duet_reserve_weekly_date');
  if(!reservation.acquired)return {proposalId:reservation.proposalId??null,message:weeklyStatusMessage(reservation.message)};
  try {const proposalId=await generate(ctx,reservation.token);return {proposalId,message:'This week\'s date suggestion is ready. Review it in the date planner and confirm separately.'};}
  catch(error) {
    console.warn('duet_weekly_date_failed',{code:error instanceof AppError?error.code:'unexpected_error'});
    const message=error instanceof AppError&&error.code==='no_common_availability'?'No shared availability this week. Check both schedules, adjust your plans, or try next week.':'Unable to generate this week\'s suggestion. Check both schedules or try later. No calendar event was created.';
    await rpc(ctx,'duet_finish_weekly_date',{p_token:reservation.token,p_proposal:null,p_message:message});
    return {proposalId:null,message};
  }
}
export async function weeklyDateRoutes(request:Request,path:string[],ctx:Context):Promise<Response|null> {
  if(request.method!=='POST'||path.join('/')!=='date-planning/weekly')return null;
  await readJson(request,z.object({}).strict());await requireCouple(ctx);return ok(await ensureWeeklyDate(ctx));
}
