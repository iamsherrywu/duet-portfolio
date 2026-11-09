import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScreenshotRecognizer} from '../src/lib/song-import';
test('same file content skips repeated uploads within the account but never leaks to another account',async()=>{
 let calls=0;const recognize=createScreenshotRecognizer(async()=>{calls++;return{title:'Song',artist:'Artist'};});
 const file=()=>new File(['same screenshot'],'photo.png',{type:'image/png'});
 await recognize(file(),'a');await recognize(file(),'a');assert.equal(calls,1);
 await recognize(file(),'b');assert.equal(calls,2);
});
test('incomplete recognition is not cached and can be retried',async()=>{
 let calls=0;const recognize=createScreenshotRecognizer(async()=>{calls++;return{title:'Song',artist:'',needsManualEntry:true};});
 const file=new File(['image'],'photo.png',{type:'image/png'});await recognize(file,'a');await recognize(file,'a');assert.equal(calls,2);
});
