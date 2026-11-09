import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deleteOwnAccount} from '../src/lib/server/account-deletion';
const request=(body:unknown)=>new Request('https://duet.example/api/duet/account/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('account deletion requires exact confirmation and never accepts another account id',async()=>{
 let called=false;const deps={hasSharedSpace:async()=>false,deleteOwnAccount:async()=>{called=true}};
 await assert.rejects(deleteOwnAccount(request({confirmation:'DELETE'}),'own',deps));
 await assert.rejects(deleteOwnAccount(request({confirmation:'DELETE ACCOUNT',userId:'other'}),'own',deps));
 assert.equal(called,false);
});
test('account deletion cannot bypass two-person space dissolution or cleanup',async()=>{
 let deleted=false;await assert.rejects(deleteOwnAccount(request({confirmation:'DELETE ACCOUNT'}),'own',{hasSharedSpace:async()=>true,deleteOwnAccount:async()=>{deleted=true}}),/shared_space_exists/);
 assert.equal(deleted,false);
});
test('unlinked account deletes only the authenticated account and fails closed on lookup errors',async()=>{
 const seen:string[]=[];const response=await deleteOwnAccount(request({confirmation:'DELETE ACCOUNT'}),'own',{hasSharedSpace:async id=>{seen.push('check:'+id);return false},deleteOwnAccount:async id=>{seen.push('delete:'+id)}});
 assert.deepEqual(seen,['check:own','delete:own']);assert.equal(response.status,200);
 await assert.rejects(deleteOwnAccount(request({confirmation:'DELETE ACCOUNT'}),'own',{hasSharedSpace:async()=>{throw Error('offline')},deleteOwnAccount:async()=>{throw Error('must not delete')}}),/offline/);
});
