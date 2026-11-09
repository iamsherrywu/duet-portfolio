import assert from 'node:assert/strict';
import {test} from 'node:test';
import {database,paired,asUser,users,scalar,admin} from './helpers/database';
test('appearance changes preserve species, ownership and feeding history while duplicate species remain blocked',async()=>{
 const db=await database();try{
 await paired(db,users.a,users.b);await asUser(db,users.a);
 const cat=await scalar(db,"select duet_claim_pet('cat','Devon Rex','团团') as value");
 await db.query("select duet_feed_pet($1,'text','早安','Q','A')",[cat]);
 await db.query("select duet_update_pet($1,'Ivory Shorthair','团团','midnight')",[cat]);
 const row=await scalar<{id:string;kind:string;owner_id:string;breed:string}>(db,'select row_to_json(pets) as value from pets where id=$1',[cat]);
 assert.equal(row.id,cat);assert.equal(row.kind,'cat');assert.equal(row.owner_id,users.a);assert.equal(row.breed,'Ivory Shorthair');
 assert.equal(await scalar<number>(db,'select count(*)::int as value from daily_feeds where pet_id=$1',[cat]),1);
 await asUser(db,users.b);await assert.rejects(db.query("select duet_claim_pet('cat','Silver Shorthair','Milo')"),/unique|duplicate/);
 await assert.rejects(db.query("select duet_update_pet($1,'Black Shorthair','Changed','classic')",[cat]),/not_found/);
 await db.query("select duet_claim_pet('dog','Golden Retriever','Milo')");
 }finally{await admin(db);await db.close();}
});
