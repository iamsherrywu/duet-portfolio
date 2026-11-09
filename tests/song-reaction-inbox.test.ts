import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,asUser,users} from './helpers/database';
test('reaction notifications cannot be read or forged directly by authenticated users',async()=>{
 const db=await database();try{await asUser(db,users.a);await assert.rejects(db.query('select * from public.song_reaction_inbox'),/permission denied/);await assert.rejects(db.query("insert into public.song_reaction_inbox(prompt,answer) values('fake','fake')"),/permission denied/);}finally{await db.close();}
});
