import assert from 'node:assert/strict';
import { test } from 'node:test';
import { core } from '../src/lib/server/core';
import type { Context } from '../src/lib/supabase/server';
import { admin, asUser, database, paired, users } from './helpers/database';

test('profile privacy: authenticated users cannot query profile rows containing backend-only birthdays', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    await asUser(db, users.a);
    await assert.rejects(
      db.query('select * from public.profiles where id=$1', [users.a]),
      /permission denied/i,
    );
    await assert.rejects(
      db.query('select * from public.profiles where id=$1', [users.b]),
      /permission denied/i,
    );
  } finally {
    await admin(db);
    await db.close();
  }
});

test('profile privacy: only couple profile RPC exposes birthdays while own profile remains minimal', async () => {
  const db = await database();
  try {
    await paired(db, users.a, users.b);
    await asUser(db, users.a);
    await db.query("select public.duet_initialize_profile('Alice','female','1995-08-10',null)");
    await asUser(db, users.b);
    await db.query("select public.duet_initialize_profile('Bob','male','1994-06-01',null)");
    await asUser(db, users.a);
    const own = (await db.query<{ value: Record<string, unknown> }>('select public.duet_get_my_profile() as value')).rows[0].value;
    assert.equal(own.display_name, 'Alice');
    assert.equal(Object.hasOwn(own, 'birthday'), false);
    const couple = (await db.query<{ value: Array<Record<string, unknown>> }>('select public.duet_list_couple_profiles() as value')).rows[0].value;
    assert.ok(couple.length >= 2);
    assert.equal(couple.find(profile => profile.id === users.a)?.birthday, '1995-08-10');
    assert.equal(couple.find(profile => profile.id === users.b)?.birthday, '1994-06-01');

    await paired(db, users.c, users.d);
    await asUser(db, users.c);
    const otherCouple = (await db.query<{ value: Array<Record<string, unknown>> }>('select public.duet_list_couple_profiles() as value')).rows[0].value;
    assert.equal(otherCouple.some(profile => profile.id === users.a || profile.id === users.b), false);
    assert.equal(otherCouple.some(profile => Object.hasOwn(profile, 'birthday')), true);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('profile privacy: couple response safely includes only the couple-scoped birthday field', async () => {
  const calls: string[] = [];
  const ctx = {
    user: { id: users.a },
    db: {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return { select: async () => ({ data: [{ user_id: users.a, couple_id: 'couple-1' }], error: null }) };
      },
      rpc: async (name: string) => {
        calls.push(name);
        return { data: [{ id: users.a, display_name: 'Alice', gender: 'female', birthday: '1995-08-10' }], error: null };
      },
    },
  } as unknown as Context;
  const response = await core(new Request('https://duet.example/api/duet/couple'), ['couple'], ctx);
  assert.ok(response);
  const payload = await response.json() as { data: { profiles: Array<Record<string, unknown>> } };
  assert.deepEqual(calls, ['from:couple_members', 'duet_list_couple_profiles']);
  assert.equal(payload.data.profiles[0].birthday, '1995-08-10');
});

test('profile privacy: HTTP response strips birthday even if an upstream source includes it', async () => {
  const rpcCalls: string[] = [];
  const ctx = {
    user: { id: users.a },
    db: {
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { data: {
          id: users.a,
          display_name: 'Alice',
          gender: 'female',
          birthday: '1995-08-10',
          timezone: 'Asia/Shanghai',
          afterwork_start: '17:30:00',
          afterwork_end: '23:00:00',
          location_avatar_media_id: null,
          clown_role: null,
        }, error: null };
      },
    },
  } as unknown as Context;
  const response = await core(new Request('https://duet.example/api/duet/profile'), ['profile'], ctx);
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(rpcCalls, ['duet_get_my_profile']);
  const payload = await response.json() as { data: Record<string, unknown> };
  assert.equal(payload.data.display_name, 'Alice');
  assert.equal(Object.hasOwn(payload.data, 'birthday'), false);
});

test('profile privacy: first-time profile endpoint stores birthday but never returns it', async () => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const ctx = {
    user: { id: users.a },
    db: { rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return { data: null, error: null };
    } },
  } as unknown as Context;
  const response = await core(new Request('https://duet.example/api/duet/profile/initialize', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Alice', gender: 'female', birthday: '1995-08-10' }),
  }), ['profile', 'initialize'], ctx);
  assert.ok(response);
  assert.equal(response.status, 201);
  assert.deepEqual(rpcCalls, [['duet_initialize_profile', {
    p_display_name: 'Alice', p_gender: 'female', p_birthday: '1995-08-10', p_clown_role: null,
  }]]);
  assert.equal(JSON.stringify(await response.json()).includes('1995-08-10'), false);
});

