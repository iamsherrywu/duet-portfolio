import test from 'node:test';import assert from 'node:assert/strict';
import {database,paired,users,asUser,admin,scalar} from './helpers/database';
test('marking an already read message does not write again or cause realtime feedback loops',async()=>{
 const db=await database();try{
  await paired(db,users.a,users.b);await asUser(db,users.a);const message=await scalar(db,"select duet_send_message('text','hello','{}') as value");
  await admin(db);await db.exec("create table public.read_write_audit(id int);create function public.audit_read_write() returns trigger language plpgsql as $$ begin insert into public.read_write_audit values(1); return new; end $$;create trigger audit_read_write after update on public.conversation_reads for each row execute function public.audit_read_write(); grant insert on public.read_write_audit to authenticated;");
  await asUser(db,users.b);await db.query('select duet_mark_read($1)',[message]);await db.query('select duet_mark_read($1)',[message]);
  await admin(db);assert.equal(await scalar<number>(db,'select count(*)::int as value from read_write_audit'),0);
 }finally{await db.close();}
});
