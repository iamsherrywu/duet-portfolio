import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createScheduledCleanup,config} from '../netlify/functions/cleanup-stories.mjs';

test('scheduled cleanup sends its secret only to the HTTPS application origin',async()=>{
  const calls:{url:string;options:RequestInit}[]=[];
  const run=createScheduledCleanup(name=>({APP_URL:'https://duet.example',CRON_SECRET:'private-value'}[name]),async(url,options)=>{
    calls.push({url:String(url),options:options??{}});return Response.json({data:{deleted:0}});
  });
  await run();
  assert.equal(config.schedule,'15 * * * *');
  assert.equal(calls[0].url,'https://duet.example/api/cron/location-snaps');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(new Headers(calls[0].options.headers).get('x-cron-secret'),'private-value');
  assert.equal(calls[0].options.redirect,'error');
});

test('scheduled cleanup fails closed for missing secrets, insecure URLs or failed tasks',async()=>{
  for(const env of [{APP_URL:'http://duet.example',CRON_SECRET:'secret'},{APP_URL:'https://user:secret@duet.example',CRON_SECRET:'secret'},{APP_URL:'https://duet.example',CRON_SECRET:''}]) {
    let calls=0;await assert.rejects(createScheduledCleanup(name=>env[name as keyof typeof env],async()=>{calls++;return new Response();}));assert.equal(calls,0);
  }
  const run=createScheduledCleanup(name=>({APP_URL:'https://duet.example',CRON_SECRET:'secret'}[name]),async()=>new Response('provider-secret',{status:503}));
  await assert.rejects(run,/cleanup failed \(503\)/);
});
