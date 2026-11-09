-- Partner account registration is allowed only while holding a valid invitation.
-- Email allowlisting is intentionally excluded: it authorizes space creation,
-- not public Auth account creation.
create function public.duet_invite_registration_allowed(p_invite_hash text)
returns boolean
language sql stable security invoker set search_path=''
as $$
  select exists(
    select 1
    from public.invitations i
    join public.couples c on c.id=i.couple_id
    where i.token_hash=p_invite_hash
      and i.used_at is null
      and i.expires_at>now()
      and c.status='active'
      and (select count(*) from public.couple_members where couple_id=c.id)<2
  )
$$;

revoke all on function public.duet_invite_registration_allowed(text) from public,anon,authenticated;
grant execute on function public.duet_invite_registration_allowed(text) to service_role;
