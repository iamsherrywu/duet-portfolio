import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { database, users, asUser, admin, paired, scalar } from './helpers/database';

async function fixture() {
  const db = await database();
  const firstCouple = await paired(db, users.a, users.b);
  await paired(db, users.c, users.d);
  return { db, firstCouple };
}

async function start(db: PGlite, latitude: number, longitude: number, accuracy = 10) {
  return scalar<{ expires_at: string }>(db,
    'select public.duet_start_location_share($1::double precision,$2::double precision,$3::double precision) as value',
    [latitude, longitude, accuracy],
  );
}

async function update(db: PGlite, latitude: number, longitude: number, accuracy = 10) {
  return db.query(
    'select public.duet_update_location($1::double precision,$2::double precision,$3::double precision)',
    [latitude, longitude, accuracy],
  );
}

test('location sharing database starts one-hour sessions for each member', async () => {
  const { db, firstCouple } = await fixture();
  try {
    await asUser(db, users.a);
    const first = await start(db, 37.78, -122.41, 12);
    assert.ok(first.expires_at);
    const secondsLeft = await scalar<number>(db,
      "select extract(epoch from (($1::jsonb->>'expires_at')::timestamptz-now()))::int as value",
      [JSON.stringify(first)],
    );
    assert.ok(secondsLeft >= 3598 && secondsLeft <= 3600);

    await asUser(db, users.b);
    await start(db, 37.79, -122.42, 8);
    assert.equal(await scalar<number>(db,
      'select count(*)::int as value from public.location_shares where couple_id=$1', [firstCouple]), 2);
    await assert.rejects(start(db, 0, 0), /already_sharing/);
  } finally { await db.close(); }
});

test('location sharing database lists only active shares in the current couple', async () => {
  const { db, firstCouple } = await fixture();
  try {
    await asUser(db, users.a);
    await start(db, 37.78, -122.41);
    await asUser(db, users.b);
    await start(db, 37.79, -122.42);

    await asUser(db, users.a);
    const listed = await scalar<Array<{ user_id: string; latitude: number }>>(db,
      'select public.duet_list_location_shares() as value');
    assert.equal(listed.length, 2);
    assert.deepEqual(new Set(listed.map(row => row.user_id)), new Set([users.a, users.b]));
    assert.ok(listed.every(row => typeof row.latitude === 'number'));

    await asUser(db, users.c);
    await start(db, 40, -73, 5);
    const otherCoupleRows = await scalar<Array<{ user_id: string }>>(db,
      'select public.duet_list_location_shares() as value');
    assert.deepEqual(otherCoupleRows.map(row => row.user_id), [users.c]);
    assert.equal((await db.query('select * from public.location_shares where couple_id=$1', [firstCouple])).rows.length, 0);

    await asUser(db, users.outsider);
    await assert.rejects(db.query('select public.duet_list_location_shares()'), /not_paired/);
  } finally { await db.close(); }
});

test('location sharing database rejects invalid, anonymous and unpaired starts', async () => {
  const { db } = await fixture();
  try {
    await asUser(db, users.a);
    await assert.rejects(start(db, 90.1, 0), /invalid_location/);
    await assert.rejects(start(db, 0, 180.1), /invalid_location/);
    await assert.rejects(start(db, 0, 0, -1), /invalid_location/);
    await assert.rejects(start(db, 0, 0, 100001), /invalid_location/);

    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(start(db, 0, 0), /unauthenticated/);

    await asUser(db, users.outsider);
    await assert.rejects(start(db, 0, 0), /not_paired/);
  } finally { await db.close(); }
});

test('location sharing database restricts updates and stops to the current owner', async () => {
  const { db, firstCouple } = await fixture();
  try {
    await asUser(db, users.a);
    await start(db, 37.78, -122.41);
    await asUser(db, users.b);
    await start(db, 37.79, -122.42);

    await asUser(db, users.a);
    await assert.rejects(db.query(
      'insert into public.location_shares(couple_id,user_id,latitude,longitude,accuracy_m) values($1,$2,0,0,1)',
      [firstCouple, users.a],
    ), /permission denied/);
    await assert.rejects(db.query('update public.location_shares set latitude=1 where user_id=$1', [users.a]), /permission denied/);
    await assert.rejects(db.query('delete from public.location_shares where user_id=$1', [users.b]), /permission denied/);

    await admin(db);
    await db.query("update public.location_shares set updated_at=now()-interval '11 seconds' where user_id=$1", [users.a]);
    await asUser(db, users.a);
    await update(db, 37.8, -122.4, 9);
    assert.equal(await scalar<number>(db,
      'select latitude as value from public.location_shares where user_id=$1', [users.a]), 37.8);
    assert.equal(await scalar<number>(db,
      'select latitude as value from public.location_shares where user_id=$1', [users.b]), 37.79);

    await db.query('select public.duet_stop_location_share()');
    assert.equal(await scalar<number>(db,
      'select count(*)::int as value from public.location_shares where user_id=$1', [users.a]), 0);
    assert.equal(await scalar<number>(db,
      'select count(*)::int as value from public.location_shares where user_id=$1', [users.b]), 1);
  } finally { await db.close(); }
});

test('location sharing database rate limits updates and hides expired sessions immediately', async () => {
  const { db, firstCouple } = await fixture();
  try {
    await asUser(db, users.a);
    await start(db, 37.78, -122.41);
    await asUser(db, users.b);
    await start(db, 37.79, -122.42);
    await asUser(db, users.a);
    await assert.rejects(update(db, 37.81, -122.4), /location_rate_limited/);

    await admin(db);
    await db.query("update public.location_shares set updated_at=now()-interval '11 seconds' where user_id=$1", [users.a]);
    await asUser(db, users.a);
    await update(db, 37.81, -122.4);
    await assert.rejects(update(db, 37.82, -122.4), /location_rate_limited/);

    await admin(db);
    await db.query("update public.location_shares set expires_at=now()-interval '1 second' where user_id=$1", [users.a]);
    await asUser(db, users.a);
    await assert.rejects(update(db, 37.82, -122.4), /location_expired/);
    assert.equal((await db.query('select * from public.location_shares where user_id=$1', [users.a])).rows.length, 0);
    const listed = await scalar<Array<{ user_id: string }>>(db, 'select public.duet_list_location_shares() as value');
    assert.deepEqual(listed.map(row => row.user_id), [users.b]);

    const replacement = await start(db, 37.82, -122.4);
    assert.ok(Date.parse(replacement.expires_at) > Date.now());
    assert.equal(await scalar<number>(db,
      'select count(*)::int as value from public.location_shares where couple_id=$1 and user_id=$2',
      [firstCouple, users.a]), 1);
  } finally { await db.close(); }
});

test('location sharing database prunes expired rows idempotently', async () => {
  const { db } = await fixture();
  try {
    await asUser(db, users.a);
    await start(db, 37.78, -122.41);
    await asUser(db, users.b);
    await start(db, 37.79, -122.42);
    await admin(db);
    await db.exec("update public.location_shares set expires_at=now()-interval '1 second'");
    const firstDelete = await scalar<number>(db, 'select public.duet_prune_expired_location_shares() as value');
    assert.equal(firstDelete, 2);
    const secondDelete = await scalar<number>(db, 'select public.duet_prune_expired_location_shares() as value');
    assert.equal(secondDelete, 0);
    assert.equal(await scalar<number>(db, 'select count(*)::int as value from public.location_shares'), 0);
  } finally { await db.close(); }
});
