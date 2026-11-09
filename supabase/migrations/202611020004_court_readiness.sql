begin;

alter table public.cat_court_cases
  add column if not exists plaintiff_ready_at timestamptz,
  add column if not exists defendant_ready_at timestamptz;

-- Preserve hearings already under way; merely accepting an invitation is not readiness.
update public.cat_court_cases k
set plaintiff_ready_at=coalesce(k.plaintiff_ready_at,k.accepted_at,k.created_at),
    defendant_ready_at=coalesce(k.defendant_ready_at,k.accepted_at,k.created_at)
where k.status='judged' or exists(select 1 from public.cat_court_statements s where s.case_id=k.id);

create function public.duet_cat_court_ready(p_case uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); k public.cat_court_cases;
begin
  select * into k from public.cat_court_cases where id=p_case and couple_id=c for update;
  if not found or auth.uid() not in (k.plaintiff_id,k.defendant_id) then raise exception 'not_found'; end if;
  if k.status<>'open' then raise exception 'case_closed'; end if;
  if k.accepted_at is null then raise exception 'invitation_not_accepted'; end if;
  if auth.uid()=k.plaintiff_id then
    update public.cat_court_cases set plaintiff_ready_at=coalesce(plaintiff_ready_at,now()) where id=k.id;
  else
    update public.cat_court_cases set defendant_ready_at=coalesce(defendant_ready_at,now()) where id=k.id;
  end if;
  return k.id;
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
  if k.plaintiff_ready_at is null or k.defendant_ready_at is null then raise exception 'court_not_ready'; end if;
  select count(*) into n from public.cat_court_statements where case_id=p_case and round=p_round;
  if p_round>0 and (select count(*) from public.cat_court_statements where case_id=p_case and round=p_round-1)<>2 then raise exception 'round_not_ready'; end if;
  if n>=2 or exists(select 1 from public.cat_court_statements where case_id=p_case and author_id=auth.uid() and round=p_round) then raise exception 'already_responded'; end if;
  insert into public.cat_court_statements(case_id,author_id,round,body) values(p_case,auth.uid(),p_round,btrim(p_body));
end $$;

revoke all on function public.duet_cat_court_ready(uuid) from public,anon;
grant execute on function public.duet_cat_court_ready(uuid) to authenticated,service_role;

commit;
