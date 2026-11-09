create table public.location_snaps (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  author_id uuid not null references auth.users on delete cascade,
  media_id uuid not null unique references public.media(id) on delete cascade,
  caption text check(caption is null or length(caption)<=500),
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  saved_to_calendar_at timestamptz,
  calendar_date date,
  linked_entry_id uuid references public.entries(id) on delete set null,
  foreign key(couple_id,author_id) references public.couple_members(couple_id,user_id) on delete cascade,
  check((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)),
  check((saved_to_calendar_at is null)=(calendar_date is null))
);
create index location_snaps_couple_expiry on public.location_snaps(couple_id,expires_at,sent_at desc);
create index location_snaps_saved_calendar on public.location_snaps(couple_id,calendar_date) where saved_to_calendar_at is not null;

create table public.location_snap_views (
  snap_id uuid not null references public.location_snaps(id) on delete cascade,
  viewer_id uuid not null references auth.users on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(snap_id,viewer_id)
);

alter table public.location_snaps enable row level security;
alter table public.location_snap_views enable row level security;
revoke all on public.location_snaps,public.location_snap_views from public,anon,authenticated;
grant all on public.location_snaps,public.location_snap_views to service_role;
grant select on public.location_snaps to authenticated;
create policy location_snaps_read on public.location_snaps for select to authenticated using(
  private.is_member(couple_id) and (expires_at>now() or saved_to_calendar_at is not null)
);

create function private.can_read_story_media(p_media uuid,p_owner uuid,p_couple uuid,p_viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.location_snaps s
    where s.media_id=p_media and s.couple_id=p_couple
      and (s.expires_at>now() or s.saved_to_calendar_at is not null)
  ) or (p_viewer=p_owner and not exists(select 1 from public.location_snaps s where s.media_id=p_media))
$$;
revoke all on function private.can_read_story_media(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_story_media(uuid,uuid,uuid,uuid) to authenticated;

drop policy media_read on public.media;
create policy media_read on public.media for select to authenticated using(private.is_member(couple_id) and (
  (owner_id=auth.uid() and purpose<>'story')
  or (purpose='chat' and exists(select 1 from public.messages m where m.couple_id=media.couple_id and m.metadata->>'media_id'=media.id::text))
  or (purpose='memory' and exists(
    select 1 from public.entries e
    where e.couple_id=media.couple_id and e.visibility='shared'
      and (e.media_id=media.id or exists(select 1 from public.entry_media em where em.entry_id=e.id and em.media_id=media.id))
  ))
  or (purpose='feed' and exists(select 1 from public.daily_feeds f where f.couple_id=media.couple_id and f.kind='image' and f.content=media.id::text))
  or (purpose='song' and exists(select 1 from public.song_cards s where s.media_id=media.id))
  or (purpose='location_avatar' and private.can_read_location_avatar(media.id,media.owner_id,media.couple_id))
  or (purpose='story' and private.can_read_story_media(media.id,media.owner_id,media.couple_id,auth.uid()))
));

create function public.duet_create_location_snap(p_media uuid,p_caption text,p_with_location boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_sent_at timestamptz:=clock_timestamp();
  v_latitude double precision;
  v_longitude double precision;
  v_snap uuid;
begin
  if p_media is null or p_with_location is null or (p_caption is not null and length(p_caption)>500) then
    raise exception 'invalid_story';
  end if;
  if not exists(select 1 from public.media where id=p_media and couple_id=c and owner_id=auth.uid() and purpose='story' and upload_state='ready') then
    raise exception 'not_found';
  end if;

  if p_with_location then
    select latitude,longitude into v_latitude,v_longitude from public.location_shares
      where couple_id=c and user_id=auth.uid() and expires_at>v_sent_at and updated_at>=v_sent_at-interval '5 minutes';
    if not found then raise exception 'location_not_fresh'; end if;
  end if;

  insert into public.location_snaps(couple_id,author_id,media_id,caption,sent_at,expires_at,latitude,longitude)
    values(c,auth.uid(),p_media,nullif(btrim(p_caption),''),v_sent_at,v_sent_at+interval '24 hours',v_latitude,v_longitude)
    returning id into v_snap;
  return jsonb_build_object('id',v_snap,'caption',nullif(btrim(p_caption),''),'sent_at',v_sent_at,'expires_at',v_sent_at+interval '24 hours','latitude',v_latitude,'longitude',v_longitude);
end $$;

create function public.duet_list_location_snaps(p_scope text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  if p_scope is null or p_scope not in ('chat','map') then raise exception 'invalid_story_scope'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'author_id',s.author_id,'media_id',s.media_id,'caption',s.caption,
    'sent_at',s.sent_at,'expires_at',s.expires_at,'latitude',s.latitude,'longitude',s.longitude,
    'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,
    'linked_entry_id',case when exists(select 1 from public.entries e where e.id=s.linked_entry_id and e.couple_id=c and e.visibility='shared' and e.event_date is not null) then s.linked_entry_id else null end,
    'is_viewed',s.author_id=auth.uid() or exists(select 1 from public.location_snap_views v where v.snap_id=s.id and v.viewer_id=auth.uid())
  ) order by s.sent_at desc,s.id),'[]'::jsonb) into result
  from public.location_snaps s
  where s.couple_id=c and s.expires_at>now() and (p_scope='chat' or s.latitude is not null);
  return result;
end $$;

