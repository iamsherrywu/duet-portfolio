import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSchedulePayload} from '../src/components/personal-schedule-form';
import {scheduleInput} from '../src/lib/server/personal-schedules';
import {admin,asUser,database,paired,scalar,users} from './helpers/database';

test('all-day single-day and cross-month ranges include the selected end date',()=>{
 const single=buildSchedulePayload({title:'休息',note:'',start:'2026-10-31',end:'2026-10-31',allDay:true});
 assert.equal(single.startsAt,'2026-10-30T16:00:00.000Z');
 assert.equal(single.endsAt,'2026-10-31T16:00:00.000Z');
 assert.equal(single.allDay,true);
 const range=buildSchedulePayload({title:'旅行',note:'',start:'2026-10-31',end:'2026-11-02',allDay:true});
 assert.equal(range.endsAt,'2026-11-02T16:00:00.000Z');
 assert.throws(()=>buildSchedulePayload({title:'bad',note:'',start:'2026-02-30',end:'2026-03-01',allDay:true}));
 assert.throws(()=>buildSchedulePayload({title:'bad',note:'',start:'2026-11-02',end:'2026-11-01',allDay:true}));
});

test('schedule API accepts all-day boundaries and rejects a partial-day marked all-day',()=>{
 const base={title:'休息',note:'',startsAt:'2026-10-26T16:00:00Z',endsAt:'2026-10-27T16:00:00Z',timezone:'Asia/Shanghai',allDay:true};
 assert.equal(scheduleInput.parse(base).allDay,true);
 assert.equal(scheduleInput.safeParse({...base,startsAt:'2026-10-26T17:00:00Z'}).success,false);
});

test('all-day schedules persist, block the full day and remain owner-only',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);
  const start='2099-01-01T16:00:00Z',end='2099-01-02T16:00:00Z';
  const id=await scalar<string>(db,'select public.duet_create_personal_schedule($1,$2,$3,$4,$5,$6) as value',['休息',start,end,'Asia/Shanghai','',true]);
  await asUser(db,users.b);
  const rows=await scalar<Array<{all_day:boolean}>>(db,'select public.duet_list_personal_schedules($1,$2) as value',[start,end]);
  assert.equal(rows[0].all_day,true);
  assert.deepEqual(await scalar(db,'select public.duet_common_free_time($1,$2) as value',[start,end]),[]);
  await assert.rejects(db.query('select public.duet_update_personal_schedule($1,$2,$3,$4,$5,$6,$7)',[id,'forged',start,end,'Asia/Shanghai','',false]),/not_found/);
  await asUser(db,users.a);
  await db.query('select public.duet_update_personal_schedule($1,$2,$3,$4,$5,$6,$7)',[id,'工作',start,'2099-01-01T17:00:00Z','Asia/Shanghai','',false]);
  assert.equal(await scalar(db,'select all_day as value from public.personal_schedules where id=$1',[id]),false);
  await assert.rejects(db.query('select public.duet_create_personal_schedule($1,$2,$3,$4,$5,$6)',['invalid','2099-01-01T17:00:00Z',end,'Asia/Shanghai','',true]),/invalid_schedule_input/);
 }finally{await admin(db);await db.close();}
});
