-- Registering an upload and approving deletion both lock the couple row.
-- Pending uploads keep their cleanup metadata until the storage operation settles.
alter table public.media add column upload_state text not null default 'ready' check(upload_state in ('pending','ready'));
create or replace function public.duet_register_media(p_purpose text,p_mime text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); m uuid:=gen_random_uuid(); path text;
begin
  perform 1 from public.couples where id=c and status='active' for update;
  if not found then raise exception 'space_inactive'; end if;
  path:=c::text||'/'||auth.uid()::text||'/'||m::text;
  insert into public.media(id,couple_id,owner_id,path,purpose,mime_type,upload_state) values(m,c,auth.uid(),path,p_purpose,p_mime,'pending');
  return jsonb_build_object('id',m,'path',path);
end $$;
create function public.duet_media_uploaded(p_media uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.media set upload_state='ready' where id=p_media;
  if not found then raise exception 'not_found'; end if;
end $$;
create function public.duet_prepare_cleanup(p_request uuid,p_actor uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare c uuid;
begin
  select r.couple_id into c from public.deletion_requests r join public.couple_members m on m.couple_id=r.couple_id and m.user_id=p_actor
  where r.id=p_request and r.status='approved' and r.responded_by is not null and r.responded_by<>r.requested_by;
  if c is null then raise exception 'not_found'; end if;
  perform 1 from public.couples where id=c and status='deletion_approved' for update;
  if not found then raise exception 'not_found'; end if;
  if exists(select 1 from public.media where couple_id=c and upload_state='pending') then raise exception 'uploads_pending'; end if;
  return c;
end $$;
create function public.duet_finish_cleanup(p_request uuid,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare c uuid;
begin
  c:=public.duet_prepare_cleanup(p_request,p_actor);
  delete from public.couples where id=c and status='deletion_approved';
end $$;
revoke all on function public.duet_media_uploaded(uuid),public.duet_prepare_cleanup(uuid,uuid),public.duet_finish_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.duet_media_uploaded(uuid),public.duet_prepare_cleanup(uuid,uuid),public.duet_finish_cleanup(uuid,uuid) to service_role;

-- Keep all four 2,000-character answers in the fallback, including labels.
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check check(length(body)<=16000);
create or replace function public.duet_save_afterwork(p_nonce uuid,p_answers jsonb,p_summary text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); r uuid;
begin
  if length(p_summary) not between 1 and 16000 or p_summary is null then raise exception 'empty_message'; end if;
  insert into public.afterwork_checkins(couple_id,author_id,nonce,answers,summary) values(c,auth.uid(),p_nonce,p_answers,p_summary)
  on conflict(author_id,nonce) do update set nonce=excluded.nonce returning id into r;
  insert into public.messages(couple_id,sender_id,kind,body,metadata,dedupe_key)
    select c,auth.uid(),'afterwork',summary,jsonb_build_object('checkin_id',r),'afterwork:'||auth.uid()::text||':'||p_nonce::text from public.afterwork_checkins where id=r
    on conflict(couple_id,dedupe_key) do nothing;
  return r;
end $$;

create or replace function public.duet_request_deletion() returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); r uuid;
begin
  insert into public.deletion_requests(couple_id,requested_by) values(c,auth.uid()) on conflict(couple_id) where status='pending' do update set couple_id=excluded.couple_id returning id into r;
  insert into public.messages(couple_id,sender_id,kind,body,metadata,dedupe_key)
    values(c,auth.uid(),'share','发起了情侣空间注销请求，需要双方确认。',jsonb_build_object('type','deletion_request','request_id',r),'deletion:'||r::text)
    on conflict(couple_id,dedupe_key) do nothing;
  return r;
end $$;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.conversation_reads,public.deletion_requests;
  end if;
end $$;
