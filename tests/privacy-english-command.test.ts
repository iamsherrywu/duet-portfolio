import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyInstruction } from '../src/lib/ai/provider';

test('English privacy commands accept explicit tokens and preserve Chinese commands', () => {
  for(const command of ['/private',' /PRIVATE I need some space','/private: 我很累','/保密，我很累']) {
    assert.equal(privacyInstruction(command),true,command);
  }
  for(const command of ['/public',' /PUBLIC Let us talk about dinner','/public，聊聊晚饭','/公开，聊聊晚饭','结束保密']) {
    assert.equal(privacyInstruction(command),false,command);
  }
});

test('English privacy commands do not match quoted, embedded or longer words', () => {
  for(const text of ['Does /private hide this?','"/private"','/privately','/publicity','Please use /public']) {
    assert.equal(privacyInstruction(text),null,text);
  }
});
