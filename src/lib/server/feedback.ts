import {z} from 'zod';
import {type Context,adminClient} from '../supabase/server';
import {ok,readJson,databaseError} from './http';
export async function feedbackRoutes(request:Request,path:string[],ctx:Context){
 if(path.join('/')!=='feedback'||request.method!=='POST')return null;
 const input=await readJson(request,z.object({topic:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(2000),nonce:z.uuid()}).strict());
 const db=adminClient();
 const {data:profile}=await ctx.db.from('profiles').select('display_name').eq('id',ctx.user.id).maybeSingle();
 const {error}=await db.from('user_feedback').upsert({user_id:ctx.user.id,nonce:input.nonce,topic:input.topic,body:input.body,email:ctx.user.email??null,display_name:profile?.display_name??null},{onConflict:'user_id,nonce',ignoreDuplicates:true});databaseError(error);
 const {data:row,error:readError}=await db.from('user_feedback').select('*').eq('user_id',ctx.user.id).eq('nonce',input.nonce).single();databaseError(readError);
 if(row.sent_at)return ok({saved:true,emailed:true});
 let emailed=false;
 if(process.env.RESEND_API_KEY&&process.env.FEEDBACK_FROM_EMAIL){
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`feedback-${row.id}`},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:process.env.FEEDBACK_FROM_EMAIL,to:['owner@example.com'],...(row.email?{reply_to:row.email}:{}),subject:`DUET feedback: ${row.topic}`,text:`昵称: ${row.display_name??'未填写'}\n邮箱: ${row.email??'未填写'}\n时间: ${row.created_at}\n主题: ${row.topic}\n\n${row.body}`})});
   emailed=response.ok;
   if(emailed){const {error:updateError}=await db.from('user_feedback').update({sent_at:new Date().toISOString()}).eq('id',row.id);databaseError(updateError);}
  }catch{emailed=false;}
 }
 return ok({saved:true,emailed});
}
