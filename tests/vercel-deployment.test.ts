import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

test('Vercel local state and every local environment file are excluded from Git',()=>{
  const files=['.vercel/project.json','.vercel/output/functions/index.func/.vc-config.json','.env.local','.env.vercel-test.local'];
  const ignored=execFileSync('git',['check-ignore','--no-index','--stdin'],{cwd:process.cwd(),input:files.join('\n')+'\n',encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(ignored,files);
});
