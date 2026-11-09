create table public.cat_court_cases (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  plaintiff_id uuid not null references auth.users, defendant_id uuid not null references auth.users,
  status text not null default 'open' check(status in ('open','judged')), created_at timestamptz not null default now(), judged_at timestamptz,
  check(plaintiff_id<>defendant_id)
);
create table public.cat_court_statements (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cat_court_cases on delete cascade,
  author_id uuid not null references auth.users, round smallint not null check(round between 0 and 2),
  body text not null check(length(btrim(body)) between 1 and 4000), created_at timestamptz not null default now(),
  unique(case_id,author_id,round)
);
create table public.cat_court_verdicts (
  case_id uuid primary key references public.cat_court_cases on delete cascade,
  payload jsonb not null, created_at timestamptz not null default now()
);
create table public.cat_court_tasks (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cat_court_cases on delete cascade,
  assignee text not null check(assignee in ('plaintiff','defendant','both')),
  kind text not null check(kind in ('reconcile','affection','agreement')), title text not null check(length(title) between 1 and 240),
  plaintiff_done boolean not null default false, defendant_done boolean not null default false,
  awarded_at timestamptz, points integer not null check(points in (2,3,8)), created_at timestamptz not null default now()
);
create table public.cat_court_temperature (
  couple_id uuid primary key references public.couples on delete cascade,
  score smallint not null default 80 check(score between 0 and 100), updated_at timestamptz not null default now()
);

alter table public.cat_court_cases enable row level security;
alter table public.cat_court_statements enable row level security;
alter table public.cat_court_verdicts enable row level security;
alter table public.cat_court_tasks enable row level security;
alter table public.cat_court_temperature enable row level security;

create function public.duet_cat_court_create_case() returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); p uuid;
begin
  select user_id into p from public.couple_members where couple_id=c and user_id<>auth.uid();
  if p is null then raise exception 'not_paired'; end if;
  insert into public.cat_court_temperature(couple_id) values(c) on conflict do nothing;
  insert into public.cat_court_cases(couple_id,plaintiff_id,defendant_id) values(c,auth.uid(),p) returning id into p;
  return p;
end $$;

create function public.duet_cat_court_submit_statement(p_case uuid,p_round smallint,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); k public.cat_court_cases; n integer;
begin
  if p_round not between 0 and 2 or length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid_cat_court_statement'; end if;
  select * into k from public.cat_court_cases where id=p_case and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if k.status<>'open' then raise exception 'case_closed'; end if;
  if auth.uid() not in (k.plaintiff_id,k.defendant_id) then raise exception 'not_found'; end if;
  select count(*) into n from public.cat_court_statements where case_id=p_case and round=p_round;
  if p_round>0 and (select count(*) from public.cat_court_statements where case_id=p_case and round=p_round-1)<>2 then raise exception 'round_not_ready'; end if;
  if n>=2 or exists(select 1 from public.cat_court_statements where case_id=p_case and author_id=auth.uid() and round=p_round) then raise exception 'already_responded'; end if;
  insert into public.cat_court_statements(case_id,author_id,round,body) values(p_case,auth.uid(),p_round,btrim(p_body));
end $$;

