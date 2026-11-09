create function public.duet_list_shared_calendar(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  shared_entries jsonb;
  saved_stories jsonb;
begin
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then
    raise exception 'invalid_calendar_range';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'kind',e.kind,'title',e.title,'body',e.body,'status',e.status,
    'event_date',e.event_date,'author_id',e.author_id,'updated_at',e.updated_at
  ) order by e.event_date,e.created_at,e.id),'[]'::jsonb)
    into shared_entries
  from public.entries e
  where e.couple_id=c and e.visibility='shared' and e.event_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'author_id',s.author_id,'media_id',s.media_id,'caption',s.caption,
    'sent_at',s.sent_at,'calendar_date',s.calendar_date,
    'linked_entry_id',case when exists(
      select 1 from public.entries e where e.id=s.linked_entry_id and e.couple_id=c
        and e.visibility='shared' and e.event_date is not null
    ) then s.linked_entry_id else null end
  ) order by s.calendar_date,s.sent_at,s.id),'[]'::jsonb)
    into saved_stories
  from public.location_snaps s
  where s.couple_id=c and s.saved_to_calendar_at is not null
    and s.calendar_date between p_from and p_to;

  return jsonb_build_object('entries',shared_entries,'stories',saved_stories);
end $$;

revoke all on function public.duet_list_shared_calendar(date,date) from public,anon,authenticated;
grant execute on function public.duet_list_shared_calendar(date,date) to authenticated;
