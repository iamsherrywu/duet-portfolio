-- Store only the latest location for each member; no route history is kept.
create table public.location_shares (
  couple_id uuid not null,
  user_id uuid not null,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision not null check(accuracy_m between 0 and 100000),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(couple_id,user_id),
  foreign key(couple_id,user_id) references public.couple_members(couple_id,user_id) on delete cascade
);
create index location_shares_expiry on public.location_shares(expires_at);

alter table public.location_shares enable row level security;
revoke all on public.location_shares from public,anon,authenticated;
grant select on public.location_shares to authenticated;
grant all on public.location_shares to service_role;
create policy location_share_read on public.location_shares for select to authenticated using(
  private.is_member(couple_id) and expires_at>now()
);

create function public.duet_start_location_share(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_expires_at timestamptz;
begin
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
  then raise exception 'invalid_location'; end if;

  -- Serialize concurrent starts for this user so a retry cannot extend a live session.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,94102));
  perform 1 from public.couples where id=c and status='active' for update;
  if not found then raise exception 'space_inactive'; end if;

  delete from public.location_shares where couple_id=c and user_id=auth.uid() and expires_at<=now();
  if exists(select 1 from public.location_shares where couple_id=c and user_id=auth.uid() and expires_at>now()) then
    raise exception 'already_sharing';
  end if;

  insert into public.location_shares(couple_id,user_id,latitude,longitude,accuracy_m,expires_at,updated_at)
  values(c,auth.uid(),p_latitude,p_longitude,p_accuracy_m,now()+interval '1 hour',pg_catalog.clock_timestamp())
  returning expires_at into v_expires_at;
  return jsonb_build_object('expires_at',v_expires_at);
end $$;

create function public.duet_update_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
) returns void language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_share public.location_shares;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
  then raise exception 'invalid_location'; end if;

  select * into v_share from public.location_shares
  where couple_id=c and user_id=auth.uid() for update;
  if not found then
    if exists(select 1 from public.location_shares where couple_id=c and user_id=auth.uid() and expires_at<=v_now) then
      raise exception 'location_expired';
    end if;
    raise exception 'location_not_active';
  end if;
  if v_share.expires_at<=v_now then raise exception 'location_expired'; end if;
  if v_share.updated_at>v_now-interval '10 seconds' then raise exception 'location_rate_limited'; end if;

  update public.location_shares set latitude=p_latitude,longitude=p_longitude,
    accuracy_m=p_accuracy_m,updated_at=v_now
  where couple_id=c and user_id=auth.uid();
end $$;

create function public.duet_stop_location_share() returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  delete from public.location_shares where couple_id=c and user_id=auth.uid();
end $$;

create function public.duet_list_location_shares() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_shares jsonb;
begin
  delete from public.location_shares where couple_id=c and expires_at<=now();
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',user_id,
    'latitude',latitude,
    'longitude',longitude,
    'accuracy_m',accuracy_m,
    'expires_at',expires_at,
    'updated_at',updated_at
  ) order by user_id),'[]'::jsonb)
  into v_shares
  from public.location_shares where couple_id=c and expires_at>now();
  return v_shares;
end $$;

create function public.duet_prune_expired_location_shares() returns integer
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  delete from public.location_shares where expires_at<=now();
  get diagnostics v_count=row_count;
  return v_count;
end $$;

revoke all on function public.duet_start_location_share(double precision,double precision,double precision),
  public.duet_update_location(double precision,double precision,double precision),
  public.duet_stop_location_share(),public.duet_list_location_shares(),
  public.duet_prune_expired_location_shares() from public,anon,authenticated;
grant execute on function public.duet_start_location_share(double precision,double precision,double precision),
  public.duet_update_location(double precision,double precision,double precision),
  public.duet_stop_location_share(),public.duet_list_location_shares() to authenticated;
grant execute on function public.duet_prune_expired_location_shares() to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.location_shares;
  end if;
end $$;

-- Supabase projects must enable pg_cron before applying this migration.
-- Dynamic SQL keeps local PGlite migration tests usable without that extension.
do $$
declare
  v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for v_job_id in execute 'select jobid from cron.job where jobname=$1' using 'duet-prune-expired-location-shares' loop
      execute 'select cron.unschedule($1)' using v_job_id;
    end loop;
    execute 'select cron.schedule($1,$2,$3)'
      using 'duet-prune-expired-location-shares','* * * * *','select public.duet_prune_expired_location_shares();';
  else
    raise notice 'Enable pg_cron in Supabase, then rerun this migration to schedule location cleanup.';
  end if;
end $$;
