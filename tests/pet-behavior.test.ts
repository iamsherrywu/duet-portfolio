import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixedPetSlots,nextPetBehavior,behaviorDuration,behaviorForAction} from '../src/lib/pet-behavior';
test('cat always occupies left and dog right regardless of account or response order',()=>{
 const me={id:'me'},partner={id:'partner'};const pets=[{kind:'dog' as const,owner_id:'me'},{kind:'cat' as const,owner_id:'partner'}];
 for(const people of [[me,partner],[partner,me]]){const slots=fixedPetSlots(people,pets);assert.equal(slots[0].person?.id,'partner');assert.equal(slots[1].person?.id,'me');}
 assert.equal(fixedPetSlots([me],[pets[0]])[0].person,undefined);assert.equal(fixedPetSlots([me],[pets[0]])[1].person?.id,'me');
});
test('short gentle behaviors complete back to idle and species have distinct idle transitions',()=>{
 for(const kind of ['cat','dog'] as const){for(const state of ['swipe','wag','stretch','doze','look','hug','lean','play','eat'] as const){assert.equal(nextPetBehavior(kind,state,.5),'idle');assert.ok(behaviorDuration(state)>=1200&&behaviorDuration(state)<=6000);}}
 assert.equal(nextPetBehavior('cat','idle',0),'swipe');assert.equal(nextPetBehavior('dog','idle',0),'wag');
 assert.equal(behaviorForAction('Wave'),'swipe');assert.equal(behaviorForAction('Tail Wag'),'wag');assert.equal(behaviorForAction('Stretch'),'stretch');assert.equal(behaviorForAction('Hug'),'hug');
 assert.equal(behaviorForAction('Lean In'),'lean');assert.equal(behaviorForAction('Play Fight'),'play');
 assert.equal(behaviorForAction('Sleep'),'doze');assert.equal(behaviorForAction('Eat'),'eat');
 assert.equal(behaviorForAction('Idle'),'idle');assert.equal(behaviorForAction('unknown action'),'idle');
});