test('profile privacy: registration initializes birthday in backend without returning it', async () => {
  const db = await database();
  try {
    await asUser(db, users.a);
    await db.query("select public.duet_initialize_profile('Alice','female','1995-08-10',null)");
    await admin(db);
    const stored = (await db.query<{ birthday: string }>('select birthday::text from public.profiles where id=$1', [users.a])).rows[0];
    assert.equal(stored.birthday, '1995-08-10');
    await asUser(db, users.a);
    await assert.rejects(db.query("select public.duet_initialize_profile('Alice','female','1995-08-11',null)"), /profile_already_initialized/);
    await admin(db);
    const unchanged = (await db.query<{ birthday: string }>('select birthday::text from public.profiles where id=$1', [users.a])).rows[0];
    assert.equal(unchanged.birthday, '1995-08-10');
  } finally {
    await admin(db);
    await db.close();
  }
});

test('profile privacy: only avatar owner reads private avatar until sharing current location', async () => {
  const db = await database();
  try {
    const couple = await paired(db, users.a, users.b);
    await asUser(db, users.a);
    const media = await db.query<{ value: { id: string } }>("select public.duet_register_media('location_avatar','image/png') as value");
    const mediaId = media.rows[0].value.id;
    await db.query('select public.duet_set_location_avatar($1)', [mediaId]);
    await asUser(db, users.b);
    assert.equal((await db.query('select id from public.media where id=$1', [mediaId])).rows.length, 0);
    await asUser(db, users.a);
    await db.query('select public.duet_start_location_share(31.2,121.5,20)');
    await asUser(db, users.b);
    assert.equal((await db.query<{ id: string }>('select id from public.media where id=$1', [mediaId])).rows[0].id, mediaId);
    await asUser(db, users.a);
    await db.query('select public.duet_stop_location_share()');
    await asUser(db, users.b);
    assert.equal((await db.query('select id from public.media where id=$1', [mediaId])).rows.length, 0);
    assert.ok(couple);
  } finally {
    await admin(db);
    await db.close();
  }
});

test('profile editing updates only the current account and keeps birthdays couple-scoped', async () => {
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);
  await db.query("select public.duet_initialize_profile('Alice','female','1995-08-10',null)");
  await asUser(db,users.b);await db.query("select public.duet_initialize_profile('Bob','male','1994-06-01',null)");
  await asUser(db,users.a);await db.query("select public.duet_edit_profile('Alicia','other','1996-09-11')");
  const profiles=(await db.query<{value:Array<{id:string;display_name:string;birthday:string}>}>('select public.duet_list_couple_profiles() as value')).rows[0].value;
  assert.equal(profiles.find(p=>p.id===users.a)?.display_name,'Alicia');
  assert.equal(profiles.find(p=>p.id===users.a)?.birthday,'1996-09-11');
  assert.equal(profiles.find(p=>p.id===users.b)?.display_name,'Bob');
  await assert.rejects(db.query("select public.duet_edit_profile('','female','1995-08-10')"),/invalid_profile/);
  await assert.rejects(db.query("select public.duet_edit_profile('Alice','female','2995-08-10')"),/invalid_profile/);
  await admin(db);await db.exec('set role anon');
  await assert.rejects(db.query("select public.duet_edit_profile('Alice','female','1995-08-10')"),/permission denied/);
 }finally{await admin(db);await db.close()}
});
