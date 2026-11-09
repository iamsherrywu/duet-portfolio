-- Editing an initialized profile is separate from invitation registration.
create function public.duet_edit_profile(p_display_name text,p_gender text,p_birthday date)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 40
    or p_gender is null or p_gender not in ('male','female','other','prefer_not_to_say')
    or p_birthday is null or p_birthday < date '0001-01-01'
    or p_birthday>(now() at time zone 'Asia/Shanghai')::date
  then raise exception 'invalid_profile'; end if;
  update public.profiles set display_name=btrim(p_display_name),gender=p_gender,birthday=p_birthday
    where id=auth.uid();
  if not found then raise exception 'profile_not_found'; end if;
end $$;
revoke all on function public.duet_edit_profile(text,text,date) from public,anon,authenticated;
grant execute on function public.duet_edit_profile(text,text,date) to authenticated;
