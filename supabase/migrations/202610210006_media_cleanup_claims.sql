-- Storage deletion is outside PostgreSQL. Claim first, then delete objects, then
-- finish metadata deletion. Binding/saving locks the same media row and rejects
-- claims, so a cleanup snapshot cannot destroy a successfully saved photo.
alter table public.media add column cleanup_claimed_at timestamptz,
  add column detached_at timestamptz not null default clock_timestamp();

create function private.guard_story_media_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.media where id=new.media_id and cleanup_claimed_at is null for update;
  if not found then raise exception 'media_cleanup'; end if;
  if tg_op='UPDATE' and new.saved_to_calendar_at is not null and old.saved_to_calendar_at is null then
    if new.expires_at<=clock_timestamp() then raise exception 'not_found'; end if;
    new.saved_to_calendar_at:=clock_timestamp();
  end if;
  return new;
end $$;
create trigger guard_story_binding before insert on public.location_snaps
  for each row execute function private.guard_story_media_lifecycle();
create trigger guard_story_save before update of saved_to_calendar_at on public.location_snaps
  for each row execute function private.guard_story_media_lifecycle();

create function private.guard_avatar_media_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.location_avatar_media_id is not distinct from old.location_avatar_media_id then return new; end if;
  if old.location_avatar_media_id is not null then
    update public.media set detached_at=clock_timestamp() where id=old.location_avatar_media_id;
  end if;
  if new.location_avatar_media_id is not null then
    perform 1 from public.media where id=new.location_avatar_media_id and cleanup_claimed_at is null for update;
    if not found then raise exception 'media_cleanup'; end if;
  end if;
  return new;
end $$;
create trigger guard_avatar_binding before update of location_avatar_media_id on public.profiles
  for each row execute function private.guard_avatar_media_lifecycle();
revoke all on function private.guard_story_media_lifecycle(),private.guard_avatar_media_lifecycle() from public,anon,authenticated;

create function public.duet_claim_media_cleanup()
returns table(media_id uuid,path text)
language plpgsql security definer set search_path='' as $$
declare candidate public.media; snap public.location_snaps; eligible boolean;
begin
  for candidate in
    select m.* from public.media m where m.purpose in ('story','location_avatar') and m.upload_state='ready'
      and (m.cleanup_claimed_at is null or m.cleanup_claimed_at<clock_timestamp()-interval '5 minutes')
      and (
        (m.purpose='story' and (
          exists(select 1 from public.location_snaps s where s.media_id=m.id and s.expires_at<=clock_timestamp() and s.saved_to_calendar_at is null)
          or (m.detached_at<clock_timestamp()-interval '24 hours' and not exists(select 1 from public.location_snaps s where s.media_id=m.id))
        )) or (m.purpose='location_avatar' and m.detached_at<clock_timestamp()-interval '24 hours'
          and not exists(select 1 from public.profiles p where p.location_avatar_media_id=m.id))
      )
    order by m.created_at,m.id limit 100 for update of m skip locked
  loop
    -- Fresh statements AFTER acquiring the media lock recheck committed refs.
    if candidate.purpose='story' then
      select * into snap from public.location_snaps s where s.media_id=candidate.id;
      if found then eligible:=snap.expires_at<=clock_timestamp() and snap.saved_to_calendar_at is null;
      else eligible:=candidate.detached_at<clock_timestamp()-interval '24 hours'; end if;
    else
      eligible:=candidate.detached_at<clock_timestamp()-interval '24 hours'
        and not exists(select 1 from public.profiles p where p.location_avatar_media_id=candidate.id);
    end if;
    if eligible then
      update public.media m set cleanup_claimed_at=clock_timestamp() where m.id=candidate.id;
      media_id:=candidate.id;path:=candidate.path;return next;
    end if;
  end loop;
end $$;

create function public.duet_finish_media_cleanup(p_media_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_media_ids is null or cardinality(p_media_ids)>100 then raise exception 'invalid_input'; end if;
  delete from public.media m where m.id=any(p_media_ids) and m.cleanup_claimed_at is not null
    and m.purpose in ('story','location_avatar')
    and not exists(select 1 from public.profiles p where p.location_avatar_media_id=m.id)
    and not exists(select 1 from public.location_snaps s where s.media_id=m.id and s.saved_to_calendar_at is not null);
  get diagnostics n=row_count;return n;
end $$;
revoke all on function public.duet_claim_media_cleanup(),public.duet_finish_media_cleanup(uuid[]) from public,anon,authenticated;
grant execute on function public.duet_claim_media_cleanup(),public.duet_finish_media_cleanup(uuid[]) to service_role;

create or replace function public.duet_save_location_snap(p_snap uuid,p_linked_entry uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s public.location_snaps; tz text; v_date date; v_saved timestamptz;
begin
  select * into s from public.location_snaps where id=p_snap and couple_id=c for update;
  v_saved:=clock_timestamp();
  if not found or s.expires_at<=v_saved then raise exception 'not_found'; end if;
  if s.author_id<>auth.uid() then raise exception 'not_story_author'; end if;
  if s.saved_to_calendar_at is not null then
    if s.linked_entry_id is distinct from p_linked_entry then raise exception 'already_saved'; end if;
    return jsonb_build_object('id',s.id,'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,'linked_entry_id',s.linked_entry_id);
  end if;
  if p_linked_entry is not null and not exists(select 1 from public.entries e where e.id=p_linked_entry and e.couple_id=c and e.visibility='shared' and e.event_date is not null) then raise exception 'invalid_calendar_entry'; end if;
  select timezone into tz from public.profiles where id=auth.uid();
  v_date:=(s.sent_at at time zone coalesce(tz,'Asia/Shanghai'))::date;
  update public.location_snaps set saved_to_calendar_at=v_saved,calendar_date=v_date,linked_entry_id=p_linked_entry where id=s.id
    returning saved_to_calendar_at into v_saved;
  return jsonb_build_object('id',s.id,'saved_to_calendar_at',v_saved,'calendar_date',v_date,'linked_entry_id',p_linked_entry);
end $$;
