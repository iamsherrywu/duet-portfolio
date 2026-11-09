-- Keep couple spaces private and creator-allowlisted, without a global count cap.
-- Each creator can still belong to only one couple, and each couple still has two members.
create or replace function public.duet_create_couple()
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  -- Serialize creation so a user cannot race two spaces into existence.
  perform pg_advisory_xact_lock(701);
  if exists(select 1 from public.couple_members where user_id=auth.uid()) then
    raise exception 'already_paired';
  end if;
  if not exists(
    select 1
    from auth.users u
    join private.creator_emails e on lower(u.email)=e.email
    where u.id=auth.uid()
  ) then
    raise exception 'not_allowed';
  end if;
  insert into public.couples(created_by) values(auth.uid()) returning id into c;
  insert into public.couple_members values(c,auth.uid(),1);
  return c;
end
$$;
