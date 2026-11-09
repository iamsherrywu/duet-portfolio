-- Assignment describes who performs the action. Both partners acknowledge its
-- completion before shared temperature increases, including single-person tasks.
create or replace function public.duet_cat_court_complete_task(p_task uuid)
returns smallint language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); t public.cat_court_tasks; s smallint; v_awarded boolean:=false;
begin
  select x.* into t from public.cat_court_tasks x
    join public.cat_court_cases k on k.id=x.case_id
    where x.id=p_task and k.couple_id=c and k.status='judged' for update of x;
  if not found then raise exception 'not_found'; end if;
  if auth.uid() not in (select user_id from public.couple_members where couple_id=c) then
    raise exception 'not_found';
  end if;
  if auth.uid()=(select plaintiff_id from public.cat_court_cases where id=t.case_id) then
    update public.cat_court_tasks set plaintiff_done=true where id=p_task;
  else
    update public.cat_court_tasks set defendant_done=true where id=p_task;
  end if;
  update public.cat_court_tasks set awarded_at=now()
    where id=p_task and awarded_at is null and plaintiff_done and defendant_done
    returning true into v_awarded;
  if coalesce(v_awarded,false) then
    update public.cat_court_temperature set score=least(100,score+t.points),updated_at=now()
      where couple_id=c;
  end if;
  select score into s from public.cat_court_temperature where couple_id=c;
  return s;
end $$;
