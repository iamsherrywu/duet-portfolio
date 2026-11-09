-- A memory can contain multiple ordered photos while legacy entries.media_id remains valid.
create table public.entry_media (
  entry_id uuid not null references public.entries(id) on delete cascade,
  media_id uuid not null unique references public.media(id) on delete cascade,
  position smallint not null check(position between 0 and 19),
  primary key(entry_id,media_id),
  unique(entry_id,position)
);

-- Serialize legacy single-photo references and new grouped references so one
-- photo cannot be reused concurrently across the two storage formats.
create function private.prevent_memory_media_reuse() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  requested_media uuid:=new.media_id;
  owning_entry uuid;
begin
  if requested_media is null then return new; end if;
  if tg_table_name='entries' then owning_entry:=new.id;
  else owning_entry:=new.entry_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_media::text,0));

  if tg_table_name='entries' then
    if exists(select 1 from public.entries e where e.media_id=requested_media and e.id is distinct from owning_entry)
      or exists(select 1 from public.entry_media em where em.media_id=requested_media)
    then raise exception 'media_in_use' using errcode='23505'; end if;
  elsif exists(select 1 from public.entries e where e.media_id=requested_media) then
    raise exception 'media_in_use' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function private.prevent_memory_media_reuse() from public,anon,authenticated;

create trigger prevent_legacy_memory_media_reuse
before insert or update of media_id on public.entries
for each row execute function private.prevent_memory_media_reuse();
create trigger prevent_grouped_memory_media_reuse
before insert or update of media_id on public.entry_media
for each row execute function private.prevent_memory_media_reuse();

alter table public.entry_media enable row level security;
revoke all on public.entry_media from public,anon,authenticated;
grant select on public.entry_media to authenticated;
grant all on public.entry_media to service_role;

create policy entry_media_read on public.entry_media for select to authenticated using(
  exists(
    select 1 from public.entries e
    where e.id=entry_media.entry_id
      and private.is_member(e.couple_id)
      and (e.visibility='shared' or e.author_id=auth.uid())
  )
);

-- Keep legacy one-photo entries from reusing a photo already grouped elsewhere.
drop policy entry_insert on public.entries;
create policy entry_insert on public.entries for insert to authenticated with check(
  couple_id=private.current_couple() and author_id=auth.uid()
  and (media_id is null or (
    private.owns_media(media_id,couple_id,'memory')
    and not exists(select 1 from public.entry_media em where em.media_id=public.entries.media_id)
  ))
);
drop policy entry_update on public.entries;
create policy entry_update on public.entries for update to authenticated using(
  couple_id=private.current_couple() and author_id=auth.uid()
) with check(
  couple_id=private.current_couple() and author_id=auth.uid()
  and (media_id is null or (
    private.owns_media(media_id,couple_id,'memory')
    and not exists(select 1 from public.entry_media em where em.media_id=public.entries.media_id)
  ))
);

create or replace function public.duet_create_memory(
  p_title text,
  p_body text,
  p_visibility text,
  p_event_date date,
  p_media_ids uuid[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  r uuid;
  media_id uuid;
  lock_id uuid;
  item_position smallint:=0;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200
    or p_body is null or length(p_body)>8000
    or p_visibility is null or p_visibility not in ('shared','personal')
    or p_media_ids is null or cardinality(p_media_ids) not between 1 and 20
  then raise exception 'invalid_input' using errcode='23514'; end if;

  if exists(select 1 from unnest(p_media_ids) as ids(item) where item is null) then
    raise exception 'invalid_input' using errcode='23514';
  end if;
  if cardinality(p_media_ids)<>(select count(distinct item) from unnest(p_media_ids) as ids(item)) then
    raise exception 'duplicate_media' using errcode='23505';
  end if;

  -- Lock in stable order to prevent deadlocks when requests share photos.
  for lock_id in select item from unnest(p_media_ids) as ids(item) order by item loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_id::text,0));
  end loop;

  if exists (
    select 1
    from unnest(p_media_ids) as requested(id)
    left join public.media m on m.id=requested.id
      and m.owner_id=auth.uid() and m.couple_id=c and m.purpose='memory'
    where m.id is null
  ) then raise exception 'not_found'; end if;

  if exists(select 1 from public.entries e where e.media_id=any(p_media_ids))
    or exists(select 1 from public.entry_media em where em.media_id=any(p_media_ids))
  then raise exception 'media_in_use' using errcode='23505'; end if;

  insert into public.entries(couple_id,author_id,kind,title,body,visibility,event_date)
  values(c,auth.uid(),'memory',btrim(p_title),p_body,p_visibility,p_event_date)
  returning id into r;

  foreach media_id in array p_media_ids loop
    insert into public.entry_media(entry_id,media_id,position)
    values(r,media_id,item_position);
    item_position:=item_position+1;
  end loop;
  return r;
end $$;

revoke all on function public.duet_create_memory(text,text,text,date,uuid[]) from public,anon,authenticated;
grant execute on function public.duet_create_memory(text,text,text,date,uuid[]) to authenticated,service_role;

drop policy media_read on public.media;
create policy media_read on public.media for select to authenticated using(private.is_member(couple_id) and (
  owner_id=auth.uid()
  or (purpose='chat' and exists(select 1 from public.messages m where m.couple_id=media.couple_id and m.metadata->>'media_id'=media.id::text))
  or (purpose='memory' and exists(
    select 1 from public.entries e
    where e.couple_id=media.couple_id and e.visibility='shared'
      and (e.media_id=media.id or exists(select 1 from public.entry_media em where em.entry_id=e.id and em.media_id=media.id))
  ))
  or (purpose='feed' and exists(select 1 from public.daily_feeds f where f.couple_id=media.couple_id and f.kind='image' and f.content=media.id::text))
  or (purpose='song' and exists(select 1 from public.song_cards s where s.media_id=media.id))
));
