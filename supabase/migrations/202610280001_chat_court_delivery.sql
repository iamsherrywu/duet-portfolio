begin;
-- The invitation and case are created in one transaction in the paired space.
create or replace function public.duet_cat_court_create_case() returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); partner uuid; case_id uuid;
begin
  perform 1 from public.couples where id=c for update;
  select user_id into partner from public.couple_members where couple_id=c and user_id<>auth.uid();
  if partner is null then raise exception 'not_paired'; end if;
  select id into case_id from public.cat_court_cases where couple_id=c and status='open' order by created_at desc limit 1;
  if case_id is not null then return case_id; end if;
  insert into public.cat_court_temperature(couple_id) values(c) on conflict do nothing;
  insert into public.cat_court_cases(couple_id,plaintiff_id,defendant_id) values(c,auth.uid(),partner) returning id into case_id;
  insert into public.messages(couple_id,sender_id,kind,body,metadata,dedupe_key)
    values(c,auth.uid(),'share','Join me in Cat Judge. Share your side when you are ready.',jsonb_build_object('cat_court_case_id',case_id),'cat-court-invite:'||case_id);
  return case_id;
end $$;

-- A logged-in browser must never be able to supply its own AI verdict.
revoke execute on function public.duet_cat_court_save_verdict(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.duet_cat_court_store_ai_verdict(p_case uuid,p_actor uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare previous_actor text:=current_setting('request.jwt.claim.sub',true);
begin
  if p_actor is null or not exists(select 1 from public.cat_court_cases k join public.couple_members m on m.couple_id=k.couple_id
    where k.id=p_case and m.user_id=p_actor and p_actor in (k.plaintiff_id,k.defendant_id)) then raise exception 'not_found'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform public.duet_cat_court_save_verdict(p_case,p_payload);
  perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
end $$;
revoke all on function public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb) to service_role;
commit;
