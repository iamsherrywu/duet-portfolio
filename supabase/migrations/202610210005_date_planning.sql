create table public.date_preferences (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  owner_id uuid not null, body text not null check(length(btrim(body)) between 1 and 1000),
  source_message_id uuid references public.agent_messages on delete set null, created_at timestamptz not null default now(),
  foreign key(couple_id,owner_id) references public.couple_members(couple_id,user_id) on delete cascade
);
create table public.date_availability (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  owner_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null,
  timezone text not null, expires_at timestamptz not null, created_at timestamptz not null default now(),
  check(starts_at<ends_at), foreign key(couple_id,owner_id) references public.couple_members(couple_id,user_id) on delete cascade
);
create index date_availability_active on public.date_availability(couple_id,expires_at,ends_at);
create table public.date_proposals (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  created_by uuid not null, kind text not null check(kind in ('todo','anniversary')),
  title text not null check(length(btrim(title)) between 1 and 200), starts_at timestamptz not null,
  ends_at timestamptz not null, timezone text not null, plan text not null check(length(btrim(plan)) between 1 and 7600),
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  version integer not null default 1 check(version>0), entry_id uuid unique references public.entries on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(starts_at<ends_at),
  foreign key(couple_id,created_by) references public.couple_members(couple_id,user_id) on delete cascade
);
create table public.date_proposal_confirmations (
  proposal_id uuid not null references public.date_proposals on delete cascade,
  user_id uuid not null references auth.users on delete cascade, version integer not null,
  confirmed_at timestamptz not null default now(), primary key(proposal_id,user_id)
);

alter table public.date_preferences enable row level security;
alter table public.date_availability enable row level security;
alter table public.date_proposals enable row level security;
alter table public.date_proposal_confirmations enable row level security;
revoke all on public.date_preferences,public.date_availability,public.date_proposals,public.date_proposal_confirmations from public,anon,authenticated;
grant all on public.date_preferences,public.date_availability,public.date_proposals,public.date_proposal_confirmations to service_role;
grant select(id,couple_id,owner_id,body,created_at) on public.date_preferences to authenticated;
grant select on public.date_availability,public.date_proposals,public.date_proposal_confirmations to authenticated;
create policy date_preferences_read on public.date_preferences for select to authenticated using(couple_id=private.current_couple());
create policy date_availability_read on public.date_availability for select to authenticated using(couple_id=private.current_couple());
create policy date_proposals_read on public.date_proposals for select to authenticated using(couple_id=private.current_couple());
create policy date_confirmations_read on public.date_proposal_confirmations for select to authenticated using(exists(
  select 1 from public.date_proposals p where p.id=proposal_id and p.couple_id=private.current_couple()
));

