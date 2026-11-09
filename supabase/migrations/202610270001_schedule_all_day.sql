-- Keep the five/six positional arguments compatible via trailing defaults.
alter table public.personal_schedules add column all_day boolean not null default false;
drop function public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text);
drop function public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text);

create function private.validate_all_day(p_start timestamptz,p_end timestamptz,p_timezone text,p_all_day boolean) returns void
language plpgsql stable set search_path='' as $$ begin
 if p_all_day is null or (p_all_day and (
   (p_start at time zone p_timezone)::time<>time '00:00' or
   (p_end at time zone p_timezone)::time<>time '00:00')) then raise exception 'invalid_schedule_input'; end if;
end $$;

create function public.duet_create_personal_schedule(p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_note text default '',p_all_day boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); result uuid;
begin
 perform 1 from public.couples where id=c for update;
 perform private.validate_schedule(p_title,p_starts_at,p_ends_at,p_timezone,p_note);
 perform private.validate_all_day(p_starts_at,p_ends_at,p_timezone,p_all_day);
 insert into public.personal_schedules(couple_id,owner_id,title,starts_at,ends_at,timezone,note,all_day)
 values(c,auth.uid(),btrim(p_title),p_starts_at,p_ends_at,p_timezone,p_note,p_all_day) returning id into result;
 return result;
end $$;

create function public.duet_update_personal_schedule(p_id uuid,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_note text default '',p_all_day boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
 perform 1 from public.couples where id=c for update;
 perform private.validate_schedule(p_title,p_starts_at,p_ends_at,p_timezone,p_note);
 perform private.validate_all_day(p_starts_at,p_ends_at,p_timezone,p_all_day);
 update public.personal_schedules set title=btrim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,
 timezone=p_timezone,note=p_note,all_day=p_all_day,updated_at=now()
 where id=p_id and couple_id=c and owner_id=auth.uid() and status='active';
 if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function private.validate_all_day(timestamptz,timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text,boolean),
 public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text,boolean),
 public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text,boolean) to authenticated;