create function public.duet_get_location_snap(p_snap uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s public.location_snaps;
begin
  select * into s from public.location_snaps where id=p_snap and couple_id=c
    and (expires_at>now() or saved_to_calendar_at is not null);
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'id',s.id,'author_id',s.author_id,'media_id',s.media_id,'caption',s.caption,
    'sent_at',s.sent_at,'expires_at',s.expires_at,'latitude',s.latitude,'longitude',s.longitude,
    'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,
    'linked_entry_id',case when exists(select 1 from public.entries e where e.id=s.linked_entry_id and e.couple_id=c and e.visibility='shared' and e.event_date is not null) then s.linked_entry_id else null end,
    'is_viewed',s.author_id=auth.uid() or exists(select 1 from public.location_snap_views v where v.snap_id=s.id and v.viewer_id=auth.uid())
  );
end $$;

create function public.duet_mark_location_snap_viewed(p_snap uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if not exists(select 1 from public.location_snaps where id=p_snap and couple_id=c and expires_at>now()) then raise exception 'not_found'; end if;
  insert into public.location_snap_views(snap_id,viewer_id) values(p_snap,auth.uid()) on conflict(snap_id,viewer_id) do nothing;
end $$;

create function public.duet_save_location_snap(p_snap uuid,p_linked_entry uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s public.location_snaps; tz text; v_calendar_date date; v_saved_at timestamptz:=clock_timestamp();
begin
  select * into s from public.location_snaps where id=p_snap and couple_id=c for update;
  if not found or s.expires_at<=v_saved_at then raise exception 'not_found'; end if;
  if s.author_id<>auth.uid() then raise exception 'not_story_author'; end if;
  if s.saved_to_calendar_at is not null then
    if s.linked_entry_id is distinct from p_linked_entry then raise exception 'already_saved'; end if;
    return jsonb_build_object('id',s.id,'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,'linked_entry_id',s.linked_entry_id);
  end if;
  if p_linked_entry is not null and not exists(
    select 1 from public.entries e where e.id=p_linked_entry and e.couple_id=c and e.visibility='shared' and e.event_date is not null
  ) then raise exception 'invalid_calendar_entry'; end if;
  select timezone into tz from public.profiles where id=auth.uid();
  v_calendar_date:=(s.sent_at at time zone coalesce(tz,'Asia/Shanghai'))::date;
  update public.location_snaps set saved_to_calendar_at=v_saved_at,calendar_date=v_calendar_date,linked_entry_id=p_linked_entry
    where id=s.id;
  return jsonb_build_object('id',s.id,'saved_to_calendar_at',v_saved_at,'calendar_date',v_calendar_date,'linked_entry_id',p_linked_entry);
end $$;

-- Service role removes the Storage object first; this RPC then deletes only still-expired,
-- still-unsaved story media. A failed Storage removal leaves all metadata available to retry.
create function public.duet_delete_expired_location_snaps(p_snap_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_snap_ids is null or cardinality(p_snap_ids)=0 then return 0; end if;
  delete from public.media m where m.purpose='story' and m.id in(
    select s.media_id from public.location_snaps s
    where s.id=any(p_snap_ids) and s.expires_at<=now() and s.saved_to_calendar_at is null
  );
  get diagnostics n=row_count;
  return n;
end $$;

create or replace function public.duet_send_message(p_kind text,p_body text,p_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); m uuid; media uuid; story uuid;
begin
  if p_kind not in ('text','emoji','image','share') then raise exception 'invalid_message_kind'; end if;
  if p_kind<>'image' and length(btrim(p_body))=0 then raise exception 'empty_message'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'invalid_message_metadata'; end if;
  if p_kind='image' then
    if p_metadata ? 'story_id' then raise exception 'invalid_message_metadata'; end if;
    media:=(p_metadata->>'media_id')::uuid;
    if not exists(select 1 from public.media where id=media and couple_id=c and owner_id=auth.uid() and purpose='chat') then raise exception 'not_found'; end if;
    p_metadata:=jsonb_build_object('media_id',media);
  elsif p_metadata ? 'story_id' then
    if p_kind not in ('text','emoji','share') then raise exception 'invalid_message_metadata'; end if;
    story:=(p_metadata->>'story_id')::uuid;
    if p_metadata<>jsonb_build_object('story_id',story) then raise exception 'invalid_message_metadata'; end if;
    if not exists(select 1 from public.location_snaps where id=story and couple_id=c and expires_at>now()) then raise exception 'not_found'; end if;
    p_metadata:=jsonb_build_object('story_id',story);
  else p_metadata:='{}'; end if;
  insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),p_kind,p_body,p_metadata) returning id into m;
  return m;
end $$;

revoke all on function public.duet_create_location_snap(uuid,text,boolean),
  public.duet_list_location_snaps(text),public.duet_get_location_snap(uuid),
  public.duet_mark_location_snap_viewed(uuid),public.duet_save_location_snap(uuid,uuid),
  public.duet_delete_expired_location_snaps(uuid[]) from public,anon,authenticated;
grant execute on function public.duet_create_location_snap(uuid,text,boolean),
  public.duet_list_location_snaps(text),public.duet_get_location_snap(uuid),
  public.duet_mark_location_snap_viewed(uuid),public.duet_save_location_snap(uuid,uuid)
  to authenticated;
grant execute on function public.duet_delete_expired_location_snaps(uuid[]) to service_role;
revoke all on function private.can_read_story_media(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_story_media(uuid,uuid,uuid,uuid) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.location_snaps;
  end if;
end $$;

