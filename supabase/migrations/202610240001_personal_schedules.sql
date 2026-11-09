-- Duet schedules are shared within a couple; only their owner may change them.
create table public.personal_schedules (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples on delete cascade,
  owner_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 200),
  note text not null default '' check(length(note)<=2000),
  starts_at timestamptz not null, ends_at timestamptz not null,
  timezone text not null,
  status text not null default 'active' check(status in ('active','cancelled')),
  updated_at timestamptz not null default now(),
  check(isfinite(starts_at) and isfinite(ends_at) and starts_at<ends_at),
  foreign key(couple_id,owner_id) references public.couple_members(couple_id,user_id) on delete cascade
);
create index personal_schedules_busy on public.personal_schedules(couple_id,starts_at,ends_at) where status='active';
alter table public.personal_schedules enable row level security;
revoke all on public.personal_schedules from public,anon,authenticated;
grant all on public.personal_schedules to service_role;
grant select on public.personal_schedules to authenticated;
create policy personal_schedules_read on public.personal_schedules for select to authenticated
  using(couple_id=private.current_couple());

create function private.validate_schedule(p_title text,p_start timestamptz,p_end timestamptz,p_timezone text,p_note text) returns void
language plpgsql stable set search_path='' as $$ begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_note is null or length(p_note)>2000
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end-p_start>interval '366 days'
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
    then raise exception 'invalid_schedule_input'; end if;
end $$;

create function public.duet_create_personal_schedule(p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result uuid;
begin
  perform 1 from public.couples where id=c for update;
  perform private.validate_schedule(p_title,p_starts_at,p_ends_at,p_timezone,p_note);
  insert into public.personal_schedules(couple_id,owner_id,title,starts_at,ends_at,timezone,note)
    values(c,auth.uid(),btrim(p_title),p_starts_at,p_ends_at,p_timezone,p_note) returning id into result;
  return result;
end $$;

create function public.duet_update_personal_schedule(p_id uuid,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  perform 1 from public.couples where id=c for update;
  perform private.validate_schedule(p_title,p_starts_at,p_ends_at,p_timezone,p_note);
  update public.personal_schedules set title=btrim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,
    timezone=p_timezone,note=p_note,updated_at=now()
    where id=p_id and couple_id=c and owner_id=auth.uid() and status='active';
  if not found then raise exception 'not_found'; end if;
end $$;

create function public.duet_cancel_personal_schedule(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  perform 1 from public.couples where id=c for update;
  update public.personal_schedules set status='cancelled',updated_at=now()
    where id=p_id and couple_id=c and owner_id=auth.uid() and status='active';
  if not found then raise exception 'not_found'; end if;
end $$;

create function private.validate_calendar_range(p_from timestamptz,p_to timestamptz) returns void
language plpgsql immutable set search_path='' as $$ begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from>=p_to or p_to-p_from>interval '366 days' then raise exception 'invalid_calendar_range'; end if;
end $$;

-- Only precise, still-live confirmed dates block time. Pending proposals and photos do not.
create function private.calendar_busy(p_couple uuid)
returns table(id uuid,owner_id uuid,starts_at timestamptz,ends_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
  select id,owner_id,starts_at,ends_at,updated_at from public.personal_schedules where couple_id=p_couple and status='active'
  union all
  select id,created_by,starts_at,ends_at,updated_at from public.date_proposals where couple_id=p_couple and status='completed' and entry_id is not null
$$;

create function public.duet_list_personal_schedules(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  perform private.validate_calendar_range(p_from,p_to);
  select coalesce(jsonb_agg(to_jsonb(s) order by starts_at,id),'[]'::jsonb) into result
    from public.personal_schedules s where couple_id=c and status='active' and starts_at<p_to and ends_at>p_from;
  return result;
end $$;

create function public.duet_common_free_time(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); cursor_at timestamptz:=p_from; b record; result jsonb:='[]'::jsonb;
begin
  perform private.validate_calendar_range(p_from,p_to);
  if (select count(*) from public.couple_members where couple_id=c)<>2 then return result; end if;
  for b in select starts_at,ends_at from private.calendar_busy(c) where starts_at<p_to and ends_at>p_from order by starts_at,ends_at loop
    if b.starts_at>cursor_at then result:=result||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',b.starts_at)); end if;
    cursor_at:=greatest(cursor_at,least(b.ends_at,p_to));
  end loop;
  if cursor_at<p_to then result:=result||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',p_to)); end if;
  return result;
end $$;

create or replace function private.valid_date_slot(p_couple uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select isfinite(p_start) and isfinite(p_end) and p_start>now() and p_end>p_start
    and (select count(*) from public.couple_members where couple_id=p_couple)=2
    and not exists(select 1 from private.calendar_busy(p_couple) b where b.starts_at<p_end and b.ends_at>p_start)
$$;

create or replace function private.date_context(p_couple uuid,p_wish_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare prefs jsonb; wishes jsonb; busy jsonb; members jsonb; window_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_wish_ids is null or cardinality(p_wish_ids)>20 or cardinality(p_wish_ids)<>(select count(distinct x) from unnest(p_wish_ids) x)
    or cardinality(p_wish_ids)<>(select count(*) from public.entries where id=any(p_wish_ids) and couple_id=p_couple and visibility='shared' and kind='wish') then raise exception 'invalid_date_wishes'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'body',body) order by id),'[]'::jsonb) into prefs from public.date_preferences where couple_id=p_couple;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'updated_at',updated_at) order by id),'[]'::jsonb) into wishes
    from public.entries where id=any(p_wish_ids) and couple_id=p_couple and visibility='shared' and kind='wish';
  select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]'::jsonb) into busy from private.calendar_busy(p_couple) b;
  select coalesce(jsonb_agg(user_id order by user_id),'[]'::jsonb) into members from public.couple_members where couple_id=p_couple;
  return jsonb_build_object('preferences',prefs,'wishes',wishes,'availability','[]'::jsonb,'busy',busy,'members',members,
    'window',jsonb_build_object('start',window_start,'end',window_start+interval '30 days'));
end $$;

revoke all on function private.validate_schedule(text,timestamptz,timestamptz,text,text),
  private.validate_calendar_range(timestamptz,timestamptz),private.calendar_busy(uuid) from public,anon,authenticated;
revoke all on function public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text),
  public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text),public.duet_cancel_personal_schedule(uuid),
  public.duet_list_personal_schedules(timestamptz,timestamptz),public.duet_common_free_time(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text),
  public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text),public.duet_cancel_personal_schedule(uuid),
  public.duet_list_personal_schedules(timestamptz,timestamptz),public.duet_common_free_time(timestamptz,timestamptz) to authenticated;
