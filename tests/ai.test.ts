import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AIProvider, privacyInstruction, asksAboutPartner, parseSong } from '../src/lib/ai/provider';

test('privacy toggles require an explicit instruction and do not trigger on quoted questions', () => {
  assert.equal(privacyInstruction('这段保密，我很累'), true);
  assert.equal(privacyInstruction('结束保密，聊聊晚饭'), false);
  assert.equal(privacyInstruction('我不需要保密'), false);
  assert.equal(privacyInstruction('今天聊什么？'), null);
  assert.equal(privacyInstruction('你支持保密吗？'), null);
  assert.equal(asksAboutPartner('对方和你聊了些什么'), true);
  assert.equal(asksAboutPartner('我今天有点累'), false);
});

test('song recognition accepts validated fields and rejects invented or malformed metadata', () => {
  assert.equal(parseSong('{"title":"歌","artist":"人","album":"","version":"","cover":null}').title, '歌');
  assert.equal(parseSong('{"title":"gameboy","artist":"ROSÉ","album":"rosie","version":null,"cover":null}').version, '');
  assert.throws(() => parseSong('{"title":"","artist":"人"}'));
  assert.throws(() => parseSong('not json'));
});

test('song recognition keeps title and artist when the cover rectangle is invalid', () => {
  assert.deepEqual(parseSong('{"title":"Song Name","artist":"Artist Name","album":"Album","version":"","cover":{"x":0.9,"y":0.2,"width":0.2,"height":0.4}}'), {
    title:'Song Name',artist:'Artist Name',album:'Album',version:'',cover:null,
  });
});

test('song recognition normalizes horizontal and vertical cover bounds against their own image dimensions', async () => {
  let systemPrompt = '';
  const server = createServer((req,res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body) as {messages:Array<{role:string;content:string}>};
      systemPrompt = payload.messages[0].content;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:'{"title":"gameboy","artist":"ROSÉ","album":"rosie","version":"","cover":{"x":0.25,"y":0.055,"width":0.565,"height":0.449}}'}}]}));
    });
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); assert.ok(address && typeof address!=='string');
  try {
    const provider=new AIProvider({baseUrl:`http://127.0.0.1:${address.port}`,key:'test',model:'test',visionModel:'vision-test'});
    const result=await provider.recognizeSong('data:image/png;base64,aGVsbG8=');
    assert.deepEqual(result.cover,{x:0.25,y:0.055,width:0.565,height:0.449});
    assert.match(systemPrompt,/x=左边像素\/截图像素宽/);
    assert.match(systemPrompt,/y=上边像素\/截图像素高/);
    assert.match(systemPrompt,/绝不能.*width 和 height 数值相等/);
    assert.match(systemPrompt,/只抄录/);
    assert.match(systemPrompt,/保留可见片段/);
    assert.match(systemPrompt,/不要在字段值里添加“AI 建议”/);
  } finally { server.close(); await once(server,'close'); }
});

test('model API errors never echo API keys or provider response bodies', async () => {
  const server = createServer((_,res) => { res.writeHead(429); res.end('private upstream diagnostics'); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); assert.ok(address && typeof address!=='string');
  try {
    const provider=new AIProvider({baseUrl:`http://127.0.0.1:${address.port}`,key:'secret-test-key',model:'test'});
    await assert.rejects(provider.complete([{role:'user',content:'hi'}]), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('secret-test-key') && !error.message.includes('diagnostics'));
      return true;
    });
  } finally { server.close(); await once(server,'close'); }
});
test('model retries a connection-establishment timeout once but not upstream HTTP errors',async()=>{
 let attempts=0;
 const transport:typeof fetch=async()=>{attempts++;if(attempts===1)throw new TypeError('fetch failed',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});return Response.json({choices:[{message:{content:'Recovered reply'}}]});};
 const provider=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'test'},transport);
 assert.equal(await provider.complete([{role:'user',content:'Synthetic'}]),'Recovered reply');assert.equal(attempts,2);
 let rejected=0;const throttled=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'test'},async()=>{rejected++;return new Response('private diagnostics',{status:429});});
 await assert.rejects(()=>throttled.complete([{role:'user',content:'Synthetic'}]));assert.equal(rejected,1);
});
test('Cloudflare Qwen requests bounded reasoning, without sending model-specific options to other providers',async()=>{
 const provider=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'@cf/qwen/qwen3.8-27b'},async(_url,init)=>{
   const payload=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:payload.reasoning_effort==='low'?'Timely structured answer':''}}]});
 });
 assert.equal(await provider.complete([{role:'user',content:'Return synthetic structured data'}]),'Timely structured answer');
 const generic=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'generic-model'},async(_url,init)=>{const payload=JSON.parse(String(init?.body));return 'reasoning_effort' in payload?new Response('unsupported',{status:400}):Response.json({choices:[{message:{content:'Generic reply'}}]});});
 assert.equal(await generic.complete([{role:'user',content:'Synthetic'}]),'Generic reply');
});
test('recognition reads visible text first and completion preserves the recording artist; model calls do not retry',async()=>{
 let calls=0;const prompts:string[]=[];
 const provider=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'test'},async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));prompts.push(body.messages[0].content);assert.equal(body.max_tokens,700);assert.equal(body.messages[1].content.filter((part:{type:string})=>part.type==='image_url').length,calls===1?1:2);return Response.json({choices:[{message:{content:'{"title":"Song","artist":"Artist","album":"","version":"","cover":null}'}}]});});
 await provider.recognizeSong('data:image/jpeg;base64,eA==');
 await provider.recognizeSong('data:image/jpeg;base64,eA==',{mode:'complete',referenceImage:'data:image/jpeg;base64,eA==',known:{title:'Song',artist:'',album:'',version:''}});
 assert.match(prompts[0],/只抄录/);assert.match(prompts[1],/不要用原唱替代/);assert.equal(calls,2);
 let retries=0;const failed=new AIProvider({baseUrl:'https://models.example',key:'synthetic',model:'test'},async()=>{retries++;throw new TypeError('connect',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});});
 await assert.rejects(failed.recognizeSong('data:image/jpeg;base64,eA=='));assert.equal(retries,1);
});
