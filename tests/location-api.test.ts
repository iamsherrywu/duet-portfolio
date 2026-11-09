import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../src/lib/server/core';
import { failure } from '../src/lib/server/http';
import type { Context } from '../src/lib/supabase/server';

type RpcCall = { name: string; args: Record<string, unknown> };
type RpcHandler = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

function context(handler: RpcHandler, calls: RpcCall[]): Context {
  const db = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      return handler(name, args);
    },
  };
  return { db, user: { id: '10000000-0000-4000-8000-000000000001' } } as unknown as Context;
}

async function dispatch(request: Request, path: string[], handler: RpcHandler, calls: RpcCall[]) {
  try {
    const response = await core(request, path, context(handler, calls));
    return response ?? new Response(null, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}

function jsonRequest(method: string, body?: unknown) {
  return new Request('https://duet.test/api/duet/location', {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

const success: RpcHandler = async name => ({
  data: name === 'duet_list_location_shares'
    ? [{ user_id: '10000000-0000-4000-8000-000000000002', latitude: 37.7, longitude: -122.4, accuracy_m: 8, expires_at: '2026-10-21T12:00:00.000Z', updated_at: '2026-10-21T11:00:00.000Z' }]
    : { expires_at: '2026-10-21T12:00:00.000Z' },
  error: null,
});

test('location API lists active shares with a no-store response', async () => {
  const calls: RpcCall[] = [];
  const response = await dispatch(jsonRequest('GET'), ['location'], success, calls);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [{ name: 'duet_list_location_shares', args: {} }]);
  assert.equal((await response.json() as { data: unknown[] }).data.length, 1);
});

test('location API starts a session using only validated client coordinates', async () => {
  const calls: RpcCall[] = [];
  const response = await dispatch(jsonRequest('POST', { latitude: 37.7, longitude: -122.4, accuracy: 8 }), ['location', 'start'], success, calls);
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [{
    name: 'duet_start_location_share',
    args: { p_latitude: 37.7, p_longitude: -122.4, p_accuracy_m: 8 },
  }]);
  assert.deepEqual(await response.json(), { data: { expires_at: '2026-10-21T12:00:00.000Z' } });
});

test('location API rejects extra fields and invalid coordinates without calling the database', async () => {
  const invalid = [
    { latitude: 37.7, longitude: -122.4, accuracy: 8, user_id: 'forged' },
    { latitude: 37.7, longitude: -122.4, accuracy: 8, couple_id: 'forged' },
    { latitude: 37.7, longitude: -122.4, accuracy: 8, expires_at: '2099-01-01T00:00:00Z' },
    { latitude: 90.1, longitude: 0, accuracy: 8 },
    { latitude: 0, longitude: 180.1, accuracy: 8 },
    { latitude: 0, longitude: 0, accuracy: -1 },
    { latitude: 0, longitude: 0, accuracy: 100001 },
    { latitude: 0, longitude: 0 },
  ];
  for (const body of invalid) {
    const calls: RpcCall[] = [];
    const response = await dispatch(jsonRequest('POST', body), ['location', 'start'], success, calls);
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  }
});

test('location API updates and stops only through owner-scoped RPCs', async () => {
  const calls: RpcCall[] = [];
  const updated = await dispatch(jsonRequest('PATCH', { latitude: 1, longitude: 2, accuracy: 3 }), ['location'], success, calls);
  const stopped = await dispatch(jsonRequest('DELETE'), ['location'], success, calls);
  assert.equal(updated.status, 200);
  assert.equal(stopped.status, 200);
  assert.deepEqual(calls, [
    { name: 'duet_update_location', args: { p_latitude: 1, p_longitude: 2, p_accuracy_m: 3 } },
    { name: 'duet_stop_location_share', args: {} },
  ]);
});

test('location API maps share state errors without exposing database details', async () => {
  for (const [dbError, status, code] of [
    ['location_expired', 410, 'location_expired'],
    ['location_not_active', 409, 'location_not_active'],
    ['location_rate_limited', 429, 'location_rate_limited'],
    ['already_sharing', 409, 'already_sharing'],
    ['not_paired', 409, 'not_paired'],
  ] as const) {
    const calls: RpcCall[] = [];
    const handler: RpcHandler = async () => ({ data: null, error: { message: dbError, code: 'P0001' } });
    const response = await dispatch(jsonRequest('GET'), ['location'], handler, calls);
    const payload = await response.json() as { error: { code: string; message: string } };
    assert.equal(response.status, status);
    assert.equal(payload.error.code, code);
    assert.ok(!payload.error.message.includes('P0001'));
  }
});

test('location API returns null for unsupported routes and methods', async () => {
  const calls: RpcCall[] = [];
  assert.equal(await core(jsonRequest('GET'), ['locations'], context(success, calls)), null);
  assert.equal(await core(jsonRequest('PUT'), ['location'], context(success, calls)), null);
  assert.deepEqual(calls, []);
});
