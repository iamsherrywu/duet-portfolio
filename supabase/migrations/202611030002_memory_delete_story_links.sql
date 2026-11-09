-- Delete a memory and its author's linked Calendar saves in the same statement.
-- Independently saved photos, the other author's photos and other entry links
-- retain their own lifetimes. Physical media cleanup remains with the existing worker.
create function private.unsave_deleted_memory_stories() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.location_snaps
    set saved_to_calendar_at=null,calendar_date=null,linked_entry_id=null
    where linked_entry_id=old.id and couple_id=old.couple_id and author_id=old.author_id;
  return old;
end $$;
revoke all on function private.unsave_deleted_memory_stories() from public,anon,authenticated;

create trigger unsave_deleted_memory_stories
before delete on public.entries
for each row when (old.kind='memory')
execute function private.unsave_deleted_memory_stories();

-- Use the same lock order as entry deletion: entry, then snap, then media.
-- The key-share lock also prevents an entry disappearing between validation and
-- assigning the snap's foreign key. Existing author/expiry/cleanup checks remain.
create or replace function public.duet_save_location_snap(p_snap uuid,p_linked_entry uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s public.location_snaps; tz text; v_date date; v_saved timestamptz;
begin
  if p_linked_entry is not null then
    perform 1 from public.entries e
      where e.id=p_linked_entry and e.couple_id=c and e.visibility='shared' and e.event_date is not null
      for key share;
    if not found then raise exception 'invalid_calendar_entry'; end if;
  end if;
  select * into s from public.location_snaps where id=p_snap and couple_id=c for update;
  v_saved:=clock_timestamp();
  if not found or s.expires_at<=v_saved then raise exception 'not_found'; end if;
  if s.author_id<>auth.uid() then raise exception 'not_story_author'; end if;
  if s.saved_to_calendar_at is not null then
    if s.linked_entry_id is distinct from p_linked_entry then raise exception 'already_saved'; end if;
    return jsonb_build_object('id',s.id,'saved_to_calendar_at',s.saved_to_calendar_at,'calendar_date',s.calendar_date,'linked_entry_id',s.linked_entry_id);
  end if;
  select timezone into tz from public.profiles where id=auth.uid();
  v_date:=(s.sent_at at time zone coalesce(tz,'Asia/Shanghai'))::date;
  update public.location_snaps set saved_to_calendar_at=v_saved,calendar_date=v_date,linked_entry_id=p_linked_entry where id=s.id
    returning saved_to_calendar_at into v_saved;
  return jsonb_build_object('id',s.id,'saved_to_calendar_at',v_saved,'calendar_date',v_date,'linked_entry_id',p_linked_entry);
end $$;
