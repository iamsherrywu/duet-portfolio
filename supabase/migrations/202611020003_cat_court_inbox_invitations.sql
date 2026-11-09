begin;

alter table public.cat_court_cases
  add column if not exists invitation_sent_at timestamptz,
  add column if not exists accepted_at timestamptz;

-- Existing cases were already visible to both members, so keep them active.
update public.cat_court_cases
set invitation_sent_at=coalesce(invitation_sent_at,created_at),
    accepted_at=coalesce(accepted_at,created_at)
where accepted_at is null;

create table public.cat_court_invitations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cat_court_cases on delete cascade,
  couple_id uuid not null references public.couples on delete cascade,
  sender_id uuid not null references auth.users,
  recipient_id uuid not null references auth.users,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  accepted_at timestamptz,
  check(sender_id<>recipient_id)
);
create index cat_court_invitations_recipient_created
  on public.cat_court_invitations(recipient_id,created_at desc);
alter table public.cat_court_invitations enable row level security;
revoke all on public.cat_court_invitations from public,anon,authenticated;
grant select on public.cat_court_invitations to authenticated;
grant all on public.cat_court_invitations to service_role;
create policy cat_court_invitation_recipient_read on public.cat_court_invitations
  for select to authenticated using(recipient_id=auth.uid() and private.is_member(couple_id));

-- The first member to open Cat Court reserves the plaintiff role. Filing is a
-- separate action that sends the defendant a private Inbox invitation.
create or replace function public.duet_cat_court_create_case() returns uuid
language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple();
  partner uuid;
  case_id uuid;
  case_row public.cat_court_cases;
begin
  perform 1 from public.couples where id=c for update;
  select user_id into partner from public.couple_members
    where couple_id=c and user_id<>auth.uid();
  if partner is null then raise exception 'not_paired'; end if;

  select * into case_row from public.cat_court_cases
    where couple_id=c and status='open'
    order by created_at desc limit 1 for update;
  if found then
    case_id:=case_row.id;
  else
    insert into public.cat_court_temperature(couple_id) values(c) on conflict do nothing;
    insert into public.cat_court_cases(couple_id,plaintiff_id,defendant_id)
      values(c,auth.uid(),partner) returning id into case_id;
    select * into case_row from public.cat_court_cases where id=case_id;
  end if;
  return case_id;
end $$;

create function public.duet_cat_court_file_case(p_case uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); k public.cat_court_cases;
begin
  select * into k from public.cat_court_cases
    where id=p_case and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if k.plaintiff_id<>auth.uid() then raise exception 'not_plaintiff'; end if;
  if k.status<>'open' then raise exception 'case_closed'; end if;
  if k.invitation_sent_at is null then
    update public.cat_court_cases set invitation_sent_at=now() where id=k.id;
    insert into public.cat_court_invitations(case_id,couple_id,sender_id,recipient_id)
      values(k.id,c,k.plaintiff_id,k.defendant_id)
      on conflict on constraint cat_court_invitations_case_id_key do nothing;
  end if;
  return k.id;
end $$;

create function public.duet_list_cat_court_invitations() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc),'[]'::jsonb))
  from (
    select x.id,x.case_id,x.sender_id,x.recipient_id,x.created_at,x.read_at,x.accepted_at,
      coalesce(p.display_name,'Partner') as sender_name
    from public.cat_court_invitations x
    left join public.profiles p on p.id=x.sender_id
    where x.couple_id=private.current_couple() and x.recipient_id=auth.uid()
    order by x.created_at desc limit 100
  ) i
$$;

create function public.duet_cat_court_accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); invite public.cat_court_invitations; case_id uuid;
begin
  select * into invite from public.cat_court_invitations
    where id=p_invitation and couple_id=c and recipient_id=auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  update public.cat_court_cases set accepted_at=coalesce(accepted_at,now())
    where id=invite.case_id and couple_id=c and defendant_id=auth.uid()
    returning id into case_id;
  if case_id is null then raise exception 'not_found'; end if;
  update public.cat_court_invitations set accepted_at=coalesce(accepted_at,now()),read_at=coalesce(read_at,now())
    where id=invite.id;
  return case_id;
end $$;

create or replace function public.duet_cat_court_submit_statement(p_case uuid,p_round smallint,p_body text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); k public.cat_court_cases; n integer;
begin
  if p_round not between 0 and 2 or length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid_cat_court_statement'; end if;
  select * into k from public.cat_court_cases where id=p_case and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if k.status<>'open' then raise exception 'case_closed'; end if;
  if auth.uid() not in (k.plaintiff_id,k.defendant_id) then raise exception 'not_found'; end if;
  if k.accepted_at is null then raise exception 'invitation_not_accepted'; end if;
  select count(*) into n from public.cat_court_statements where case_id=p_case and round=p_round;
  if p_round>0 and (select count(*) from public.cat_court_statements where case_id=p_case and round=p_round-1)<>2 then raise exception 'round_not_ready'; end if;
  if n>=2 or exists(select 1 from public.cat_court_statements where case_id=p_case and author_id=auth.uid() and round=p_round) then raise exception 'already_responded'; end if;
  insert into public.cat_court_statements(case_id,author_id,round,body) values(p_case,auth.uid(),p_round,btrim(p_body));
end $$;

revoke all on function public.duet_cat_court_create_case(),
  public.duet_cat_court_file_case(uuid),
  public.duet_list_cat_court_invitations(),public.duet_cat_court_accept_invitation(uuid),
  public.duet_cat_court_submit_statement(uuid,smallint,text) from public,anon;
grant execute on function public.duet_cat_court_create_case(),
  public.duet_cat_court_file_case(uuid),
  public.duet_list_cat_court_invitations(),public.duet_cat_court_accept_invitation(uuid),
  public.duet_cat_court_submit_statement(uuid,smallint,text) to authenticated,service_role;

commit;
