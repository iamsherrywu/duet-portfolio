alter table public.media drop constraint media_purpose_check;
alter table public.media add constraint media_purpose_check check(purpose in ('screenshot','song','chat','memory','feed'));
alter table public.entries add column media_id uuid references public.media;
create table public.afterwork_checkins (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  author_id uuid not null references auth.users, nonce uuid not null, answers jsonb not null, summary text not null,
  created_at timestamptz not null default now(), unique(author_id,nonce)
);
alter table public.afterwork_checkins enable row level security;
revoke all on public.afterwork_checkins from public,anon,authenticated;
grant select on public.afterwork_checkins to authenticated;
grant all on public.afterwork_checkins to service_role;
create policy own_checkin on public.afterwork_checkins for select to authenticated using(author_id=auth.uid());
create table private.auth_limits(key_hash text primary key,window_start timestamptz not null,count int not null);
grant all on private.auth_limits to service_role;

create function public.duet_register_media(p_purpose text,p_mime text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); m uuid:=gen_random_uuid(); path text;
begin
  path:=c::text||'/'||auth.uid()::text||'/'||m::text;
  insert into public.media(id,couple_id,owner_id,path,purpose,mime_type) values(m,c,auth.uid(),path,p_purpose,p_mime);
  return jsonb_build_object('id',m,'path',path);
end $$;
create function public.duet_save_afterwork(p_nonce uuid,p_answers jsonb,p_summary text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); r uuid;
begin
  if length(p_summary) not between 1 and 8000 or p_summary is null then raise exception 'empty_message'; end if;
  insert into public.afterwork_checkins(couple_id,author_id,nonce,answers,summary) values(c,auth.uid(),p_nonce,p_answers,p_summary)
  on conflict(author_id,nonce) do update set nonce=excluded.nonce returning id into r;
  insert into public.messages(couple_id,sender_id,kind,body,metadata,dedupe_key)
    select c,auth.uid(),'afterwork',summary,jsonb_build_object('checkin_id',r),'afterwork:'||auth.uid()::text||':'||p_nonce::text from public.afterwork_checkins where id=r
    on conflict(couple_id,dedupe_key) do nothing;
  return r;
end $$;
create function public.duet_list_boxes() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc),'[]') from (
    select b.id,b.sender_id,b.recipient_id,b.note,b.created_at,
      count(i.id) as total_count,count(i.opened_at) as opened_count
    from public.blind_boxes b left join public.blind_box_items i on i.box_id=b.id
    where b.couple_id=private.current_couple() group by b.id
  ) v
$$;
create function public.duet_set_entry_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  update public.entries set status=p_status,updated_at=now() where id=p_id and couple_id=c and kind in ('todo','wish') and (visibility='shared' or author_id=auth.uid());
  if not found then raise exception 'not_found'; end if;
end $$;
create function public.duet_update_profile(p_name text,p_timezone text,p_start time,p_end time) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if length(p_name)>40 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'invalid_profile'; end if;
  update public.profiles set display_name=p_name,timezone=p_timezone,afterwork_start=p_start,afterwork_end=p_end where id=auth.uid();
end $$;
create function public.duet_auth_rate(p_key_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare n int; w timestamptz:=date_trunc('minute',now());
begin
  insert into private.auth_limits(key_hash,window_start,count) values(p_key_hash,w,1)
  on conflict(key_hash) do update set window_start=excluded.window_start,count=case when private.auth_limits.window_start=excluded.window_start then private.auth_limits.count+1 else 1 end returning count into n;
  return n<=3;
end $$;

drop policy media_read on public.media;
create policy media_read on public.media for select to authenticated using(private.is_member(couple_id) and (
  owner_id=auth.uid()
  or (purpose='chat' and exists(select 1 from public.messages m where m.couple_id=media.couple_id and m.metadata->>'media_id'=media.id::text))
  or (purpose='memory' and exists(select 1 from public.entries e where e.media_id=media.id and e.visibility='shared'))
  or (purpose='feed' and exists(select 1 from public.daily_feeds f where f.couple_id=media.couple_id and f.kind='image' and f.content=media.id::text))
  or (purpose='song' and exists(select 1 from public.song_cards s where s.media_id=media.id))
));

-- Freeze normal access when both members approve deletion; the backend finalizer retains access.
create or replace function private.is_member(p_couple uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.couple_members m join public.couples c on c.id=m.couple_id where m.couple_id=p_couple and m.user_id=auth.uid() and c.status='active')
$$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('duet_register_media','duet_save_afterwork','duet_list_boxes','duet_set_entry_status','duet_update_profile') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to authenticated',f.sig);
  end loop;
end $$;
revoke all on function public.duet_auth_rate(text) from public,anon,authenticated;
grant execute on function public.duet_auth_rate(text) to service_role;
