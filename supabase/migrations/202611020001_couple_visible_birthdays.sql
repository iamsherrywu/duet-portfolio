-- Birthdays stay private to the active couple. The raw profiles table remains
-- unavailable to authenticated clients; only this current-couple RPC returns it.
create or replace function public.duet_list_couple_profiles() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'display_name',p.display_name,
    'gender',p.gender,
    'birthday',p.birthday,
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

notify pgrst,'reload schema';
