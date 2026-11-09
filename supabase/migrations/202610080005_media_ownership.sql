-- Enforce reference ownership inside PostgreSQL, including direct Data API writes.
create function private.owns_media(p_media uuid,p_couple uuid,p_purpose text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media where id=p_media and couple_id=p_couple and owner_id=auth.uid() and purpose=p_purpose)
$$;
revoke all on function private.owns_media(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.owns_media(uuid,uuid,text) to authenticated;
drop policy entry_insert on public.entries;
drop policy entry_update on public.entries;
create policy entry_insert on public.entries for insert to authenticated with check(
  couple_id=private.current_couple() and author_id=auth.uid() and (media_id is null or private.owns_media(media_id,couple_id,'memory'))
);
create policy entry_update on public.entries for update to authenticated using(couple_id=private.current_couple() and author_id=auth.uid()) with check(
  couple_id=private.current_couple() and author_id=auth.uid() and (media_id is null or private.owns_media(media_id,couple_id,'memory'))
);
create function private.validate_feed_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind='image' and not exists(select 1 from public.media where id=new.content::uuid and owner_id=new.author_id and couple_id=new.couple_id and purpose='feed') then raise exception 'not_found'; end if;
  if new.kind='song' and not exists(select 1 from public.song_cards where id=new.content::uuid and created_by=new.author_id and couple_id=new.couple_id) then raise exception 'not_found'; end if;
  return new;
end $$;
revoke all on function private.validate_feed_media() from public,anon,authenticated;
create trigger validate_feed_media before insert on public.daily_feeds for each row execute function private.validate_feed_media();
drop policy song_read on public.song_cards;
create policy song_read on public.song_cards for select to authenticated using(private.is_member(couple_id) and (
  created_by=auth.uid()
  or exists(select 1 from public.blind_box_items i where i.song_id=song_cards.id and i.opened_at is not null and private.is_member(i.couple_id))
  or exists(select 1 from public.daily_feeds f where f.kind='song' and f.couple_id=song_cards.couple_id and f.content=song_cards.id::text)
));
