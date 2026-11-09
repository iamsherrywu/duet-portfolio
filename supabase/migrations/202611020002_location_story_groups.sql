create table public.location_story_groups (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  author_id uuid not null references auth.users on delete cascade,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  foreign key(couple_id,author_id) references public.couple_members(couple_id,user_id) on delete cascade,
  check(expires_at=sent_at+interval '24 hours'),
  check((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);

alter table public.location_story_groups enable row level security;
revoke all on public.location_story_groups from public,anon,authenticated;
grant all on public.location_story_groups to service_role;

alter table public.location_snaps
  add column story_group_id uuid,
  add column group_position smallint;

-- Keep existing stories readable by putting each existing photo into its own group.
insert into public.location_story_groups(id,couple_id,author_id,sent_at,expires_at,latitude,longitude)
select id,couple_id,author_id,sent_at,expires_at,latitude,longitude from public.location_snaps;
update public.location_snaps set story_group_id=id,group_position=1;

alter table public.location_snaps
  alter column story_group_id set not null,
  alter column group_position set not null,
  add constraint location_snaps_group_fk foreign key(story_group_id) references public.location_story_groups(id) on delete cascade,
  add constraint location_snaps_group_position_check check(group_position between 1 and 10),
  add constraint location_snaps_group_position_unique unique(story_group_id,group_position);
create index location_story_groups_couple_expiry on public.location_story_groups(couple_id,expires_at,sent_at desc);

create or replace function public.duet_create_location_story_group(
  p_media_ids uuid[],p_caption text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_sent_at timestamptz:=clock_timestamp();
  v_expires_at timestamptz;
  v_location_expires_at timestamptz;
  v_group uuid:=gen_random_uuid();
  v_snap uuid;
  v_media uuid;
  v_position smallint:=0;
  v_valid_media integer:=0;
  v_items jsonb:='[]'::jsonb;
begin
  if p_media_ids is null or cardinality(p_media_ids)<1 or cardinality(p_media_ids)>10
    or array_position(p_media_ids,null) is not null or p_caption is not null and length(p_caption)>500
    or (select count(distinct item) from unnest(p_media_ids) item)<>cardinality(p_media_ids)
  then raise exception 'invalid_story'; end if;

  if p_latitude is null and p_longitude is null and p_accuracy_m is null and p_duration_minutes is null then
    null;
  elsif p_latitude between -90 and 90 and p_longitude between -180 and 180
    and p_accuracy_m between 0 and 100000 and p_duration_minutes in (30,60)
  then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,94102));
    perform 1 from public.couples where id=c and status='active' for update;
    if not found then raise exception 'space_inactive'; end if;
  else raise exception 'invalid_story'; end if;

  for v_media in
    select m.id from public.media m where m.id=any(p_media_ids) and m.couple_id=c
      and m.owner_id=auth.uid() and m.purpose='story' and m.upload_state='ready'
    order by m.id for update
  loop
    v_valid_media:=v_valid_media+1;
  end loop;
  if v_valid_media<>cardinality(p_media_ids) then raise exception 'not_found'; end if;

  v_expires_at:=v_sent_at+interval '24 hours';
  if p_latitude is not null then
    v_location_expires_at:=v_sent_at+pg_catalog.make_interval(mins=>p_duration_minutes);
    insert into public.location_shares(couple_id,user_id,latitude,longitude,accuracy_m,expires_at,updated_at)
    values(c,auth.uid(),p_latitude,p_longitude,p_accuracy_m,v_location_expires_at,v_sent_at)
    on conflict(couple_id,user_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
      accuracy_m=excluded.accuracy_m,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  end if;

  insert into public.location_story_groups(id,couple_id,author_id,sent_at,expires_at,latitude,longitude)
  values(v_group,c,auth.uid(),v_sent_at,v_expires_at,p_latitude,p_longitude);

  foreach v_media in array p_media_ids loop
    v_position:=v_position+1;
    insert into public.location_snaps(couple_id,author_id,media_id,caption,sent_at,expires_at,latitude,longitude,story_group_id,group_position)
    values(c,auth.uid(),v_media,nullif(btrim(p_caption),''),v_sent_at,v_expires_at,p_latitude,p_longitude,v_group,v_position)
    returning id into v_snap;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',v_snap,'media_id',v_media,'group_position',v_position));
  end loop;

  return jsonb_build_object('group_id',v_group,'sent_at',v_sent_at,'expires_at',v_expires_at,
    'latitude',p_latitude,'longitude',p_longitude,'location_expires_at',v_location_expires_at,'items',v_items);
end $$;

-- Preserve both existing single-photo clients while storing their photo as a
-- one-item group under the new invariant.
create or replace function public.duet_create_location_snap(p_media uuid,p_caption text,p_with_location boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  result jsonb;
begin
  if p_with_location is null then raise exception 'invalid_story'; end if;
  if p_with_location then
    select latitude,longitude,accuracy_m into v_latitude,v_longitude,v_accuracy
      from public.location_shares where couple_id=c and user_id=auth.uid()
        and expires_at>clock_timestamp() and updated_at>=clock_timestamp()-interval '5 minutes';
    if not found then raise exception 'location_not_fresh'; end if;
  end if;
  result:=public.duet_create_location_story_group(array[p_media],p_caption,v_latitude,v_longitude,v_accuracy,
    case when p_with_location then 60 else null end);
  return jsonb_build_object('id',result #>> '{items,0,id}','group_id',result->'group_id',
    'caption',nullif(btrim(p_caption),''),'sent_at',result->'sent_at','expires_at',result->'expires_at',
    'latitude',result->'latitude','longitude',result->'longitude');
end $$;

create or replace function public.duet_create_location_story(
  p_media uuid,p_caption text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.duet_create_location_story_group(array[p_media],p_caption,p_latitude,p_longitude,p_accuracy_m,p_duration_minutes);
  return jsonb_build_object('id',result #>> '{items,0,id}','group_id',result->'group_id',
    'caption',nullif(btrim(p_caption),''),'sent_at',result->'sent_at','expires_at',result->'expires_at',
    'latitude',result->'latitude','longitude',result->'longitude','location_expires_at',result->'location_expires_at');
end $$;

create or replace function public.duet_list_location_snaps(p_scope text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  if p_scope is null or p_scope not in ('chat','map') then raise exception 'invalid_story_scope'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'author_id',s.author_id,'media_id',s.media_id,'caption',s.caption,
    'sent_at',g.sent_at,'expires_at',g.expires_at,'latitude',g.latitude,'longitude',g.longitude,
    'group_id',g.id,'group_position',s.group_position,
    'group_size',(select count(*) from public.location_snaps group_item where group_item.story_group_id=g.id),
    'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,
    'linked_entry_id',case when exists(select 1 from public.entries e where e.id=s.linked_entry_id and e.couple_id=c and e.visibility='shared' and e.event_date is not null) then s.linked_entry_id else null end,
    'is_viewed',s.author_id=auth.uid() or exists(select 1 from public.location_snap_views v where v.snap_id=s.id and v.viewer_id=auth.uid())
  ) order by g.sent_at desc,s.group_position,s.id),'[]'::jsonb) into result
  from public.location_snaps s join public.location_story_groups g on g.id=s.story_group_id
  where s.couple_id=c and s.expires_at>now() and g.expires_at>now() and (p_scope='chat' or g.latitude is not null);
  return result;
end $$;

create or replace function public.duet_get_location_snap(p_snap uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s public.location_snaps; g public.location_story_groups;
begin
  select * into s from public.location_snaps where id=p_snap and couple_id=c;
  if not found then raise exception 'not_found'; end if;
  select * into g from public.location_story_groups where id=s.story_group_id;
  if not found then raise exception 'not_found'; end if;
  if s.expires_at<=now() and s.saved_to_calendar_at is null then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'id',s.id,'author_id',s.author_id,'media_id',s.media_id,'caption',s.caption,
    'sent_at',g.sent_at,'expires_at',g.expires_at,'latitude',g.latitude,'longitude',g.longitude,
    'group_id',g.id,'group_position',s.group_position,
    'group_size',(select count(*) from public.location_snaps group_item where group_item.story_group_id=g.id),
    'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,
    'linked_entry_id',case when exists(select 1 from public.entries e where e.id=s.linked_entry_id and e.couple_id=c and e.visibility='shared' and e.event_date is not null) then s.linked_entry_id else null end,
    'is_viewed',s.author_id=auth.uid() or exists(select 1 from public.location_snap_views v where v.snap_id=s.id and v.viewer_id=auth.uid())
  );
end $$;

create or replace function public.duet_delete_expired_location_snaps(p_snap_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_snap_ids is null or cardinality(p_snap_ids)=0 then return 0; end if;
  delete from public.media m where m.purpose='story' and m.id in(
    select s.media_id from public.location_snaps s
    where s.id=any(p_snap_ids) and s.expires_at<=now() and s.saved_to_calendar_at is null
  );
  get diagnostics n=row_count;
  delete from public.location_story_groups g where g.expires_at<=now()
    and not exists(select 1 from public.location_snaps s where s.story_group_id=g.id);
  return n;
end $$;

revoke all on function public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer) to authenticated;
revoke all on function public.duet_create_location_snap(uuid,text,boolean),
  public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.duet_create_location_snap(uuid,text,boolean),
  public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer) to authenticated;
revoke all on function public.duet_delete_expired_location_snaps(uuid[]) from public,anon,authenticated;
grant execute on function public.duet_delete_expired_location_snaps(uuid[]) to service_role;

notify pgrst,'reload schema';
