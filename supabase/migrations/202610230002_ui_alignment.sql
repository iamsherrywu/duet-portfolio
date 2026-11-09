begin;
create table public.blind_box_inbox (
  id uuid primary key references public.prompt_answers(id) on delete cascade,
  couple_id uuid not null references public.couples on delete cascade,
  recipient_id uuid not null references auth.users,
  author_id uuid not null references auth.users,
  prompt text not null, answer text not null,
  created_at timestamptz not null default now(), read_at timestamptz
);
alter table public.blind_box_inbox enable row level security;
grant select on public.blind_box_inbox to authenticated;
grant all on public.blind_box_inbox to service_role;
create policy inbox_read on public.blind_box_inbox for select to authenticated
  using(recipient_id=auth.uid() and private.is_member(couple_id));
insert into public.blind_box_inbox(id,couple_id,recipient_id,author_id,prompt,answer,created_at)
  select a.id,a.couple_id,b.sender_id,a.author_id,a.prompt,a.answer,a.created_at
  from public.prompt_answers a join public.draws d on d.id=a.source_id
  join public.blind_boxes b on b.id=d.box_id where a.source_type='draw';
drop policy member_read on public.prompt_answers;
-- Hide legacy shared-chat copies without deleting any historical user data.
drop policy member_read on public.messages;
create policy member_read on public.messages for select to authenticated using(
  private.is_member(couple_id) and coalesce(metadata->>'source','')<>'draw'
);
create or replace function public.duet_list_messages(p_before timestamptz default null,p_cursor uuid default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') from (
    select messages.* from public.messages where couple_id=private.current_couple()
      and coalesce(metadata->>'source','')<>'draw'
      and not exists(select 1 from public.message_hides h where h.message_id=messages.id and h.user_id=auth.uid())
      and (p_before is null or created_at<p_before or (created_at=p_before and p_cursor is not null and id<p_cursor))
    order by created_at desc,id desc limit least(greatest(p_limit,1),100)
  ) m
$$;
create policy answer_read on public.prompt_answers for select to authenticated using(
  private.is_member(couple_id) and (source_type='feed' or exists(
    select 1 from public.blind_box_inbox i where i.id=prompt_answers.id and i.recipient_id=auth.uid()
  ))
);
create or replace function public.duet_complete_draw(p_draw uuid,p_answer text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); d public.draws; song public.song_cards; answer_id uuid; sender uuid;
begin
  select * into d from public.draws where id=p_draw and couple_id=c and recipient_id=auth.uid() for update;
  if d.id is null then raise exception 'not_found'; end if;
  if p_answer is null or length(btrim(p_answer)) not between 1 and 2000 then raise exception 'answer_required'; end if;
  if d.completed_at is null then
    select sender_id into sender from public.blind_boxes where id=d.box_id;
    insert into public.prompt_answers(couple_id,author_id,source_type,source_id,prompt,answer)
      values(c,auth.uid(),'draw',d.id,d.question,btrim(p_answer)) returning id into answer_id;
    insert into public.blind_box_inbox(id,couple_id,recipient_id,author_id,prompt,answer)
      values(answer_id,c,sender,auth.uid(),d.question,btrim(p_answer));
    update public.blind_box_items set opened_at=now() where id=d.item_id;
    update public.draws set completed_at=now() where id=d.id;
  end if;
  select s.* into song from public.song_cards s join public.blind_box_items i on i.song_id=s.id where i.id=d.item_id;
  return to_jsonb(song);
