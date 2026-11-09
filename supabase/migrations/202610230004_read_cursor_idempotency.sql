create or replace function public.duet_mark_read(p_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); t timestamptz;
begin
  select created_at into t from public.messages where id=p_message and couple_id=c;
  if t is null then raise exception 'not_found'; end if;
  insert into public.conversation_reads values(c,auth.uid(),t)
    on conflict(couple_id,user_id) do update set last_read_at=excluded.last_read_at
    where public.conversation_reads.last_read_at<excluded.last_read_at;
end $$;
