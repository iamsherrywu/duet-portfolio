-- Birthday is deliberately stored only in the private profile table. Authenticated
-- clients receive profile data through narrowly scoped RPCs that omit it.
alter table public.profiles
  add column gender text check(gender is null or gender in ('male','female','other','prefer_not_to_say')),
  add column birthday date,
  add column clown_role text check(clown_role is null or clown_role in ('clown_boy','clown_girl')),
  add column location_avatar_media_id uuid references public.media(id) on delete set null;

alter table public.media drop constraint media_purpose_check;
alter table public.media add constraint media_purpose_check
  check(purpose in ('screenshot','song','chat','memory','feed','location_avatar','story'));

drop policy profile_read on public.profiles;
revoke all on public.profiles from public,anon,authenticated;

create function public.duet_initialize_profile(
  p_display_name text,
  p_gender text,
  p_birthday date,
  p_clown_role text default null
) returns void language plpgsql security definer set search_path='' as $$
declare existing public.profiles;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 40
    or p_gender is null or p_gender not in ('male','female','other','prefer_not_to_say')
    or p_birthday is null or p_birthday>(now() at time zone 'Asia/Shanghai')::date
    or (p_clown_role is not null and p_clown_role not in ('clown_boy','clown_girl'))
    or (p_gender in ('other','prefer_not_to_say') and p_clown_role is null)
  then raise exception 'invalid_profile'; end if;

  select * into existing from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'profile_not_found'; end if;
  if existing.birthday is not null then
    if existing.display_name is distinct from btrim(p_display_name)
      or existing.gender is distinct from p_gender
      or existing.birthday is distinct from p_birthday
      or existing.clown_role is distinct from p_clown_role
    then raise exception 'profile_already_initialized'; end if;
    return;
  end if;

  update public.profiles
    set display_name=btrim(p_display_name), gender=p_gender, birthday=p_birthday, clown_role=p_clown_role
    where id=auth.uid();
end $$;

create function public.duet_get_my_profile() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,
    'display_name',p.display_name,
    'gender',p.gender,
    'clown_role',p.clown_role,
    'timezone',p.timezone,
    'afterwork_start',p.afterwork_start,
    'afterwork_end',p.afterwork_end,
    'location_avatar_media_id',p.location_avatar_media_id
  ) from public.profiles p where p.id=auth.uid()
$$;

create function public.duet_list_couple_profiles() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'display_name',p.display_name,
    'gender',p.gender,
    'clown_role',p.clown_role,
    'timezone',p.timezone,
    'afterwork_start',p.afterwork_start,
    'afterwork_end',p.afterwork_end,
    'location_avatar_media_id',p.location_avatar_media_id
  ) order by m.slot),'[]'::jsonb)
  into result
  from public.couple_members m join public.profiles p on p.id=m.user_id
  where m.couple_id=c;
  return result;
end $$;

create function public.duet_set_location_avatar(p_media uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if p_media is not null and not exists(
    select 1 from public.media m
    where m.id=p_media and m.owner_id=auth.uid() and m.couple_id=c and m.purpose='location_avatar'
  ) then raise exception 'invalid_location_avatar'; end if;
  update public.profiles set location_avatar_media_id=p_media where id=auth.uid();
  if not found then raise exception 'profile_not_found'; end if;
end $$;

create function private.can_read_location_avatar(p_media uuid,p_owner uuid,p_couple uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles p join public.location_shares l on l.user_id=p.id
    where p.id=p_owner and p.location_avatar_media_id=p_media
      and l.couple_id=p_couple and l.expires_at>now()
  )
$$;

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
  or (purpose='location_avatar' and private.can_read_location_avatar(media.id,media.owner_id,media.couple_id))
));

revoke all on function private.can_read_location_avatar(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_location_avatar(uuid,uuid,uuid) to authenticated;
revoke all on function public.duet_initialize_profile(text,text,date,text),
  public.duet_get_my_profile(),public.duet_list_couple_profiles(),public.duet_set_location_avatar(uuid)
  from public,anon,authenticated;
grant execute on function public.duet_initialize_profile(text,text,date,text),
  public.duet_get_my_profile(),public.duet_list_couple_profiles(),public.duet_set_location_avatar(uuid)
  to authenticated;
