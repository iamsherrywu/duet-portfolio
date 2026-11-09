-- Add a constrained sharing duration and atomically refresh location when a story is posted.
create function public.duet_start_location_share_for_duration(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_expires_at timestamptz;
begin
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
    or p_duration_minutes is null or p_duration_minutes not in (30,60)
  then raise exception 'invalid_location'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,94102));
  perform 1 from public.couples where id=c and status='active' for update;
  if not found then raise exception 'space_inactive'; end if;

  delete from public.location_shares where couple_id=c and user_id=auth.uid() and expires_at<=now();
  if exists(select 1 from public.location_shares where couple_id=c and user_id=auth.uid() and expires_at>now()) then
    raise exception 'already_sharing';
  end if;

  insert into public.location_shares(couple_id,user_id,latitude,longitude,accuracy_m,expires_at,updated_at)
  values(c,auth.uid(),p_latitude,p_longitude,p_accuracy_m,now()+pg_catalog.make_interval(mins=>p_duration_minutes),pg_catalog.clock_timestamp())
  returning expires_at into v_expires_at;
  return jsonb_build_object('expires_at',v_expires_at);
end $$;

revoke all on function public.duet_start_location_share_for_duration(double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.duet_start_location_share_for_duration(double precision,double precision,double precision,integer) to authenticated;

create function public.duet_create_location_story(
  p_media uuid,
  p_caption text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  v_sent_at timestamptz:=pg_catalog.clock_timestamp();
  v_expires_at timestamptz;
  v_story_expires_at timestamptz;
  v_snap uuid;
  v_caption text:=nullif(btrim(p_caption),'');
begin
  if p_media is null or (p_caption is not null and length(p_caption)>500)
    or p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
    or p_duration_minutes is null or p_duration_minutes not in (30,60)
  then raise exception 'invalid_story'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,94102));
  perform 1 from public.couples where id=c and status='active' for update;
  if not found then raise exception 'space_inactive'; end if;
  if not exists(select 1 from public.media where id=p_media and couple_id=c and owner_id=auth.uid() and purpose='story' and upload_state='ready') then
    raise exception 'not_found';
  end if;

  v_expires_at:=v_sent_at+pg_catalog.make_interval(mins=>p_duration_minutes);
  insert into public.location_shares(couple_id,user_id,latitude,longitude,accuracy_m,expires_at,updated_at)
  values(c,auth.uid(),p_latitude,p_longitude,p_accuracy_m,v_expires_at,v_sent_at)
  on conflict(couple_id,user_id) do update set
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    accuracy_m=excluded.accuracy_m,
    expires_at=excluded.expires_at,
    updated_at=excluded.updated_at;

  v_story_expires_at:=v_sent_at+interval '24 hours';
  insert into public.location_snaps(couple_id,author_id,media_id,caption,sent_at,expires_at,latitude,longitude)
  values(c,auth.uid(),p_media,v_caption,v_sent_at,v_story_expires_at,p_latitude,p_longitude)
  returning id into v_snap;

  return jsonb_build_object(
    'id',v_snap,'caption',v_caption,'sent_at',v_sent_at,'expires_at',v_story_expires_at,
    'latitude',p_latitude,'longitude',p_longitude,'location_expires_at',v_expires_at
  );
end $$;

revoke all on function public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer) to authenticated;

notify pgrst,'reload schema';
