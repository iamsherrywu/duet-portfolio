import {readFile,writeFile,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';

const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const target=resolve(option('--target')||'.env.local');const sourceArg=option('--from');const source=sourceArg?resolve(sourceArg):null;
try {
  const sourceText=source?await readFile(source,'utf8'):'';
  let text=existsSync(target)?await readFile(target,'utf8'):sourceText||await readFile(new URL('../.env.example',import.meta.url),'utf8');
  const existing=parseEnv(text);const inherited=parseEnv(sourceText);const imported=[];
  for(const [name,value] of Object.entries(inherited)) {
    if(!existing[name]&&value) {
      if(/[\r\n]/.test(value))throw new Error(`不支持自动导入多行配置：${name}`);
      text+=`\n${name}=${JSON.stringify(value)}\n`;existing[name]=value;imported.push(name);
    }
  }
  let cronCreated=false;
  if(!existing.CRON_SECRET) {
    text+=`\nCRON_SECRET=${randomBytes(32).toString('hex')}\n`;cronCreated=true;
  }
  await writeFile(target,text,{mode:0o600});await chmod(target,0o600);
  const configured=parseEnv(text);const required=['APP_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','AI_BASE_URL','AI_API_KEY','AI_MODEL','AI_VISION_MODEL','CRON_SECRET'];
  console.log(JSON.stringify({configured:true,importedKeys:imported,cronCreated,missingKeys:required.filter(name=>!configured[name])},null,2));
}catch(error) {
  console.error(error?.code==='ENOENT'?'找不到指定的配置文件。':'配置未完成，请检查文件路径和权限。');process.exitCode=1;
}
