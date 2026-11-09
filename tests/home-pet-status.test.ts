import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {PetStatus,activeMood} from '../src/components/home-status';
import {scheduleInitialValues,scheduleLabel} from '../src/lib/schedule-form';
test('only the pet owner gets an editable status entry',()=>{
 const props={name:'Partner',value:'Calm · Idle',onEdit:()=>{}};
 assert.match(render(createElement(PetStatus,{...props,own:true})),/<button/);
 assert.doesNotMatch(render(createElement(PetStatus,{...props,own:false})),/<button/);
 assert.match(render(createElement(PetStatus,{...props,own:false})),/Calm · Idle/);
 assert.equal(activeMood([{user_id:'me',mood:'Tired',expires_at:'2026-10-26T16:00:00Z'}],'me',Date.parse('2026-10-26T16:00:00Z')),'');
});
test('editing an all-day schedule restores the inclusive end and labels it without an extra day',()=>{
 const row={id:'a',owner_id:'me',title:'旅行',note:'',starts_at:'2026-10-30T16:00:00Z',ends_at:'2026-11-02T16:00:00Z',timezone:'Asia/Shanghai',all_day:true};
 assert.equal(scheduleInitialValues('2026-10-31',row).end.slice(0,10),'2026-11-02');
 assert.equal(scheduleLabel(row),'2026-10-31 – 2026-11-02 · All-day');
});