end $$;
create function public.duet_read_blind_box_answer(p_answer uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.blind_box_inbox set read_at=coalesce(read_at,now())
    where id=p_answer and recipient_id=auth.uid() and couple_id=private.current_couple();
  if not found then raise exception 'not_found'; end if;
end $$;
create table public.daily_moods (
  user_id uuid primary key references auth.users,
  couple_id uuid not null references public.couples on delete cascade,
  mood text not null check(length(btrim(mood)) between 1 and 40),
  expires_at timestamptz not null
);
alter table public.daily_moods enable row level security;
grant select on public.daily_moods to authenticated;
grant all on public.daily_moods to service_role;
create policy mood_read on public.daily_moods for select to authenticated
  using(private.is_member(couple_id) and expires_at>now());
create function public.duet_set_mood(p_mood text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); zone text;
begin
  select timezone into zone from public.profiles where id=auth.uid();
  zone:=coalesce(zone,'Asia/Shanghai');
  -- Ephemeral state: overwrite, never append a mood history.
  delete from public.daily_moods where expires_at<=now();
  insert into public.daily_moods(user_id,couple_id,mood,expires_at)
    values(auth.uid(),c,btrim(p_mood),(date_trunc('day',now() at time zone zone)+interval '1 day') at time zone zone)
    on conflict(user_id) do update set mood=excluded.mood,couple_id=excluded.couple_id,expires_at=excluded.expires_at;
end $$;
revoke all on function public.duet_read_blind_box_answer(uuid),public.duet_set_mood(text) from public,anon;
grant execute on function public.duet_read_blind_box_answer(uuid),public.duet_set_mood(text) to authenticated,service_role;
create table public.song_reactions (
  song_id uuid not null references public.song_cards on delete cascade,
  couple_id uuid not null references public.couples on delete cascade,
  user_id uuid not null references auth.users,
  emoji text not null check(emoji in ('🔥','🎧','🥹','✨','😎','🌙')),
  primary key(song_id,user_id)
);
alter table public.song_reactions enable row level security;
grant select on public.song_reactions to authenticated;
grant all on public.song_reactions to service_role;
create policy reaction_read on public.song_reactions for select to authenticated using(
  private.is_member(couple_id) and exists(select 1 from public.song_cards s where s.id=song_id)
);
create function public.duet_react_to_song(p_song uuid,p_emoji text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if p_emoji is null or p_emoji not in ('🔥','🎧','🥹','✨','😎','🌙') then raise exception 'invalid_reaction'; end if;
  if not exists(select 1 from public.song_cards s where s.id=p_song and s.couple_id=c and
    (s.created_by=auth.uid() or exists(select 1 from public.blind_box_items i where i.song_id=s.id and i.couple_id=c and i.opened_at is not null))) then raise exception 'not_found'; end if;
  insert into public.song_reactions(song_id,couple_id,user_id,emoji) values(p_song,c,auth.uid(),p_emoji)
    on conflict(song_id,user_id) do update set emoji=excluded.emoji;
end $$;
revoke all on function public.duet_react_to_song(uuid,text) from public,anon;
grant execute on function public.duet_react_to_song(uuid,text) to authenticated,service_role;
create function public.duet_purge_expired_moods() returns void
language sql security definer set search_path='' as $$
  delete from public.daily_moods where expires_at<=now()
$$;
revoke all on function public.duet_purge_expired_moods() from public,anon,authenticated;
grant execute on function public.duet_purge_expired_moods() to service_role;
create function public.duet_list_blind_box_inbox(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid:=private.current_couple(); cursor_time timestamptz; items jsonb; unread_count int;
begin
  if p_cursor is not null then
    select created_at into cursor_time from public.blind_box_inbox where id=p_cursor and recipient_id=auth.uid() and couple_id=c;
    if not found then raise exception 'not_found'; end if;
  end if;
  select count(*)::int into unread_count from public.blind_box_inbox where recipient_id=auth.uid() and couple_id=c and read_at is null;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc,i.id desc),'[]') into items from (
    select * from public.blind_box_inbox where recipient_id=auth.uid() and couple_id=c
      and (p_cursor is null or (created_at,id)<(cursor_time,p_cursor)) order by created_at desc,id desc limit 50
  ) i;
  return jsonb_build_object('items',items,'unreadCount',unread_count,'nextCursor',case when jsonb_array_length(items)=50 then items->49->>'id' else null end);
end $$;
revoke all on function public.duet_list_blind_box_inbox(uuid) from public,anon;
grant execute on function public.duet_list_blind_box_inbox(uuid) to authenticated,service_role;
commit;
