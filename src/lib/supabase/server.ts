import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AppError, databaseError } from '../server/http';
import { canonicalSiteUrl } from '../site-url';

export function siteUrl() { return canonicalSiteUrl(process.env,process.env.DUET_DEPLOY_ORIGIN); }
export function supabaseConfig() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url || !key) throw new AppError(503,'not_configured','Configure your Supabase project first.');
  return {url,key};
}
export function adminClient() {
  const {url}=supabaseConfig(); const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key) throw new AppError(503,'not_configured','Configure the backend first.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: Array<{ name: string; value: string; options?: CookieOptions }>): void;
};
export function createSessionClient(url: string, key: string, cookieStore: CookieStore, fetchImpl?: typeof fetch): SupabaseClient {
  return createServerClient(url,key,{
    cookies:{
      getAll:()=>cookieStore.getAll(),
      setAll:(values)=>cookieStore.setAll(values),
    },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}
export async function cookieUserClient() {
  const {url,key}=supabaseConfig();
  const jar=await cookies();
  return createSessionClient(url,key,{
    getAll:()=>jar.getAll(),
    setAll:(values)=>{ for(const {name,value,options} of values) jar.set(name,value,options); },
  });
}
export async function userClient(request?:Request) {
  const {url,key}=supabaseConfig();
  const bearer=request?.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if(bearer) return createClient(url,key,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false,autoRefreshToken:false}});
  return cookieUserClient();
}
export type Context={db:SupabaseClient;user:User};
export async function requireUser(request:Request):Promise<Context> {
  const db=await userClient(request);
  const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const {data,error}=await db.auth.getUser(token);
  if(error || !data.user) throw new AppError(401,'unauthenticated','Sign in first.');
  return {db,user:data.user};
}
export async function requireCouple(ctx:Context):Promise<string> {
  const {data,error}=await ctx.db.from('couple_members').select('couple_id').eq('user_id',ctx.user.id).maybeSingle();
  databaseError(error);
  if(!data) throw new AppError(409,'not_paired','Pair with your partner first.');
  const {data:couple,error:e}=await ctx.db.from('couples').select('status').eq('id',data.couple_id).single(); databaseError(e);
  if(!couple || couple.status!=='active') throw new AppError(409,'space_inactive','This couple space is being deleted.');
  return data.couple_id;
}
export async function rpc(ctx:Context,name:string,args:Record<string,unknown>={}) {
  const {data,error}=await ctx.db.rpc(name,args); databaseError(error); return data;
}
export async function rateLimit(ctx:Context,action='request') {
  if(!await rpc(ctx,'duet_rate_limit',{p_action:action,p_limit:60,p_seconds:60})) throw new AppError(429,'rate_limited','Too many requests. Please try again later.');
}
