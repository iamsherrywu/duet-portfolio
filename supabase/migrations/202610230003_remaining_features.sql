begin;
alter table public.media drop constraint media_mime_type_check;
alter table public.media add constraint media_mime_type_check check(
  mime_type in ('image/jpeg','image/png','image/webp') or (purpose='chat' and mime_type in ('audio/mp4','audio/webm','audio/ogg'))
);
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','audio/mp4','audio/webm','audio/ogg'] where id='duet-private';
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check(kind in ('text','emoji','image','audio','question','blind_box','morning','afterwork','memory','todo','share'));
create or replace function public.duet_send_message(p_kind text,p_body text,p_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); m uuid; selected_media uuid; story uuid;
begin
  if p_kind not in ('text','emoji','image','audio','share') then raise exception 'invalid_message_kind'; end if;
  if p_kind not in ('image','audio') and length(btrim(p_body))=0 then raise exception 'empty_message'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'invalid_message_metadata'; end if;
  if p_kind in ('image','audio') then
    if p_metadata ? 'story_id' then raise exception 'invalid_message_metadata'; end if;
    selected_media:=(p_metadata->>'media_id')::uuid;
    if not exists(select 1 from public.media where id=selected_media and couple_id=c and owner_id=auth.uid() and purpose='chat'
      and upload_state='ready' and ((p_kind='audio' and mime_type like 'audio/%') or (p_kind='image' and mime_type like 'image/%'))) then raise exception 'not_found'; end if;
    p_metadata:=jsonb_build_object('media_id',selected_media);
  elsif p_metadata ? 'story_id' then
    story:=(p_metadata->>'story_id')::uuid;
    if p_metadata<>jsonb_build_object('story_id',story) then raise exception 'invalid_message_metadata'; end if;
    if not exists(select 1 from public.location_snaps where id=story and couple_id=c and expires_at>now()) then raise exception 'not_found'; end if;
    p_metadata:=jsonb_build_object('story_id',story);
  else p_metadata:='{}'; end if;
  insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),p_kind,p_body,p_metadata) returning id into m;
  return m;
end $$;

create function public.duet_shared_ai_context(p_message uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); source public.messages; history jsonb; reply text;
begin
  select * into source from public.messages where id=p_message and couple_id=c and sender_id=auth.uid() and kind='text'
    and body ~* '(^|[[:space:]])@duet([[:space:],:，：]|$)' and not(metadata ? 'agent');
  if not found then raise exception 'not_found'; end if;
  select body into reply from public.messages where couple_id=c and dedupe_key='shared-ai:'||p_message::text;
  select coalesce(jsonb_agg(jsonb_build_object('sender',h.sender_id,'text',left(h.body,2000)) order by h.created_at,h.id),'[]') into history from (
    select * from public.messages where couple_id=c and (created_at,id)<=(source.created_at,source.id)
      and kind in ('text','emoji','share') and coalesce(metadata->>'source','')<>'draw'
      order by created_at desc,id desc limit 12
  ) h;
  return jsonb_build_object('messages',history,'reply',reply);
