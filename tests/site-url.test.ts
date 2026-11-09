import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalSiteUrl} from '../src/lib/site-url';
import {assertOrigin} from '../src/lib/server/http';

test('Netlify previews use their trusted canonical URL for origins and invitations',()=>{
  const preview='https://deploy-preview-3--duet.netlify.app';
  const url=canonicalSiteUrl({NETLIFY:'true',CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:preview,APP_URL:'https://duet.netlify.app'});
  assert.equal(url,preview);assert.doesNotThrow(()=>assertOrigin(new Request(`${preview}/api/auth/sign-in`,{method:'POST',headers:{origin:preview}}),url));
  assert.equal(canonicalSiteUrl({APP_URL:'http://localhost:3000',DEPLOY_PRIME_URL:preview}),'http://localhost:3000');
  assert.throws(()=>canonicalSiteUrl({NETLIFY:'true',CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:'https://evil.example',APP_URL:'https://duet.netlify.app'}));
  assert.equal(canonicalSiteUrl({NETLIFY:'true',CONTEXT:'production',APP_URL:'https://duet.netlify.app',DEPLOY_PRIME_URL:preview}),'https://duet.netlify.app');
});

test('a captured build origin survives when Netlify metadata is absent from the function runtime',()=>{
  const preview='https://deploy-preview-4--duet.netlify.app';
  const builtOrigin=canonicalSiteUrl({NETLIFY:'true',CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:preview,APP_URL:'https://duet.netlify.app'});
  const runtimeOrigin=canonicalSiteUrl({APP_URL:'https://duet.netlify.app'},builtOrigin);
  assert.equal(runtimeOrigin,preview);
  assert.doesNotThrow(()=>assertOrigin(new Request(`${preview}/api/auth/sign-in`,{method:'POST',headers:{origin:preview}}),runtimeOrigin));
  assert.throws(()=>assertOrigin(new Request(`${preview}/api/auth/sign-in`,{method:'POST',headers:{origin:'https://unrelated.netlify.app'}}),runtimeOrigin),/invalid_origin/);
});

test('Vercel previews use the exact trusted deployment origin instead of an old production APP_URL',()=>{
  const origin=canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'duet-test-abc.vercel.app',APP_URL:'https://old-duet.netlify.app'});
  assert.equal(origin,'https://duet-test-abc.vercel.app');
  assert.doesNotThrow(()=>assertOrigin(new Request(`${origin}/api/auth/sign-in`,{method:'POST',headers:{origin}}),origin));
  for(const unrelated of ['https://old-duet.netlify.app','https://another-duet.vercel.app']) {
    assert.throws(()=>assertOrigin(new Request(`${origin}/api/auth/sign-in`,{method:'POST',headers:{origin:unrelated}}),origin),/invalid_origin/);
  }
  const captured=canonicalSiteUrl({APP_URL:'https://old-duet.netlify.app'},origin);
  assert.equal(captured,'https://duet-test-abc.vercel.app');
});

test('Vercel deployment hostnames reject malformed and missing metadata without falling back to a different site',()=>{
  const invalid=[undefined,'','https://duet.vercel.app','duet.vercel.app/','duet.vercel.app:443','user@duet.vercel.app',
    'duet.vercel.app?x=1','duet.vercel.app#x','Duet.vercel.app','duet.vercel.app.evil.example','sub.duet.vercel.app',
    '-duet.vercel.app','duet-.vercel.app','duet%2evercel.app','duet.vercel.app\n','a'.repeat(64)+'.vercel.app'];
  for(const hostname of invalid) {
    assert.throws(()=>canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:hostname,APP_URL:'https://old-duet.netlify.app'}),Error,String(hostname));
  }
  assert.equal(canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'a.vercel.app'}),'https://a.vercel.app');
  assert.throws(()=>canonicalSiteUrl({VERCEL:'1',APP_URL:'https://old-duet.netlify.app'}));
});

test('Vercel production resolves only a secure configured root or validated project hostname',()=>{
  assert.equal(canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'production',APP_URL:'https://duet-test.vercel.app/',VERCEL_URL:'duet-hash.vercel.app'}),'https://duet-test.vercel.app');
  assert.equal(canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'duet-test.vercel.app',VERCEL_URL:'duet-hash.vercel.app'}),'https://duet-test.vercel.app');
  for(const configured of ['http://localhost:3000','https://user:pass@duet-test.vercel.app','https://duet-test.vercel.app/path','https://duet-test.vercel.app?x=1','https://duet-test.vercel.app#x']) {
    assert.throws(()=>canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'production',APP_URL:configured}));
  }
  assert.throws(()=>canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'evil.example'}));
  assert.equal(canonicalSiteUrl({VERCEL:'1',VERCEL_ENV:'development',APP_URL:'http://localhost:3000'}),'http://localhost:3000');
  assert.equal(canonicalSiteUrl({VERCEL_URL:'duet-test.vercel.app',APP_URL:'http://localhost:3000'}),'http://localhost:3000');
});
