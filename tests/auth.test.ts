import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../src/lib/server/http';
import {
  createAuthDeps,
  registerWithInvite,
  signInWithPassword,
  signInSchema,
  registerInviteSchema,
  type AuthDeps,
} from '../src/lib/server/auth';
import { createAuthPost, POST } from '../src/app/api/auth/[action]/route';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const registrationProfile = { displayName: '新用户', gender: 'female' as const, birthday: '1995-08-10' };

function harness(overrides: Partial<AuthDeps> = {}) {
  const calls = {
    rates: [] as string[],
    eligibility: [] as string[],
    created: [] as Array<{ email: string; password: string }>,
    initializedProfiles: [] as Array<{ displayName: string; gender: string; birthday: string; clownRole?: string }>,
    logins: [] as Array<{ email: string; password: string }>,
    accepted: [] as string[],
    signedOut: 0,
  };
  const deps: AuthDeps = {
    rateLimit: async (key) => { calls.rates.push(key); return true; },
    inviteAllowed: async (tokenHash) => { calls.eligibility.push(tokenHash); return true; },
    createConfirmedUser: async (email, password) => {
      calls.created.push({ email, password });
      return { id: 'user-1', email };
    },
    initializeProfile: async (profile) => { calls.initializedProfiles.push(profile); },
    signIn: async (email, password) => {
      calls.logins.push({ email, password });
      return { id: 'user-1', email };
    },
    acceptInvitation: async (token) => { calls.accepted.push(token); return 'couple-1'; },
    signOut: async () => { calls.signedOut += 1; },
    ...overrides,
  };
  return { deps, calls };
}

test('password sign-in normalizes email, rate-limits by a hash, and returns a generic credential error', async () => {
  const { deps, calls } = harness();
  const signedIn = await signInWithPassword(deps, { email: '  USER@Example.COM ', password: 'correct-password' });
  assert.deepEqual(signedIn, { id: 'user-1', email: 'user@example.com' });
  assert.deepEqual(calls.rates, [hash('email:user@example.com')]);
  assert.deepEqual(calls.logins, [{ email: 'user@example.com', password: 'correct-password' }]);

  const badCredentials = harness({ signIn: async () => { throw new Error('provider internal details'); } });
  await assert.rejects(signInWithPassword(badCredentials.deps, { email: 'user@example.com', password: 'wrong' }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 401);
    assert.equal(error.publicMessage, 'Incorrect email or password.');
    assert.doesNotMatch(error.message, /provider internal details/);
    return true;
  });
});

test('sign-in stops at the rate limit without checking the password', async () => {
  let loginCalled = false;
  const { deps } = harness({ rateLimit: async () => false, signIn: async () => { loginCalled = true; throw new Error('should not run'); } });
  await assert.rejects(signInWithPassword(deps, { email: 'user@example.com', password: 'password-123' }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(loginCalled, false);
});

test('invalid invitations are rejected before an Auth account is created', async () => {
  const eligibility: string[] = [];
  const { deps, calls } = harness({ inviteAllowed: async (tokenHash) => { eligibility.push(tokenHash); return false; } });
  await assert.rejects(registerWithInvite(deps, { email: 'NEW@Example.COM', password: 'password-123', inviteToken: 'a'.repeat(64), ...registrationProfile }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'invalid_invitation');
    return true;
  });
  assert.deepEqual(calls.rates, [hash('email:new@example.com'), hash(`invite:${'a'.repeat(64)}`)]);
  assert.deepEqual(eligibility, [hash('a'.repeat(64))]);
  assert.equal(calls.created.length, 0);
});

test('registration profile is initialized after sign-in and before invite acceptance', async () => {
  const token = 'b'.repeat(64);
  const { deps, calls } = harness();
  const result = await registerWithInvite(deps, { email: 'NEW@Example.COM', password: 'password-123', inviteToken: token, ...registrationProfile });
  assert.deepEqual(result, { id: 'user-1', email: 'new@example.com', coupleId: 'couple-1' });
  assert.deepEqual(calls.rates, [hash('email:new@example.com'), hash(`invite:${token}`)]);
  assert.deepEqual(calls.eligibility, [hash(token)]);
  assert.deepEqual(calls.created, [{ email: 'new@example.com', password: 'password-123' }]);
  assert.deepEqual(calls.initializedProfiles, [registrationProfile]);
  assert.deepEqual(calls.logins, [{ email: 'new@example.com', password: 'password-123' }]);
  assert.deepEqual(calls.accepted, [token]);
});

test('registration profile failure clears the session before accepting the invitation', async () => {
  const { deps, calls } = harness({ initializeProfile: async () => { throw new Error('database detail'); } });
  await assert.rejects(registerWithInvite(deps, { email: 'new@example.com', password: 'password-123', inviteToken: '9'.repeat(64), ...registrationProfile }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'registration_unavailable');
    assert.doesNotMatch(error.message, /database detail/);
    return true;
  });
  assert.equal(calls.signedOut, 1);
  assert.deepEqual(calls.accepted, []);
});

