create table public.agent_threads (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  owner_id uuid not null unique references auth.users, confidential boolean not null default false,
  pending_turn uuid, pending_since timestamptz
);
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  thread_id uuid not null references public.agent_threads on delete cascade,
  owner_id uuid not null references auth.users, role text not null check(role in ('user','assistant')),
  body text not null check(length(body) between 1 and 16000),
  visibility text not null check(visibility in ('askable','confidential')),
  reply_to uuid unique references public.agent_messages on delete cascade,
  created_at timestamptz not null default now()
);
create index agent_history on public.agent_messages(thread_id,created_at,id);
alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
revoke all on public.agent_threads,public.agent_messages from anon,authenticated;
grant select on public.agent_threads,public.agent_messages to authenticated;
grant all on public.agent_threads,public.agent_messages to service_role;
create policy own_thread on public.agent_threads for select to authenticated using(owner_id=auth.uid());
create policy own_history on public.agent_messages for select to authenticated using(owner_id=auth.uid());

create function public.duet_agent_begin_turn(p_text text,p_private boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); t public.agent_threads; turn uuid; history jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
  insert into public.agent_threads(couple_id,owner_id) values(c,auth.uid()) on conflict(owner_id) do nothing;
  select * into t from public.agent_threads where owner_id=auth.uid() for update;
  if t.pending_turn is not null and t.pending_since>now()-interval '90 seconds' then raise exception 'turn_pending'; end if;
  if p_private is not null then update public.agent_threads set confidential=p_private where id=t.id; t.confidential:=p_private; end if;
  insert into public.agent_messages(couple_id,thread_id,owner_id,role,body,visibility)
  values(c,t.id,auth.uid(),'user',p_text,case when t.confidential then 'confidential' else 'askable' end) returning id into turn;
  update public.agent_threads set pending_turn=turn,pending_since=now() where id=t.id;
  -- A public turn never receives prior confidential messages, including assistant replies.
  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at,h.id),'[]') into history
  from (select id,role,body,created_at from public.agent_messages where thread_id=t.id
    and (t.confidential or visibility='askable') order by created_at desc,id desc limit 40) h;
  return jsonb_build_object('turn_id',turn,'confidential',t.confidential,'history',history);
end $$;

create function public.duet_agent_finish_turn(p_turn uuid,p_body text) returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.agent_messages; t public.agent_threads; reply uuid;
begin
  select * into m from public.agent_messages where id=p_turn and role='user';
  if m.id is null then raise exception 'not_found'; end if;
  select * into t from public.agent_threads where id=m.thread_id for update;
  if t.pending_turn is distinct from m.id then raise exception 'stale_turn'; end if;
  insert into public.agent_messages(couple_id,thread_id,owner_id,role,body,visibility,reply_to)
  values(m.couple_id,m.thread_id,m.owner_id,'assistant',p_body,m.visibility,m.id) returning id into reply;
  update public.agent_threads set pending_turn=null,pending_since=null where id=t.id;
  return reply;
end $$;
create function public.duet_agent_fail_turn(p_turn uuid) returns void language sql security invoker set search_path='' as $$
  update public.agent_threads set pending_turn=null,pending_since=null where pending_turn=p_turn
$$;
create function public.duet_partner_context(p_requester uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at,h.id),'[]') from (
    select a.id,a.body,a.created_at from public.agent_messages a
    join public.couple_members partner on partner.user_id=a.owner_id and partner.couple_id=a.couple_id
    join public.couple_members requester on requester.couple_id=partner.couple_id and requester.user_id=p_requester
    join public.couples c on c.id=requester.couple_id and c.status='active'
    where a.owner_id<>p_requester and a.visibility='askable' and a.role='user'
    order by a.created_at desc,a.id desc limit 40
  ) h
$$;
revoke all on function public.duet_agent_begin_turn(text,boolean) from public,anon,authenticated;
grant execute on function public.duet_agent_begin_turn(text,boolean) to authenticated;
revoke all on function public.duet_agent_finish_turn(uuid,text),public.duet_agent_fail_turn(uuid),public.duet_partner_context(uuid) from public,anon,authenticated;
grant execute on function public.duet_agent_finish_turn(uuid,text),public.duet_agent_fail_turn(uuid),public.duet_partner_context(uuid) to service_role;

-- Backend-only eligibility check; the API returns a generic response for all emails.
create function public.duet_login_allowed(p_email text,p_invite_hash text default null) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.creator_emails where email=lower(p_email))
    or exists(select 1 from auth.users u join public.couple_members m on m.user_id=u.id join public.couples c on c.id=m.couple_id where lower(u.email)=lower(p_email) and c.status='active')
    or exists(select 1 from public.invitations i join public.couples c on c.id=i.couple_id where i.token_hash=p_invite_hash and i.used_at is null and i.expires_at>now() and c.status='active'
      and (select count(*) from public.couple_members where couple_id=c.id)<2)
$$;
revoke all on function public.duet_login_allowed(text,text) from public,anon,authenticated;
grant usage on schema private,auth to service_role;
grant select on private.creator_emails,auth.users to service_role;
grant execute on function public.duet_login_allowed(text,text) to service_role;
