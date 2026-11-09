import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {ScheduleAgenda} from '../src/components/shared-calendar';
import {SyncButton} from '../src/components/date-planner';
import {PersonalScheduleForm,buildSchedulePayload} from '../src/components/personal-schedule-form';
const row=(id:string,owner_id:string)=>({id,owner_id,title:`Work ${id}`,note:'Notes',starts_at:'2099-01-01T09:00:00Z',ends_at:'2099-01-01T10:00:00Z',timezone:'Asia/Shanghai'});
test('agenda renders both partners, owner-only actions and empty-day free time without stale or failed facts',()=>{
 const html=render(createElement(ScheduleAgenda,{userId:'me',schedules:[row('a','me'),row('b','partner')],free:[{start:'2099-01-01T00:00:00Z',end:'2099-01-02T00:00:00Z'}],status:'ready',onEdit:()=>{},onCancel:()=>{}}));
 assert.match(html,/Work a/);assert.match(html,/Work b/);assert.match(html,/Me/);assert.match(html,/Partner/);
 assert.equal((html.match(/>Edit</g)||[]).length,1);assert.equal((html.match(/>Cancel</g)||[]).length,1);
 assert.match(html,/Free together/);
 for(const status of ['loading','error'] as const){
  const pending=render(createElement(ScheduleAgenda,{userId:'me',schedules:[],free:[{start:'2099-01-01T00:00:00Z',end:'2099-01-02T00:00:00Z'}],status,onEdit:()=>{},onCancel:()=>{}}));
  assert.doesNotMatch(pending,/09:00|Free:/);
 }
});
test('date confirmation says exactly in sync and is disabled after this user confirms',()=>{
 assert.match(render(createElement(SyncButton,{disabled:false,onClick:()=>{}})),/>in sync<\/button>/);
 assert.match(render(createElement(SyncButton,{disabled:true,onClick:()=>{}})),/disabled/);
});
test('schedule form uses explicit Shanghai time and validates time order before submission',()=>{
 const html=render(createElement(PersonalScheduleForm,{selectedDate:'2099-01-01',onSaved:()=>{},onClose:()=>{}}));
 assert.match(html,/New event/);assert.doesNotMatch(html,/Asia\/Shanghai/);
 const payload=buildSchedulePayload({title:'Work',note:'',start:'2099-01-01T09:00',end:'2099-01-01T10:00'});
 assert.equal(payload.startsAt,'2099-01-01T01:00:00.000Z');assert.equal(payload.endsAt,'2099-01-01T02:00:00.000Z');
 assert.throws(()=>buildSchedulePayload({title:'Work',note:'',start:'2099-01-01T10:00',end:'2099-01-01T09:00'}));
});
