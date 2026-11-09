import test from 'node:test';
import assert from 'node:assert/strict';
import {database,paired,asUser,scalar,users,admin} from './helpers/database';

test('chat photos are sent only after upload, visible to the partner, and isolated from other spaces',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await paired(db,users.c,users.d);await asUser(db,users.a);
  const media=await scalar<{id:string}>(db,"select public.duet_register_media('chat','image/png') as value");
  const metadata=JSON.stringify({media_id:media!.id});
  await assert.rejects(db.query("select public.duet_send_message('image','',$1::jsonb)",[metadata]),/not_found/);
  await admin(db);await db.query('select public.duet_media_uploaded($1)',[media!.id]);await asUser(db,users.b);
  await assert.rejects(db.query("select public.duet_send_message('image','',$1::jsonb)",[metadata]),/not_found/);
  await asUser(db,users.a);const id=await scalar(db,"select public.duet_send_message('image','',$1::jsonb) as value",[metadata]);
  await asUser(db,users.b);const received=await db.query<{metadata:{media_id:string}}>('select metadata from public.messages where id=$1',[id]);
  assert.equal(received.rows[0].metadata.media_id,media!.id);
  assert.equal((await db.query('select id from public.media where id=$1',[media!.id])).rows.length,1);
  await asUser(db,users.c);assert.equal((await db.query('select id from public.messages where id=$1',[id])).rows.length,0);
  assert.equal((await db.query('select id from public.media where id=$1',[media!.id])).rows.length,0);
 }finally{await admin(db);await db.close();}
});
