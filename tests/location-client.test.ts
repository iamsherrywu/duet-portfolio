import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appleMapsUrl,
  canStopLocationShare,
  locationShareFromCoordinates,
  removeLocationShare,
  formatRemainingTime,
  isExpired,
  isValidLocation,
  parseLocationSharesResponse,
  parseLocationStartResponse,
  removeLocationShareSession,
  shouldApplyLocationList,
  upsertLocationShare,
  visibleLocationShares,
} from '../src/lib/location';

test('location client validates coordinate and accuracy ranges', () => {
  assert.equal(isValidLocation(0, 0, 0), true);
  assert.equal(isValidLocation(90, -180, 100000), true);
  assert.equal(isValidLocation(90.01, 0, 1), false);
  assert.equal(isValidLocation(0, 180.01, 1), false);
  assert.equal(isValidLocation(0, 0, -1), false);
  assert.equal(isValidLocation(Number.NaN, 0, 1), false);
});

test('location client builds an Apple Maps link from numeric coordinates', () => {
  assert.equal(appleMapsUrl(37.7, -122.4), 'https://maps.apple.com/?ll=37.7,-122.4');
});

test('location client formats remaining session time without negative values', () => {
  assert.equal(formatRemainingTime(3600000), '1:00:00');
  assert.equal(formatRemainingTime(59999), '1:00');
  assert.equal(formatRemainingTime(0), '0:00');
  assert.equal(formatRemainingTime(-500), '0:00');
});

test('location client treats invalid and elapsed expiry times as expired', () => {
  assert.equal(isExpired('2026-10-21T11:59:59.000Z', Date.parse('2026-10-21T12:00:00.000Z')), true);
  assert.equal(isExpired('2026-10-21T12:00:01.000Z', Date.parse('2026-10-21T12:00:00.000Z')), false);
  assert.equal(isExpired('not-a-date', Date.now()), true);
});

test('location client parses API shares and rejects invalid server location data', () => {
  const valid = {
    data: [{
      user_id: '10000000-0000-4000-8000-000000000001',
      latitude: 37.7,
      longitude: -122.4,
      accuracy_m: 8,
      expires_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T11:00:00.000Z',
    }],
  };
  assert.equal(parseLocationSharesResponse(valid)[0]?.latitude, 37.7);
  assert.throws(() => parseLocationSharesResponse({ data: [{ ...valid.data[0], latitude: 91 }] }));
  assert.throws(() => parseLocationSharesResponse({ data: [{ ...valid.data[0], expires_at: 'bad' }] }));
  assert.throws(() => parseLocationSharesResponse({ nope: [] }));
});

test('location client parses only a valid server-issued expiry', () => {
  assert.equal(parseLocationStartResponse({ data: { expires_at: '2026-10-21T12:00:00.000Z' } }).expires_at,
    '2026-10-21T12:00:00.000Z');
  assert.throws(() => parseLocationStartResponse({ data: { expires_at: 'bad' } }));
  assert.throws(() => parseLocationStartResponse({ data: { expires_at: '2026-10-21T12:00:00.000Z', user_id: 'forged' } }));
});

test('location client hides every expired share even if a refresh is unavailable', () => {
  const shares = parseLocationSharesResponse({
    data: [
      {
        user_id: 'self', latitude: 37.7, longitude: -122.4, accuracy_m: 8,
        expires_at: '2026-10-21T12:00:00.000Z', updated_at: '2026-10-21T11:59:00.000Z',
      },
      {
        user_id: 'partner', latitude: 40.7, longitude: -73.9, accuracy_m: 12,
        expires_at: '2026-10-21T12:01:00.000Z', updated_at: '2026-10-21T11:59:30.000Z',
      },
    ],
  });
  assert.deepEqual(visibleLocationShares(shares, Date.parse('2026-10-21T12:00:00.000Z')).map(share => share.user_id), ['partner']);
});

test('location client keeps a confirmed start manageable if the follow-up list refresh fails', () => {
  const initial = parseLocationSharesResponse({ data: [] });
  const optimisticShare = locationShareFromCoordinates(
    'self', { latitude: 37.7, longitude: -122.4, accuracy: 8 },
    '2026-10-21T13:00:00.000Z', '2026-10-21T12:00:00.000Z',
  );
  const active = upsertLocationShare(initial, optimisticShare);

  assert.equal(active.find(share => share.user_id === 'self')?.expires_at, '2026-10-21T13:00:00.000Z');
  assert.deepEqual(removeLocationShare(active, 'self'), []);
});

test('location client removes a confirmed stop locally without a successful refresh', () => {
  const shares = parseLocationSharesResponse({
    data: [
      {
        user_id: 'self', latitude: 37.7, longitude: -122.4, accuracy_m: 8,
        expires_at: '2026-10-21T13:00:00.000Z', updated_at: '2026-10-21T12:00:00.000Z',
      },
      {
        user_id: 'partner', latitude: 40.7, longitude: -73.9, accuracy_m: 12,
        expires_at: '2026-10-21T13:00:00.000Z', updated_at: '2026-10-21T12:00:00.000Z',
      },
    ],
  });
  assert.deepEqual(removeLocationShare(shares, 'self').map(share => share.user_id), ['partner']);
});

test('location client keeps a safe stop control for unknown starts and rejects stale list responses', () => {
  const active = locationShareFromCoordinates(
    'self', { latitude: 37.7, longitude: -122.4, accuracy: 8 },
    '2026-10-21T13:00:00.000Z', '2026-10-21T12:00:00.000Z',
  );
  assert.equal(canStopLocationShare(undefined, true, Date.parse('2026-10-21T12:00:00.000Z')), true);
  assert.equal(canStopLocationShare(undefined, false, Date.parse('2026-10-21T12:00:00.000Z')), false);
  assert.equal(canStopLocationShare(active, false, Date.parse('2026-10-21T12:00:00.000Z')), true);
  assert.equal(canStopLocationShare(active, false, Date.parse('2026-10-21T13:00:00.000Z')), false);

  assert.equal(shouldApplyLocationList(2, 2, 4, 4), true);
  assert.equal(shouldApplyLocationList(1, 2, 4, 4), false);
  assert.equal(shouldApplyLocationList(2, 2, 3, 4), false);
});

test('location client stop cleanup preserves a newer session from another tab', () => {
  const stopped = locationShareFromCoordinates(
    'self', { latitude: 37.7, longitude: -122.4, accuracy: 8 },
    '2026-10-21T13:00:00.000Z', '2026-10-21T12:00:00.000Z',
  );
  const restarted = locationShareFromCoordinates(
    'self', { latitude: 40.7, longitude: -73.9, accuracy: 12 },
    '2026-10-21T14:00:00.000Z', '2026-10-21T13:00:00.000Z',
  );
  assert.deepEqual(
    removeLocationShareSession([stopped, restarted], 'self', stopped.expires_at),
    [restarted],
  );
});
