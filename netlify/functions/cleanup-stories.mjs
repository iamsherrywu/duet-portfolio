/**
 * @param {(name:string)=>string|undefined} getEnv
 * @param {typeof fetch} [fetcher]
 */
export function createScheduledCleanup(getEnv,fetcher=fetch) {
  return async()=>{
    const secret=getEnv('CRON_SECRET');
    const app=new URL(getEnv('APP_URL')||'invalid');
    if(!secret||app.protocol!=='https:'||app.username||app.password||app.pathname!=='/'||app.search||app.hash) {
      throw new Error('Story cleanup configuration is incomplete');
    }
    const response=await fetcher(new URL('/api/cron/location-snaps',app).href,{
      method:'POST',headers:{'x-cron-secret':secret},redirect:'error',signal:AbortSignal.timeout(25000),
    });
    if(!response.ok)throw new Error(`Story cleanup failed (${response.status})`);
  };
}

// Netlify supplies this runtime global; no server secrets are bundled in source.
export default async()=>createScheduledCleanup(name=>globalThis.Netlify.env.get(name))();
// Every hour at :15 UTC (also :15 in Asia/Shanghai). Published deploys only.
export const config={schedule:'15 * * * *'};