create function public.duet_cat_court_save_verdict(p_case uuid,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); k public.cat_court_cases; item jsonb; pts integer;
begin
  if jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>5
     or jsonb_typeof(p_payload->'rootCause')<>'string' or length(p_payload->>'rootCause') not between 1 and 2000
     or jsonb_typeof(p_payload->'judgment')<>'string' or length(p_payload->>'judgment') not between 1 and 3000
     or jsonb_typeof(p_payload->'responsibility')<>'object'
     or (p_payload->'responsibility'->>'plaintiff')::integer not between 0 and 100
     or (p_payload->'responsibility'->>'defendant')::integer not between 0 and 100
     or (p_payload->'responsibility'->>'plaintiff')::integer+(p_payload->'responsibility'->>'defendant')::integer<>100
     or jsonb_typeof(p_payload->'articles')<>'array' or jsonb_array_length(p_payload->'articles') not between 1 and 6
     or jsonb_typeof(p_payload->'reconciliation')<>'array' or jsonb_array_length(p_payload->'reconciliation') not between 1 and 8 then raise exception 'invalid_cat_court_verdict'; end if;
  select * into k from public.cat_court_cases where id=p_case and couple_id=c for update;
  if not found then raise exception 'not_found'; end if;
  if k.status='judged' then raise exception 'case_closed'; end if;
  if (select count(*) from public.cat_court_statements where case_id=p_case and round=0)<>2
     or (select count(*) from public.cat_court_statements where case_id=p_case and round=1)<>2
     or (select count(*) from public.cat_court_statements where case_id=p_case and round=2)<>2 then raise exception 'round_not_ready'; end if;
  insert into public.cat_court_verdicts(case_id,payload) values(p_case,p_payload);
  for item in select value from jsonb_array_elements(p_payload->'reconciliation') loop
    pts:=case item->>'kind' when 'reconcile' then 8 when 'affection' then 2 else 3 end;
    insert into public.cat_court_tasks(case_id,assignee,kind,title,points) values(p_case,item->>'assignee',item->>'kind',item->>'title',pts);
  end loop;
  update public.cat_court_cases set status='judged',judged_at=now() where id=p_case;
end $$;

create function public.duet_cat_court_complete_task(p_task uuid) returns smallint language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); t public.cat_court_tasks; s smallint; v_awarded boolean:=false;
begin
  select x.* into t from public.cat_court_tasks x join public.cat_court_cases k on k.id=x.case_id where x.id=p_task and k.couple_id=c and k.status='judged' for update of x;
  if not found then raise exception 'not_found'; end if;
  if auth.uid() not in (select user_id from public.couple_members where couple_id=c) then raise exception 'not_found'; end if;
  if (t.assignee='plaintiff' and auth.uid()<>(select plaintiff_id from public.cat_court_cases where id=t.case_id))
     or (t.assignee='defendant' and auth.uid()<>(select defendant_id from public.cat_court_cases where id=t.case_id)) then raise exception 'not_assigned'; end if;
  if auth.uid()= (select plaintiff_id from public.cat_court_cases where id=t.case_id) then update public.cat_court_tasks set plaintiff_done=true where id=p_task;
  else update public.cat_court_tasks set defendant_done=true where id=p_task; end if;
  update public.cat_court_tasks set awarded_at=now() where id=p_task and awarded_at is null and plaintiff_done and defendant_done returning true into v_awarded;
  if coalesce(v_awarded,false) then
    update public.cat_court_temperature set score=least(100,score+t.points),updated_at=now() where couple_id=c;
  end if;
  select score into s from public.cat_court_temperature where couple_id=c;
  return s;
end $$;

create function public.duet_cat_court_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result jsonb;
begin
  select jsonb_build_object('temperature',coalesce((select score from public.cat_court_temperature where couple_id=c),80),
    'cases',coalesce(jsonb_agg(to_jsonb(k)||jsonb_build_object(
      'statements',coalesce((select jsonb_agg(to_jsonb(s) order by s.round,s.created_at) from public.cat_court_statements s where s.case_id=k.id),'[]'::jsonb),
      'verdict',(select v.payload from public.cat_court_verdicts v where v.case_id=k.id),
      'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.cat_court_tasks t where t.case_id=k.id),'[]'::jsonb)
    ) order by k.created_at desc),'[]'::jsonb)) into result from public.cat_court_cases k where k.couple_id=c;
  return result;
end $$;

revoke all on public.cat_court_cases,public.cat_court_statements,public.cat_court_verdicts,public.cat_court_tasks,public.cat_court_temperature from anon,authenticated;
revoke all on function public.duet_cat_court_create_case(),public.duet_cat_court_submit_statement(uuid,smallint,text),public.duet_cat_court_save_verdict(uuid,jsonb),public.duet_cat_court_complete_task(uuid),public.duet_cat_court_list() from public,anon,authenticated;
grant execute on function public.duet_cat_court_create_case(),public.duet_cat_court_submit_statement(uuid,smallint,text),public.duet_cat_court_save_verdict(uuid,jsonb),public.duet_cat_court_complete_task(uuid),public.duet_cat_court_list() to authenticated;
