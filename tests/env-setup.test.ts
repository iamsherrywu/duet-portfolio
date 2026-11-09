import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';

test('local env setup preserves existing values, adds only missing configuration and never prints secrets',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'duet-env-'));
  try {
    const source=join(folder,'source.env');const target=join(folder,'.env.local');
    const original='SUPABASE_SERVICE_ROLE_KEY=source-secret\nAI_API_KEY=source-ai\n';
    await writeFile(source,original);await writeFile(target,'AI_API_KEY=keep-this-secret\nAPP_URL=http://localhost:3000\n');
    const output=execFileSync(process.execPath,[resolve('scripts/setup-local.mjs'),'--from',source,'--target',target],{encoding:'utf8'});
    const env=parseEnv(await readFile(target,'utf8'));
    assert.ok(env.CRON_SECRET);
    assert.equal(env.AI_API_KEY,'keep-this-secret');assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,'source-secret');assert.match(env.CRON_SECRET,/^[a-f0-9]{64}$/);
    assert.equal(await readFile(source,'utf8'),original);assert.equal((await stat(target)).mode&0o777,0o600);
    assert.doesNotMatch(output,/source-secret|source-ai|keep-this-secret/);assert.ok(!output.includes(env.CRON_SECRET));
    execFileSync(process.execPath,[resolve('scripts/setup-local.mjs'),'--from',source,'--target',target]);
    assert.equal(parseEnv(await readFile(target,'utf8')).CRON_SECRET,env.CRON_SECRET);
  }finally{await rm(folder,{recursive:true,force:true});}
});
