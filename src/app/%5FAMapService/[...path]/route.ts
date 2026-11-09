import {requireUser,requireCouple} from '../../../lib/supabase/server';
import {failure,AppError} from '../../../lib/server/http';
export const dynamic='force-dynamic';
const allowed=new Set(['v3/geocode/regeo','v3/assistant/coordinate/convert','v4/map/styles']);
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){
 try{
  const ctx=await requireUser(request);await requireCouple(ctx);
  const path=(await params).path.join('/');if(!allowed.has(path))throw new AppError(404,'not_found','Map service not available.');
  if(!process.env.AMAP_JS_KEY||!process.env.AMAP_SECURITY_CODE)throw new AppError(503,'map_unavailable','Map is not configured yet.');
  const callback=new URL(request.url).searchParams.get('callback');
  if(callback&&!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback))throw new AppError(400,'invalid_callback','Invalid map request.');
  const url=new URL('/'+path,path==='v4/map/styles'?'https://webapi.amap.com':'https://restapi.amap.com');
  url.search=new URL(request.url).search;url.searchParams.set('key',process.env.AMAP_JS_KEY);url.searchParams.set('jscode',process.env.AMAP_SECURITY_CODE);
  const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{'Content-Type':callback?'application/javascript; charset=utf-8':response.headers.get('content-type')||'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){ console.error('AMap proxy failure', e instanceof Error ? {name:e.name, causeCode:(e.cause as {code?:string}|undefined)?.code} : {name:'Unknown'}); return failure(e);}
}
