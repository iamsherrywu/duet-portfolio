import assert from 'node:assert/strict';
import {test} from 'node:test';
import {admin,asUser,database,paired,scalar,users} from './helpers/database';
type DB=Awaited<ReturnType<typeof database>>;
const time=(hour:number)=>new Date(Date.UTC(2099,0,1)+hour*3600000).toISOString();
async function add(db:DB,start=time(9),end=time(10),title='Work'){
  return scalar<string>(db,'select public.duet_create_personal_schedule($1,$2,$3,$4,$5) as value',[title,start,end,'Asia/Shanghai','Shared schedule']);
}
async function propose(db:DB,start=time(18),end=time(19),hash?:string){
  const context=await scalar<{hash:string}>(db,"select public.duet_get_date_context('{}'::uuid[]) as value");
  return scalar<string>(db,'select public.duet_create_date_proposal($1,$2,$3,$4,$5,$6,$7,$8::uuid[]) as value',
    ['todo','Dinner',start,end,'Asia/Shanghai','Dinner together',hash??context.hash,[]]);
}
type Free={start:string;end:string};
const normalized=(rows:Free[])=>rows.map(row=>[new Date(row.start).toISOString(),new Date(row.end).toISOString()]);

test('personal schedules are shared within a pair but only the owner can edit or cancel',async()=>{
  const db=await database();try{
    await paired(db,users.a,users.b);await paired(db,users.c,users.d);await asUser(db,users.a);
    const id=await add(db);
    await asUser(db,users.b);
    const rows=await scalar<Array<{id:string;owner_id:string;title:string}>>(db,'select public.duet_list_personal_schedules($1,$2) as value',[time(0),time(24)]);
    assert.equal(rows.length,1);assert.equal(rows[0].id,id);assert.equal(rows[0].owner_id,users.a);
    await assert.rejects(db.query('select public.duet_update_personal_schedule($1,$2,$3,$4,$5,$6)',[id,'Changed',time(9),time(11),'Asia/Shanghai','']),/not_found/);
    await assert.rejects(db.query('select public.duet_cancel_personal_schedule($1)',[id]),/not_found/);
    await asUser(db,users.c);
    assert.deepEqual(await scalar(db,'select public.duet_list_personal_schedules($1,$2) as value',[time(0),time(24)]),[]);
    assert.equal((await db.query('select id from public.personal_schedules where id=$1',[id])).rows.length,0);
    await assert.rejects(db.query('select public.duet_cancel_personal_schedule($1)',[id]),/not_found/);
    await asUser(db,users.a);
    await db.query('select public.duet_update_personal_schedule($1,$2,$3,$4,$5,$6)',[id,'Updated',time(10),time(11),'Asia/Shanghai','']);
    assert.equal(await scalar(db,'select title as value from public.personal_schedules where id=$1',[id]),'Updated');
    await assert.rejects(db.query("update public.personal_schedules set title='bypass' where id=$1",[id]),/permission denied/);
    await db.query('select public.duet_cancel_personal_schedule($1)',[id]);
    assert.deepEqual(await scalar(db,'select public.duet_list_personal_schedules($1,$2) as value',[time(0),time(24)]),[]);
  }finally{await admin(db);await db.close();}
});

test('empty calendars are free without manual availability and one-person spaces cannot confirm dates',async()=>{
  const db=await database();try{
    await asUser(db,users.a);await db.query('select public.duet_create_couple()');
    await assert.rejects(propose(db),/no_common_availability/);
    const token=await scalar<string>(db,'select public.duet_create_invitation() as value');
    await asUser(db,users.b);await db.query('select public.duet_accept_invitation($1)',[token]);
    const free=await scalar<Free[]>(db,'select public.duet_common_free_time($1,$2) as value',[time(0),time(24)]);
    assert.deepEqual(normalized(free),[[time(0),time(24)]]);
    assert.ok(await propose(db));
  }finally{await admin(db);await db.close();}
});