test('concurrent uses of one invitation can pair at most one newly registered account', async () => {
  let consumed = false;
  let nextId = 0;
  const emailById = new Map<string, string>();
  const { deps, calls } = harness({
    createConfirmedUser: async (email) => {
      const id = `user-${++nextId}`;
      emailById.set(id, email);
      return { id, email };
    },
    signIn: async (email) => ({ id: [...emailById].find(([, value]) => value === email)![0], email }),
    acceptInvitation: async (token) => {
      if (consumed) throw new AppError(410, 'invalid_invitation', '邀请链接已过期、已使用或不可加入');
      consumed = true;
      calls.accepted.push(token);
      return 'couple-1';
    },
  });
  const results = await Promise.allSettled([
    registerWithInvite(deps, { email: 'one@example.com', password: 'password-123', inviteToken: 'c'.repeat(64), ...registrationProfile }),
    registerWithInvite(deps, { email: 'two@example.com', password: 'password-123', inviteToken: 'c'.repeat(64), ...registrationProfile }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(calls.accepted.length, 1);
  assert.equal(calls.signedOut, 1);
});

test('duplicate-email registration errors do not expose Supabase details', async () => {
  const { deps } = harness({ createConfirmedUser: async () => { throw new Error('User already registered; internal code=422'); } });
  await assert.rejects(registerWithInvite(deps, { email: 'used@example.com', password: 'password-123', inviteToken: 'd'.repeat(64), ...registrationProfile }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 409);
    assert.equal(error.publicMessage, 'Unable to register. Check your email or sign in with your existing account.');
    assert.doesNotMatch(error.message, /already registered|422/);
    return true;
  });
});

test('failed invitation acceptance clears the session and never returns couple access', async () => {
  const { deps, calls } = harness({ acceptInvitation: async () => { throw new AppError(410, 'invalid_invitation', '邀请链接已过期、已使用或不可加入'); } });
  await assert.rejects(registerWithInvite(deps, { email: 'new@example.com', password: 'password-123', inviteToken: 'e'.repeat(64), ...registrationProfile }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'invalid_invitation');
    return true;
  });
  assert.equal(calls.signedOut, 1);
});

test('auth request schemas enforce normalized email, 64-hex invitations and 8–128 character passwords', () => {
  assert.equal(signInSchema.parse({ email: ' USER@Example.COM ', password: '12345678' }).email, 'user@example.com');
  assert.equal(signInSchema.safeParse({ email: 'user@example.com', password: '1234567' }).success, false);
  assert.equal(signInSchema.safeParse({ email: 'user@example.com', password: 'x'.repeat(129) }).success, false);
  assert.equal(signInSchema.safeParse({ email: 'not-an-email', password: '12345678' }).success, false);
  assert.equal(signInSchema.safeParse({ email: 'user@example.com', password: 'x'.repeat(128) }).success, true);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile }).success, true);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64) }).success, false);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile, birthday: 'not-a-date' }).success, false);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile, birthday: '1995-02-30' }).success, false);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile, birthday: '2995-08-10' }).success, false);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile, gender: 'other' }).success, false);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'f'.repeat(64), ...registrationProfile, gender: 'other', clownRole: 'clown_girl' }).success, true);
  assert.equal(registerInviteSchema.safeParse({ email: 'user@example.com', password: '12345678', inviteToken: 'bad-token' }).success, false);
});