end $$;
create function public.duet_finish_shared_ai(p_actor uuid,p_message uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid; result uuid;
begin
  select m.couple_id into c from public.messages m join public.couple_members cm on cm.couple_id=m.couple_id and cm.user_id=p_actor
    join public.couples cp on cp.id=m.couple_id and cp.status='active'
    where m.id=p_message and m.sender_id=p_actor and m.kind='text' and m.body ~* '(^|[[:space:]])@duet([[:space:],:，：]|$)';
  if c is null then raise exception 'not_found'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 16000 then raise exception 'empty_message'; end if;
  insert into public.messages(couple_id,sender_id,kind,body,metadata,dedupe_key)
    values(c,p_actor,'text',p_body,jsonb_build_object('agent','duet','reply_to',p_message),'shared-ai:'||p_message::text)
    on conflict(couple_id,dedupe_key) do nothing returning id into result;
  if result is null then select id into result from public.messages where couple_id=c and dedupe_key='shared-ai:'||p_message::text; end if;
  return result;
end $$;
revoke all on function public.duet_shared_ai_context(uuid) from public,anon;
grant execute on function public.duet_shared_ai_context(uuid) to authenticated;
revoke all on function public.duet_finish_shared_ai(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.duet_finish_shared_ai(uuid,uuid,text) to service_role;

create table public.weekly_date_suggestions (
  couple_id uuid not null references public.couples on delete cascade,
  week_date date not null, token uuid not null, claimed_by uuid not null references auth.users,
  retry_at timestamptz not null, proposal_id uuid references public.date_proposals on delete set null,
  message text not null default '', primary key(couple_id,week_date)
);
alter table public.weekly_date_suggestions enable row level security;
grant select on public.weekly_date_suggestions to authenticated;
grant all on public.weekly_date_suggestions to service_role;
create policy weekly_read on public.weekly_date_suggestions for select to authenticated using(private.is_member(couple_id));
create function public.duet_reserve_weekly_date() returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); w date:=(date_trunc('week',now() at time zone 'Asia/Shanghai'))::date; row public.weekly_date_suggestions;
begin
  perform 1 from public.couples where id=c for update;
  select * into row from public.weekly_date_suggestions where couple_id=c and week_date=w;
  if found and (row.proposal_id is not null or row.retry_at>now()) then
    return jsonb_build_object('acquired',false,'proposalId',row.proposal_id,'message',row.message);
  end if;
  insert into public.weekly_date_suggestions(couple_id,week_date,token,claimed_by,retry_at,message)
    values(c,w,gen_random_uuid(),auth.uid(),now()+interval '5 minutes','正在准备本周约会建议…')
    on conflict(couple_id,week_date) do update set token=excluded.token,claimed_by=excluded.claimed_by,retry_at=excluded.retry_at,message=excluded.message returning * into row;
  return jsonb_build_object('acquired',true,'token',row.token);
end $$;
create function public.duet_finish_weekly_date(p_token uuid,p_proposal uuid,p_message text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if p_proposal is not null and not exists(select 1 from public.date_proposals where id=p_proposal and couple_id=c and created_by=auth.uid()) then raise exception 'not_found'; end if;
  update public.weekly_date_suggestions set proposal_id=p_proposal,message=left(coalesce(p_message,''),500),retry_at=now()+interval '15 minutes'
    where couple_id=c and token=p_token and claimed_by=auth.uid() and proposal_id is null;
  if not found then raise exception 'not_found'; end if;
end $$;
revoke all on function public.duet_reserve_weekly_date(),public.duet_finish_weekly_date(uuid,uuid,text) from public,anon;
grant execute on function public.duet_reserve_weekly_date(),public.duet_finish_weekly_date(uuid,uuid,text) to authenticated;

create function public.duet_update_pet(p_pet uuid,p_breed text,p_name text,p_theme text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if p_theme is null or p_theme not in ('classic','midnight','sunrise') then raise exception 'invalid_pet'; end if;
  update public.pets set breed=btrim(p_breed),name=btrim(p_name),appearance=jsonb_build_object('theme',p_theme)
    where id=p_pet and couple_id=c and owner_id=auth.uid();
  if not found then raise exception 'not_found'; end if;
end $$;
revoke all on function public.duet_update_pet(uuid,text,text,text) from public,anon;
grant execute on function public.duet_update_pet(uuid,text,text,text) to authenticated;
create function public.duet_create_weekly_date_proposal(p_token uuid,p_kind text,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_timezone text,p_plan text,p_context_hash text,p_wish_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); row public.weekly_date_suggestions; result uuid;
begin
  perform 1 from public.couples where id=c for update;
  select * into row from public.weekly_date_suggestions where couple_id=c and token=p_token and claimed_by=auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if row.proposal_id is not null then return row.proposal_id; end if;
  if p_starts_at<(row.week_date::timestamp at time zone 'Asia/Shanghai') or p_ends_at>((row.week_date+7)::timestamp at time zone 'Asia/Shanghai') then raise exception 'invalid_date_input'; end if;
  result:=public.duet_create_date_proposal(p_kind,p_title,p_starts_at,p_ends_at,p_timezone,p_plan,p_context_hash,p_wish_ids);
  perform public.duet_finish_weekly_date(p_token,result,'本周约会建议已生成，请双方核对后确认。');
  return result;
end $$;
revoke all on function public.duet_create_weekly_date_proposal(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid[]) from public,anon;
grant execute on function public.duet_create_weekly_date_proposal(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid[]) to authenticated;
create function private.attach_feed_display() returns trigger language plpgsql security definer set search_path='' as $$
declare feed public.daily_feeds; song public.song_cards;
begin
  if new.kind='question' and new.metadata->>'source'='feed' then
    select * into feed from public.daily_feeds where id=(new.metadata->>'feed_id')::uuid and couple_id=new.couple_id and author_id=new.sender_id;
    if found then
      new.metadata:=new.metadata||jsonb_build_object('feed_kind',feed.kind);
      if feed.kind='image' then new.metadata:=new.metadata||jsonb_build_object('feed_media_id',feed.content); end if;
      if feed.kind='song' then
        select * into song from public.song_cards where id=feed.content::uuid and couple_id=new.couple_id;
        new.metadata:=new.metadata||jsonb_build_object('feed_song_title',song.title,'feed_song_artist',song.artist);
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.attach_feed_display() from public,anon,authenticated;
create trigger attach_feed_display before insert on public.messages for each row execute function private.attach_feed_display();
create or replace function private.validate_feed_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind='image' and not exists(select 1 from public.media where id=new.content::uuid and owner_id=new.author_id and couple_id=new.couple_id and purpose='feed' and mime_type like 'image/%' and upload_state='ready') then raise exception 'not_found'; end if;
  if new.kind='song' and not exists(select 1 from public.song_cards where id=new.content::uuid and created_by=new.author_id and couple_id=new.couple_id) then raise exception 'not_found'; end if;
  return new;
end $$;
commit;