create function public.duet_share_date_preference(p_body text,p_source uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result uuid;
begin
  perform 1 from public.couples where id=c for update;
  if p_body is null or length(btrim(p_body)) not between 1 and 1000 then raise exception 'invalid_date_input'; end if;
  if p_source is not null and not exists(select 1 from public.agent_messages where id=p_source and couple_id=c and owner_id=auth.uid() and visibility='askable') then raise exception 'invalid_date_source'; end if;
  if (select count(*) from public.date_preferences where couple_id=c and owner_id=auth.uid())>=50 then raise exception 'date_input_limit'; end if;
  insert into public.date_preferences(couple_id,owner_id,body,source_message_id) values(c,auth.uid(),btrim(p_body),p_source) returning id into result;
  return result;
end $$;

create function public.duet_delete_date_preference(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  perform 1 from public.couples where id=c for update;
  delete from public.date_preferences where id=p_id and couple_id=c and owner_id=auth.uid();
  if not found then raise exception 'not_found'; end if;
end $$;

create function public.duet_add_date_availability(p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result uuid;
begin
  perform 1 from public.couples where id=c for update;
  if p_starts_at is null or p_ends_at is null or p_expires_at is null or p_starts_at>=p_ends_at or p_ends_at<=now() or p_expires_at<=now()
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_date_input'; end if;
  if (select count(*) from public.date_availability where couple_id=c and owner_id=auth.uid() and expires_at>now() and ends_at>now())>=30 then raise exception 'date_input_limit'; end if;
  insert into public.date_availability(couple_id,owner_id,starts_at,ends_at,timezone,expires_at)
    values(c,auth.uid(),p_starts_at,p_ends_at,p_timezone,p_expires_at) returning id into result;
  return result;
end $$;

create function public.duet_delete_date_availability(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  perform 1 from public.couples where id=c for update;
  delete from public.date_availability where id=p_id and couple_id=c and owner_id=auth.uid();
  if not found then raise exception 'not_found'; end if;
end $$;

create function private.date_context(p_couple uuid,p_wish_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare prefs jsonb; slots jsonb; wishes jsonb;
begin
  if p_wish_ids is null or cardinality(p_wish_ids)>20 or cardinality(p_wish_ids)<>(select count(distinct x) from unnest(p_wish_ids) x)
    or cardinality(p_wish_ids)<>(select count(*) from public.entries where id=any(p_wish_ids) and couple_id=p_couple and visibility='shared' and kind='wish') then raise exception 'invalid_date_wishes'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'body',body) order by id),'[]'::jsonb) into prefs from public.date_preferences where couple_id=p_couple;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'starts_at',starts_at,'ends_at',ends_at,'timezone',timezone,'expires_at',expires_at) order by id),'[]'::jsonb) into slots
    from public.date_availability where couple_id=p_couple and expires_at>now() and ends_at>now();
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'updated_at',updated_at) order by id),'[]'::jsonb) into wishes
    from public.entries where id=any(p_wish_ids) and couple_id=p_couple and visibility='shared' and kind='wish';
  return jsonb_build_object('preferences',prefs,'availability',slots,'wishes',wishes);
end $$;
revoke all on function private.date_context(uuid,uuid[]) from public,anon,authenticated;

create function public.duet_get_date_context(p_wish_ids uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); context jsonb;
begin
  context:=private.date_context(c,p_wish_ids);
  return context||jsonb_build_object('hash',md5(context::text));
end $$;