test('legacy OTP auth actions return 404 and malformed auth API inputs return 400', async () => {
  const request = (action: string, body: unknown) => new NextRequest(`http://localhost:3000/api/auth/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const oldRequestCode = await POST(request('request-code', { email: 'user@example.com' }), { params: Promise.resolve({ action: 'request-code' }) });
  const oldVerifyCode = await POST(request('verify-code', { email: 'user@example.com', token: '123456' }), { params: Promise.resolve({ action: 'verify-code' }) });
  assert.equal(oldRequestCode.status, 404);
  assert.equal(oldVerifyCode.status, 404);
  const badEmail = await POST(request('sign-in', { email: 'bad', password: '12345678' }), { params: Promise.resolve({ action: 'sign-in' }) });
  const shortPassword = await POST(request('sign-in', { email: 'user@example.com', password: '1234567' }), { params: Promise.resolve({ action: 'sign-in' }) });
  const badToken = await POST(request('register-invite', { email: 'user@example.com', password: '12345678', inviteToken: 'not-a-token' }), { params: Promise.resolve({ action: 'register-invite' }) });
  assert.equal(badEmail.status, 400);
  assert.equal(shortPassword.status, 400);
  assert.equal(badToken.status, 400);
});

test('invite registration ignores an incoming bearer token and pairs the newly signed-in account', async () => {
  const calls: Array<unknown[]> = [];
  const admin = {
    rpc: async (name: string, args: unknown) => { calls.push(['admin-rpc', name, args]); return { data: true, error: null }; },
    auth: { admin: { createUser: async (input: unknown) => {
      calls.push(['create-user', input]);
      return { data: { user: { id: 'new-user', email: 'new@example.com' } }, error: null };
    } } },
  } as unknown as SupabaseClient;
  const cookieDb = {
    auth: {
      signInWithPassword: async (input: unknown) => {
        calls.push(['cookie-sign-in', input]);
        return { data: { user: { id: 'new-user', email: 'new@example.com' } }, error: null };
      },
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string, args: unknown) => {
      calls.push(['cookie-rpc', name, args]);
      return { data: 'couple-id', error: null };
    },
  } as unknown as SupabaseClient;
  const handler = createAuthPost({
    adminClient: () => admin,
    cookieUserClient: async (...args: unknown[]) => {
      assert.equal(args.length, 0, 'auth endpoints must not choose a client from the incoming Authorization header');
      return cookieDb;
    },
    siteUrl: () => 'http://localhost:3000',
  });
  const request = new NextRequest('http://localhost:3000/api/auth/register-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer old-user-token' },
    body: JSON.stringify({ email: 'new@example.com', password: 'password-123', inviteToken: 'f'.repeat(64), ...registrationProfile }),
  });
  const response = await handler(request, { params: Promise.resolve({ action: 'register-invite' }) });
  assert.equal(response.status, 201);
  const responseBody = await response.json();
  assert.deepEqual(responseBody.data, { user: { id: 'new-user', email: 'new@example.com' }, coupleId: 'couple-id' });
  assert.ok(calls.some((call) => call[0] === 'cookie-rpc' && call[1] === 'duet_accept_invitation'));
  const initialized = calls.find((call) => call[0] === 'cookie-rpc' && call[1] === 'duet_initialize_profile');
  assert.ok(initialized);
  assert.deepEqual(initialized[2], { p_display_name: '新用户', p_gender: 'female', p_birthday: '1995-08-10', p_clown_role: null });
  assert.equal(JSON.stringify(responseBody.data).includes('1995-08-10'), false);
});

test('Supabase adapter creates an explicitly email-confirmed user and wires backend-only checks', async () => {
  const calls: Array<unknown[]> = [];
  const admin = {
    rpc: async (...args: unknown[]) => { calls.push(['admin-rpc', ...args]); return { data: true, error: null }; },
    auth: { admin: { createUser: async (input: unknown) => {
      calls.push(['create-user', input]);
      return { data: { user: { id: 'new-id', email: 'new@example.com' } }, error: null };
    } } },
  } as unknown as SupabaseClient;
  const db = {
    auth: {
      signInWithPassword: async (input: unknown) => { calls.push(['sign-in', input]); return { data: { user: { id: 'new-id', email: 'new@example.com' } }, error: null }; },
      signOut: async (input: unknown) => { calls.push(['sign-out', input]); return { error: null }; },
    },
    rpc: async (...args: unknown[]) => { calls.push(['user-rpc', ...args]); return { data: 'couple-id', error: null }; },
  } as unknown as SupabaseClient;
  const deps = createAuthDeps(admin, db);
  assert.equal(await deps.rateLimit(hash('email:new@example.com')), true);
  assert.equal(await deps.inviteAllowed(hash('a'.repeat(64))), true);
  await deps.initializeProfile(registrationProfile);
  assert.deepEqual(await deps.createConfirmedUser('new@example.com', 'password-123'), { id: 'new-id', email: 'new@example.com' });
  assert.deepEqual(await deps.signIn('new@example.com', 'password-123'), { id: 'new-id', email: 'new@example.com' });
  assert.equal(await deps.acceptInvitation('a'.repeat(64)), 'couple-id');
  await deps.signOut();
  assert.deepEqual(calls.find((call) => call[0] === 'create-user'), ['create-user', { email: 'new@example.com', password: 'password-123', email_confirm: true }]);
  assert.ok(calls.some((call) => call[0] === 'admin-rpc' && call[1] === 'duet_invite_registration_allowed'));
  assert.ok(calls.some((call) => call[0] === 'user-rpc' && call[1] === 'duet_accept_invitation'));
  assert.ok(calls.some((call) => call[0] === 'user-rpc' && call[1] === 'duet_initialize_profile' && JSON.stringify(call[2]).includes('1995-08-10')));
});