test('common free time subtracts cross-day, nested and adjacent busy intervals and cancellation releases time',async()=>{
  const db=await database();try{
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const overnight=await add(db,time(-1),time(1));await add(db,time(9),time(11));await add(db,time(12),time(13));
    await asUser(db,users.b);await add(db,time(10),time(12));await add(db,time(10.5),time(11));
    const free=await scalar<Free[]>(db,'select public.duet_common_free_time($1,$2) as value',[time(0),time(24)]);
    assert.deepEqual(normalized(free),[[time(1),time(9)],[time(13),time(24)]]);
    await asUser(db,users.a);await db.query('select public.duet_cancel_personal_schedule($1)',[overnight]);
    const next=await scalar<Free[]>(db,'select public.duet_common_free_time($1,$2) as value',[time(0),time(24)]);
    assert.deepEqual(normalized(next),[[time(0),time(9)],[time(13),time(24)]]);
    await assert.rejects(db.query('select public.duet_common_free_time($1,$2)',[time(1),time(1)]),/invalid_calendar_range/);
    await assert.rejects(add(db,time(2),time(1)),/invalid_schedule_input/);
  }finally{await admin(db);await db.close();}
});

test('schedule changes invalidate model snapshots and a new conflict blocks the second date confirmation',async()=>{
  const db=await database();try{
    await paired(db,users.a,users.b);await asUser(db,users.a);
    const original=await scalar<{hash:string}>(db,"select public.duet_get_date_context('{}'::uuid[]) as value");
    const unchanged=await scalar<{hash:string}>(db,"select public.duet_get_date_context('{}'::uuid[]) as value");
    assert.equal(original.hash,unchanged.hash,'time passing alone must not invalidate a snapshot');
    await add(db,time(9),time(10));
    await assert.rejects(propose(db,time(18),time(19),original.hash),/date_context_changed/);
    const id=await propose(db);await db.query('select public.duet_confirm_date_proposal($1,1)',[id]);
    await asUser(db,users.b);const work=await add(db,time(18),time(20));
    await assert.rejects(db.query('select public.duet_confirm_date_proposal($1,1)',[id]),/no_common_availability/);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.date_proposal_confirmations where proposal_id=$1',[id]),1);
    assert.equal(await scalar<number>(db,'select count(*)::int as value from public.entries'),0);
    await db.query('select public.duet_cancel_personal_schedule($1)',[work]);
    const done=await scalar<{status:string;entry_id:string}>(db,'select public.duet_confirm_date_proposal($1,1) as value',[id]);
    assert.equal(done.status,'completed');assert.ok(done.entry_id);
    assert.deepEqual(await scalar(db,'select public.duet_confirm_date_proposal($1,1) as value',[id]),done);
    await assert.rejects(propose(db,time(18),time(19)),/no_common_availability/);
    assert.ok(await propose(db,time(19),time(20)),'a date ending at 19:00 must not block a date starting at 19:00');
    const free=await scalar<Free[]>(db,'select public.duet_common_free_time($1,$2) as value',[time(17),time(21)]);
    assert.deepEqual(normalized(free),[[time(17),time(18)],[time(19),time(21)]]);
  }finally{await admin(db);await db.close();}
});

test('untimed dated reminders do not make a day busy and schedule RPCs do not leak to anonymous users',async()=>{
  const db=await database();try{
    const couple=await paired(db,users.a,users.b);await admin(db);
    await db.query("insert into public.entries(couple_id,author_id,kind,title,body,visibility,event_date) values($1,$2,'anniversary','A date-only reminder','','shared','2099-01-01')",[couple,users.a]);
    await asUser(db,users.a);
    assert.deepEqual(normalized(await scalar<Free[]>(db,'select public.duet_common_free_time($1,$2) as value',[time(0),time(24)])),[[time(0),time(24)]]);
    await admin(db);await db.exec('set role anon');
    await assert.rejects(db.query('select public.duet_list_personal_schedules($1,$2)',[time(0),time(24)]),/permission denied/);
  }finally{await admin(db);await db.close();}
});
