import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { core } from '../src/lib/server/core';
import { AppError } from '../src/lib/server/http';
import type { Context } from '../src/lib/supabase/server';
import { admin, asUser, database, paired, scalar, users } from './helpers/database';

async function readyStoryMedia(db: Awaited<ReturnType<typeof database>>, owner: string) {
  await asUser(db, owner);
  const media = await scalar<{id:string}>(db,"select public.duet_register_media('story','image/png') as value");
  await admin(db);
  await db.exec('set role service_role');
  await db.query('select public.duet_media_uploaded($1)',[media.id]);
  await asUser(db,owner);
  return media.id;
}

test('shared calendar RPC returns same-couple dated shared entries and archived snaps to both partners', async () => {
  const db=await database();
  try {
    await db.exec("set timezone='UTC'");
    const couple=await paired(db,users.a,users.b);
    const date=await scalar<string>(db,"select (clock_timestamp() at time zone (public.duet_get_my_profile()->>'timezone'))::date::text as value");
    await admin(db);
    const shared=await scalar<string>(db,"insert into public.entries(couple_id,author_id,kind,title,body,visibility,status,event_date) values($1,$2,'todo','Dinner','Book a table','shared','open',$3) returning id as value",[couple,users.a,date]);
    await db.query("insert into public.entries(couple_id,author_id,kind,title,visibility,event_date) values($1,$2,'anniversary','Private date','personal',$3),($1,$2,'memory','Undated','shared',null)",[couple,users.a,date]);
    await asUser(db,users.a);
    const media=await readyStoryMedia(db,users.a);
    const snap=await scalar<{id:string;calendar_date:string}>(db,'select public.duet_create_location_snap($1,null,false) as value',[media]);
    await db.query('select public.duet_save_location_snap($1,$2)',[snap.id,shared]);

    await asUser(db,users.a);
    const fromAuthor=await scalar<{entries:Array<{id:string}>;stories:Array<{id:string;media_id:string;calendar_date:string}>}>(db,'select public.duet_list_shared_calendar($1,$2) as value',[date,date]);
    await asUser(db,users.b);
    const fromPartner=await scalar(db,'select public.duet_list_shared_calendar($1,$2) as value',[date,date]);
    assert.deepEqual(fromPartner,fromAuthor);
    assert.deepEqual(fromAuthor.entries.map(entry=>entry.id),[shared]);
    assert.deepEqual(fromAuthor.stories.map(story=>story.id),[snap.id]);
    assert.equal(fromAuthor.stories[0].media_id,media);
    assert.equal(fromAuthor.stories[0].calendar_date,date);
    assert.equal((await db.query('select id from public.media where id=$1',[media])).rows.length,1);

    await paired(db,users.c,users.d);
    await asUser(db,users.c);
    assert.deepEqual(await scalar(db,'select public.duet_list_shared_calendar($1,$2) as value',[date,date]),{entries:[],stories:[]});
  } finally {
    await admin(db);
    await db.close();
  }
});

function context(rpc:(name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:null}>) {
  return {user:{id:users.a},db:{rpc}} as unknown as Context;
}

test('shared calendar API validates bounded date range and never accepts a client couple ID', async () => {
  const calls:Array<[string,Record<string,unknown>]> = [];
  const ctx=context(async(name,args={})=>{calls.push([name,args]);return {data:{entries:[],stories:[]},error:null};});
  const response=await core(new Request('https://duet.example/api/duet/calendar?from=2026-10-01&to=2026-10-31'),['calendar'],ctx);
  assert.ok(response);
  assert.equal(response.status,200);
  assert.deepEqual(calls,[['duet_list_shared_calendar',{p_from:'2026-10-01',p_to:'2026-10-31'}]]);

  for(const query of [
    '?from=2026-10-31&to=2026-10-01',
    '?from=2026-10-01&to=2027-10-03',
    '?from=not-a-date&to=2026-10-31',
  ]) {
    await assert.rejects(core(new Request(`https://duet.example/api/duet/calendar${query}`),['calendar'],ctx),error=>error instanceof ZodError);
  }
  for(const query of ['?from=2026-10-01&to=2026-10-31&couple_id=forged','?from=2026-10-01&to=2026-10-31&from=2026-10-02']) {
    await assert.rejects(core(new Request(`https://duet.example/api/duet/calendar${query}`),['calendar'],ctx),error=>error instanceof AppError&&error.code==='invalid_input');
  }
  assert.equal(calls.length,1);
});
