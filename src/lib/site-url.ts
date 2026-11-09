function vercelOrigin(hostname:string|undefined):string {
  if(!hostname||hostname!==hostname.trim()||!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/).test(hostname)) {
    throw new Error('Invalid deployment URL');
  }
  return `https://${hostname}`;
}

function secureRootOrigin(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:'||(value!==url.origin&&value!==`${url.origin}/`))throw new Error('Invalid deployment URL');
  return url.origin;
}

export function canonicalSiteUrl(env:Record<string,string|undefined>,buildOrigin?:string):string {
  if(buildOrigin)return buildOrigin;
  if(env.VERCEL==='1') {
    if(env.VERCEL_ENV==='preview')return vercelOrigin(env.VERCEL_URL);
    if(env.VERCEL_ENV==='production')return env.APP_URL?secureRootOrigin(env.APP_URL):vercelOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
    if(env.VERCEL_ENV!=='development')throw new Error('Invalid deployment environment');
  }
  if(env.NETLIFY==='true'&&['deploy-preview','branch-deploy'].includes(env.CONTEXT??'')) {
    const url=new URL(env.DEPLOY_PRIME_URL||'invalid');
    if(url.protocol!=='https:'||!url.hostname.endsWith('.netlify.app')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid deployment URL');
    return url.origin;
  }
  return env.APP_URL||'http://localhost:3000';
}