create function private.valid_date_slot(p_couple uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select p_start>now() and p_end>p_start
    and (select count(*) from public.couple_members where couple_id=p_couple)=2
    and (select count(distinct owner_id) from public.date_availability where couple_id=p_couple
      and starts_at<=p_start and ends_at>=p_end and expires_at>now())=2
$$;
revoke all on function private.valid_date_slot(uuid,timestamptz,timestamptz) from public,anon,authenticated;

create function private.validate_date_plan(p_kind text,p_title text,p_start timestamptz,p_end timestamptz,p_timezone text,p_plan text,p_couple uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_kind is null or p_kind not in ('todo','anniversary') or p_title is null or length(btrim(p_title)) not between 1 and 200
    or p_plan is null or length(btrim(p_plan)) not between 1 and 7600 or p_start is null or p_end is null
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_date_input'; end if;
  if not coalesce(private.valid_date_slot(p_couple,p_start,p_end),false) then raise exception 'no_common_availability'; end if;
end $$;
revoke all on function private.validate_date_plan(text,text,timestamptz,timestamptz,text,text,uuid) from public,anon,authenticated;

create function public.duet_create_date_proposal(p_kind text,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_plan text,p_context_hash text,p_wish_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result uuid; context jsonb;
begin
  perform 1 from public.couples where id=c for update;
  context:=private.date_context(c,p_wish_ids);
  if md5(context::text) is distinct from p_context_hash then raise exception 'date_context_changed'; end if;
  perform private.validate_date_plan(p_kind,p_title,p_starts_at,p_ends_at,p_timezone,p_plan,c);
  insert into public.date_proposals(couple_id,created_by,kind,title,starts_at,ends_at,timezone,plan)
    values(c,auth.uid(),p_kind,btrim(p_title),p_starts_at,p_ends_at,p_timezone,btrim(p_plan)) returning id into result;
  return result;
end $$;

create function public.duet_edit_date_proposal(p_id uuid,p_version integer,p_kind text,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_plan text) returns integer
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); p public.date_proposals;
begin
  perform 1 from public.couples where id=c for update;
  select * into p from public.date_proposals where id=p_id and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if p.version is distinct from p_version then raise exception 'stale_proposal'; end if;
  if p.status<>'pending' then raise exception 'proposal_not_pending'; end if;
  perform private.validate_date_plan(p_kind,p_title,p_starts_at,p_ends_at,p_timezone,p_plan,c);
  update public.date_proposals set kind=p_kind,title=btrim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,timezone=p_timezone,plan=btrim(p_plan),version=version+1,updated_at=now() where id=p_id;
  delete from public.date_proposal_confirmations where proposal_id=p_id;
  return p.version+1;
end $$;

create function public.duet_confirm_date_proposal(p_id uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); p public.date_proposals; result uuid;
begin
  perform 1 from public.couples where id=c for update;
  select * into p from public.date_proposals where id=p_id and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if p.version is distinct from p_version then raise exception 'stale_proposal'; end if;
  if p.status='completed' then return jsonb_build_object('status',p.status,'entry_id',p.entry_id,'version',p.version); end if;
  if p.status<>'pending' then raise exception 'proposal_not_pending'; end if;
  perform private.validate_date_plan(p.kind,p.title,p.starts_at,p.ends_at,p.timezone,p.plan,c);
  insert into public.date_proposal_confirmations(proposal_id,user_id,version) values(p.id,auth.uid(),p.version) on conflict do nothing;
  if (select count(*) from public.date_proposal_confirmations f join public.couple_members m on m.user_id=f.user_id and m.couple_id=c where f.proposal_id=p.id and f.version=p.version)=2 then
    insert into public.entries(couple_id,author_id,kind,title,body,visibility,event_date)
      values(c,p.created_by,p.kind,p.title,p.plan||E'\n时间：'||to_char(p.starts_at at time zone p.timezone,'YYYY-MM-DD HH24:MI')||'–'||to_char(p.ends_at at time zone p.timezone,'YYYY-MM-DD HH24:MI')||' ('||p.timezone||')','shared',(p.starts_at at time zone p.timezone)::date) returning id into result;
    update public.date_proposals set status='completed',entry_id=result,updated_at=now() where id=p.id;
    return jsonb_build_object('status','completed','entry_id',result,'version',p.version);
  end if;
  return jsonb_build_object('status','pending','entry_id',null,'version',p.version);
end $$;

create function public.duet_cancel_date_proposal(p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); p public.date_proposals;
begin
  perform 1 from public.couples where id=c for update;
  select * into p from public.date_proposals where id=p_id and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if p.version is distinct from p_version then raise exception 'stale_proposal'; end if;
  if p.status='completed' then raise exception 'proposal_not_pending'; end if;
  update public.date_proposals set status='cancelled',updated_at=now() where id=p_id;
end $$;

create function public.duet_list_date_proposals() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('confirmed_by',coalesce((select jsonb_agg(f.user_id order by f.user_id) from public.date_proposal_confirmations f where f.proposal_id=p.id and f.version=p.version),'[]'::jsonb)) order by p.created_at desc,p.id),'[]'::jsonb) into result
    from (select * from public.date_proposals where couple_id=c order by created_at desc,id limit 100) p;
  return result;
end $$;

revoke all on function public.duet_share_date_preference(text,uuid),public.duet_delete_date_preference(uuid),
  public.duet_add_date_availability(timestamptz,timestamptz,text,timestamptz),public.duet_delete_date_availability(uuid),
  public.duet_get_date_context(uuid[]),public.duet_create_date_proposal(text,text,timestamptz,timestamptz,text,text,text,uuid[]),
  public.duet_edit_date_proposal(uuid,integer,text,text,timestamptz,timestamptz,text,text),public.duet_confirm_date_proposal(uuid,integer),
  public.duet_cancel_date_proposal(uuid,integer),public.duet_list_date_proposals() from public,anon,authenticated;
grant execute on function public.duet_share_date_preference(text,uuid),public.duet_delete_date_preference(uuid),
  public.duet_add_date_availability(timestamptz,timestamptz,text,timestamptz),public.duet_delete_date_availability(uuid),
  public.duet_get_date_context(uuid[]),public.duet_create_date_proposal(text,text,timestamptz,timestamptz,text,text,text,uuid[]),
  public.duet_edit_date_proposal(uuid,integer,text,text,timestamptz,timestamptz,text,text),public.duet_confirm_date_proposal(uuid,integer),
  public.duet_cancel_date_proposal(uuid,integer),public.duet_list_date_proposals() to authenticated;
