import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FeedbackForm,feedbackMailUrl} from '../src/components/duet-workspace';
import {AccountDeletion} from '../src/components/account-deletion';
import {SpaceSettings} from '../src/components/space-settings';

test('feedback form requires content and does not claim delivery before submit',()=>{
 const url=new URL(feedbackMailUrl('A problem','  中文 & details\nsecond line  '));
 assert.equal(url.protocol,'mailto:');
 assert.equal(url.searchParams.get('subject'),'Duet feedback');
 assert.equal(url.searchParams.get('body'),'Topic: A problem\n\n中文 & details\nsecond line');
 const html=renderToStaticMarkup(createElement(FeedbackForm));
 assert.doesNotMatch(html,/Opens your email app/);
 assert.doesNotMatch(html,/Send the email there/);
 assert.match(html,/maxlength="2000"/i);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Submit/);
 assert.doesNotMatch(html,/sent successfully|Feedback sent/i);
});

test('account option cards only open a confirmation stage; initial markup cannot submit destruction',()=>{
 const account=renderToStaticMarkup(createElement(AccountDeletion,{appearance:'card'}));
 assert.match(account,/Request account deletion/);
 assert.match(account,/both accounts’ confirmation/);
 assert.doesNotMatch(account,/Type DELETE ACCOUNT|>Delete account<|<form/);
 const space=renderToStaticMarkup(createElement(SpaceSettings,{userId:'me',appearance:'card',onDeleted:()=>{}}));
 assert.match(space,/Dissolve shared space/);
 assert.match(space,/<button[^>]*disabled=""[^>]*><span[^>]*aria-label="Loading"/);
 assert.doesNotMatch(space,/Type REQUEST DELETION|Confirm dissolution|<form/);
});
