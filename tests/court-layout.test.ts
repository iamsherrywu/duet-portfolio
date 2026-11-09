import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CourtReadiness,CourtStatementColumns,courtProgress,type CourtCase} from '../src/components/cat-court';

const base:CourtCase={id:'case',plaintiff_id:'a',defendant_id:'b',status:'open',created_at:'2026-11-02T00:00:00Z',invitation_sent_at:'2026-11-02T00:00:00Z',accepted_at:'2026-11-02T00:00:00Z',plaintiff_ready_at:null,defendant_ready_at:null,statements:[],verdict:null,tasks:[]};
const names={plaintiff:'Sherry',defendant:'Nick'};

test('accepting the court invitation does not start the hearing; both readiness cards disappear only after both Ready actions',()=>{
  assert.equal(courtProgress(base,'a').canSubmit,false);
  const waiting={...base,plaintiff_ready_at:'2026-11-02T00:01:00Z'};
  assert.equal(courtProgress(waiting,'a').ready,false);
  const html=renderToStaticMarkup(createElement(CourtReadiness,{item:waiting,userId:'a',names,busy:false,onReady:()=>{}}));
  assert.match(html,/You · Plaintiff/);assert.match(html,/Nick · Defendant/);assert.match(html,/Ready ✓/);
  assert.doesNotMatch(html,/Partner/);
  const ready={...waiting,defendant_ready_at:'2026-11-02T00:02:00Z'};
  assert.equal(courtProgress(ready,'a').canSubmit,true);
  assert.equal(renderToStaticMarkup(createElement(CourtReadiness,{item:ready,userId:'a',names,busy:false,onReady:()=>{}})),'');
});

test('Court shows both statements side by side while only the current user can edit their own draft',()=>{
  const item={...base,plaintiff_ready_at:'now',defendant_ready_at:'now'};
  const props={item,userId:'a',names,round:0,happened:'My side',feeling:'My feelings',argument:'',onHappened:()=>{},onFeeling:()=>{},onArgument:()=>{}};
  const html=renderToStaticMarkup(createElement(CourtStatementColumns,props));
  const mine=html.slice(html.indexOf('is-plaintiff'),html.indexOf('is-defendant'));
  const theirs=html.slice(html.indexOf('is-defendant'));
  assert.equal((mine.match(/<textarea/g)??[]).length,2);
  assert.equal((theirs.match(/<textarea/g)??[]).length,0);
  assert.match(theirs,/Waiting for Nick/);
  const submitted={...item,statements:[{id:'statement',round:0,author_id:'a',body:'已提交的陈述',created_at:'now'}]};
  assert.equal(courtProgress(submitted,'a').canSubmit,false);
  assert.equal(courtProgress(submitted,'b').canSubmit,true);
  const locked=renderToStaticMarkup(createElement(CourtStatementColumns,{...props,item:submitted}));
  assert.doesNotMatch(locked,/<textarea/);assert.match(locked,/已提交的陈述/);
});

test('approved Court hero derives the case heading without deleted statement-count copy',async()=>{
  const {CourtHero,courtCaseTitle}=await import('../src/components/cat-court');
  assert.equal(courtCaseTitle(base),'Case · Nov 2');
  const item={...base,statements:[{id:'actual-opening',round:0,author_id:'a',body:'What happened?\n我们需要重新安排旅行\n\nWhy are you upset?\n还没商量好',created_at:'2026-11-02T01:00:00Z'}]};
  assert.equal(courtCaseTitle(item),'我们需要重新安排旅行');
  const html=renderToStaticMarkup(createElement(CourtHero,{item}));
  assert.match(html,/CASE · OPEN/);assert.match(html,/<h2>我们需要重新安排旅行<\/h2>/);
  assert.doesNotMatch(html,/Weekend plans|A small misunderstanding|Nick|6 statements/);
  const judged={...item,status:'judged' as const,verdict:{rootCause:'actual root',responsibility:{plaintiff:50,defendant:50},judgment:'actual ruling',articles:[],reconciliation:[]}};
  const closed=renderToStaticMarkup(createElement(CourtHero,{item:judged}));
  assert.ok(closed.indexOf('CASE · CLOSED')<closed.indexOf('cat-judge-badge.png'));
  assert.doesNotMatch(closed,/Both sides heard/);
});

test('Back to case can display submitted rounds without reopening edits in a judged case',()=>{
  const item={...base,status:'judged' as const,plaintiff_ready_at:'now',defendant_ready_at:'now',statements:[{id:'a-final',round:2,author_id:'a',body:'Actual final statement A',created_at:'now'},{id:'b-final',round:2,author_id:'b',body:'Actual final statement B',created_at:'now'}]};
  const html=renderToStaticMarkup(createElement(CourtStatementColumns,{item,userId:'a',names,round:2,happened:'',feeling:'',argument:'',onHappened:()=>{},onFeeling:()=>{},onArgument:()=>{}}));
  assert.match(html,/Actual final statement A/);assert.match(html,/Actual final statement B/);
  assert.doesNotMatch(html,/<textarea/);assert.equal(courtProgress(item,'a').canSubmit,false);
});
