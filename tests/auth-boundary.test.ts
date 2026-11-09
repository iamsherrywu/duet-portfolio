import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/duet/[...path]/route';

test('an invalid bearer session never reaches an authenticated API operation',async()=>{
  const originalUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const server=createServer((request,response)=>{
    assert.equal(request.url,'/auth/v1/user');
    response.writeHead(401,{'content-type':'application/json'});
    response.end(JSON.stringify({code:'bad_jwt',message:'invalid JWT'}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address && typeof address!=='string');
  process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-publishable-key';
  try {
    const response=await GET(new NextRequest('http://localhost:3000/api/duet/messages',{headers:{Authorization:'Bearer invalid-token'}}),{params:Promise.resolve({path:['messages']})});
    assert.equal(response.status,401);
    assert.equal((await response.json()).error.code,'unauthenticated');
    const crossOrigin=await POST(new NextRequest('http://localhost:3000/api/duet/messages',{method:'POST',headers:{origin:'https://evil.example'}}),{params:Promise.resolve({path:['messages']})});
    assert.equal(crossOrigin.status,403);
  } finally {
    if(originalUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=originalUrl;
    if(originalKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=originalKey;
    server.close();await once(server,'close');
  }
});
