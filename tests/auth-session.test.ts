import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionClient, type CookieStore } from '../src/lib/supabase/server';

class MemoryCookies implements CookieStore {
  private values = new Map<string, string>();
  getAll() { return [...this.values].map(([name, value]) => ({ name, value })); }
  setAll(cookies: Array<{ name: string; value: string; options?: { maxAge?: number } }>) {
    for (const cookie of cookies) {
      if (cookie.value === '' || cookie.options?.maxAge === 0 || cookie.options?.maxAge === -1) this.values.delete(cookie.name);
      else this.values.set(cookie.name, cookie.value);
    }
  }
}

test('SSR password sign-in writes a session cookie and local sign-out clears it', async () => {
  const cookies = new MemoryCookies();
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/auth/v1/token?grant_type=password')) {
      return Response.json({
        access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'bearer', expires_in: 3600,
        user: { id: 'user-id', aud: 'authenticated', role: 'authenticated', email: 'user@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' },
      });
    }
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    throw new Error(`unexpected auth request: ${url}`);
  };
  const client = createSessionClient('http://supabase.test', 'publishable-test-key', cookies, fetchImpl);
  const result = await client.auth.signInWithPassword({ email: 'user@example.com', password: 'password-123' });
  assert.equal(result.error, null);
  assert.ok(cookies.getAll().some(({ name }) => name.includes('auth-token')));
  await client.auth.signOut({ scope: 'local' });
  assert.deepEqual(cookies.getAll(), []);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/auth\/v1\/logout\?scope=local$/);
});
