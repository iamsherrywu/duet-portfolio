-- Duet uses a dedicated Supabase project. The private schema is never exposed.
create schema if not exists private;
create table private.creator_emails(email text primary key check(email=lower(email)));

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  timezone text not null default 'Asia/Shanghai',
  afterwork_start time not null default '17:30', afterwork_end time not null default '23:00'
);
create table public.couples (
  id uuid primary key default gen_random_uuid(), created_by uuid not null references auth.users,
  status text not null default 'active' check(status in ('active','deletion_approved')),
  created_at timestamptz not null default now()
);
create table public.couple_members (
  couple_id uuid not null references public.couples on delete cascade,
  user_id uuid not null unique references auth.users,
  slot smallint not null check(slot in (1,2)),
  primary key(couple_id,user_id), unique(couple_id,slot)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  token_hash text not null unique, created_by uuid not null references auth.users,
  expires_at timestamptz not null default now()+interval '24 hours', used_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.pets (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  kind text not null check(kind in ('cat','dog')), owner_id uuid not null references auth.users,
  breed text not null check(length(breed) between 1 and 80), name text not null check(length(name) between 1 and 40),
  appearance jsonb not null default '{}', unique(couple_id,kind), unique(couple_id,owner_id)
);
create table public.media (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  owner_id uuid not null references auth.users, path text not null unique,
  purpose text not null check(purpose in ('song','chat','memory','feed')),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  created_at timestamptz not null default now()
);
create table public.song_cards (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  created_by uuid not null references auth.users, title text not null check(length(title) between 1 and 200),
  artist text not null check(length(artist) between 1 and 200), album text not null default '', version text not null default '',
  media_id uuid references public.media, created_at timestamptz not null default now()
);
create table public.blind_boxes (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  sender_id uuid not null references auth.users, recipient_id uuid not null references auth.users,
  note text not null default '' check(length(note)<=2000), created_at timestamptz not null default now(),
  check(sender_id<>recipient_id)
);
create table public.blind_box_items (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  box_id uuid not null references public.blind_boxes on delete cascade,
  song_id uuid not null references public.song_cards, custom_prompt text check(length(custom_prompt) between 1 and 500),
  opened_at timestamptz, unique(box_id,song_id)
);
create table public.draws (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  box_id uuid not null references public.blind_boxes on delete cascade,
  item_id uuid not null unique references public.blind_box_items on delete cascade,
  recipient_id uuid not null references auth.users, question text not null, completed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_pending_draw on public.draws(box_id,recipient_id) where completed_at is null;
create table public.prompt_answers (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  author_id uuid not null references auth.users, source_type text not null check(source_type in ('draw','feed')),
  source_id uuid not null, prompt text not null, answer text not null check(length(btrim(answer)) between 1 and 2000),
  created_at timestamptz not null default now(), unique(source_type,source_id)
);
create table public.daily_feeds (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  pet_id uuid not null references public.pets on delete cascade, author_id uuid not null references auth.users,
  feed_date date not null, kind text not null check(kind in ('text','emoji','image','song')),
  content text not null check(length(btrim(content)) between 1 and 2000), unique(pet_id,feed_date)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  sender_id uuid not null references auth.users,
  kind text not null check(kind in ('text','emoji','image','question','blind_box','morning','afterwork','memory','todo','share')),
  body text not null default '' check(length(body)<=8000), metadata jsonb not null default '{}',
  dedupe_key text, created_at timestamptz not null default now(), unique(couple_id,dedupe_key)
);
create index message_timeline on public.messages(couple_id,created_at,id);
create table public.message_hides (
  message_id uuid not null references public.messages on delete cascade, user_id uuid not null references auth.users,
  hidden_at timestamptz not null default now(), primary key(message_id,user_id)
);
create table public.conversation_reads (
  couple_id uuid not null references public.couples on delete cascade, user_id uuid not null references auth.users,
  last_read_at timestamptz not null, primary key(couple_id,user_id)
);
-- The five simple record types share CRUD while preserving typed validation in the API.
create table public.entries (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  author_id uuid not null references auth.users,
  kind text not null check(kind in ('memory','todo','wish','anniversary','preferences')),
  title text not null check(length(btrim(title)) between 1 and 200), body text not null default '' check(length(body)<=8000),
  visibility text not null default 'shared' check(visibility in ('shared','personal')),
  status text not null default 'open' check(status in ('open','done')), event_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples on delete cascade,
  requested_by uuid not null references auth.users, responded_by uuid references auth.users,
  status text not null default 'pending' check(status in ('pending','rejected','approved')),
  created_at timestamptz not null default now(), responded_at timestamptz
);
create unique index one_pending_deletion on public.deletion_requests(couple_id) where status='pending';
create table public.rate_limits (
  user_id uuid not null references auth.users, action text not null, window_start timestamptz not null,
  count integer not null default 1, primary key(user_id,action,window_start)
);

create function private.is_member(p_couple uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.couple_members where couple_id=p_couple and user_id=auth.uid())
$$;
create function private.current_couple() returns uuid language plpgsql stable security definer set search_path='' as $$
declare c uuid; s text;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select m.couple_id,c.status into c,s from public.couple_members m join public.couples c on c.id=m.couple_id where m.user_id=auth.uid();
  if c is null then raise exception 'not_paired'; end if;
  if s<>'active' then raise exception 'space_inactive'; end if;
  return c;
end $$;
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id); return new; end $$;
create trigger duet_profile_on_signup after insert on auth.users for each row execute function private.new_profile();

create function public.duet_create_couple() returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(701);
  if exists(select 1 from public.couple_members where user_id=auth.uid()) then raise exception 'already_paired'; end if;
  if not exists(select 1 from auth.users u join private.creator_emails e on lower(u.email)=e.email where u.id=auth.uid()) then raise exception 'not_allowed'; end if;
  if (select count(*) from public.couples)>=2 then raise exception 'space_limit'; end if;
  insert into public.couples(created_by) values(auth.uid()) returning id into c;
  insert into public.couple_members values(c,auth.uid(),1);
  return c;
end $$;
create function public.duet_create_invitation() returns text language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); token text;
begin
  perform 1 from public.couples where id=c for update;
  if (select count(*) from public.couple_members where couple_id=c)>=2 then raise exception 'space_full'; end if;
  -- Reissuing invalidates previous links.
  update public.invitations set expires_at=now() where couple_id=c and used_at is null;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.invitations(couple_id,token_hash,created_by) values(c,encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid());
  return token;
end $$;
create function public.duet_accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.invitations; c uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.couple_members where user_id=auth.uid()) then raise exception 'already_paired'; end if;
  select * into inv from public.invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if inv.id is null or inv.used_at is not null or inv.expires_at<=now() then raise exception 'invalid_invitation'; end if;
  select id into c from public.couples where id=inv.couple_id and status='active' for update;
  if c is null then raise exception 'invalid_invitation'; end if;
  if (select count(*) from public.couple_members where couple_id=c)>=2 then raise exception 'space_full'; end if;
  insert into public.couple_members values(c,auth.uid(),2);
  update public.invitations set used_at=now() where id=inv.id;
  return c;
end $$;
create function public.duet_claim_pet(p_kind text,p_breed text,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); pet uuid;
begin
  perform 1 from public.couples where id=c for update;
  if exists(select 1 from public.pets where couple_id=c and owner_id=auth.uid()) then raise exception 'already_adopted'; end if;
  insert into public.pets(couple_id,kind,owner_id,breed,name) values(c,p_kind,auth.uid(),p_breed,p_name) returning id into pet;
  return pet;
end $$;
create function public.duet_send_message(p_kind text,p_body text,p_metadata jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); m uuid; media uuid;
begin
  if p_kind not in ('text','emoji','image','share') then raise exception 'invalid_message_kind'; end if;
  if p_kind<>'image' and length(btrim(p_body))=0 then raise exception 'empty_message'; end if;
  if p_kind='image' then
    media:=(p_metadata->>'media_id')::uuid;
    if not exists(select 1 from public.media where id=media and couple_id=c and owner_id=auth.uid() and purpose='chat') then raise exception 'not_found'; end if;
    p_metadata:=jsonb_build_object('media_id',media);
  else p_metadata:='{}'; end if;
  insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),p_kind,p_body,p_metadata) returning id into m;
  return m;
end $$;
create function public.duet_hide_message(p_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple();
begin
  if not exists(select 1 from public.messages where id=p_message and couple_id=c) then raise exception 'not_found'; end if;
  insert into public.message_hides(message_id,user_id) values(p_message,auth.uid()) on conflict do nothing;
end $$;
create function public.duet_mark_read(p_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); t timestamptz;
begin
  select created_at into t from public.messages where id=p_message and couple_id=c;
  if t is null then raise exception 'not_found'; end if;
  insert into public.conversation_reads values(c,auth.uid(),t) on conflict(couple_id,user_id) do update set last_read_at=greatest(public.conversation_reads.last_read_at,excluded.last_read_at);
end $$;
create function public.duet_feed_pet(p_pet uuid,p_kind text,p_content text,p_question text,p_answer text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); f uuid; d date; tz text;
begin
  perform 1 from public.couples where id=c for update;
  if not exists(select 1 from public.pets where id=p_pet and owner_id=auth.uid() and couple_id=c) then raise exception 'not_found'; end if;
  select timezone into tz from public.profiles where id=auth.uid(); d:=(now() at time zone tz)::date;
  if exists(select 1 from public.daily_feeds where pet_id=p_pet and feed_date=d) then raise exception 'already_fed'; end if;
  insert into public.daily_feeds(couple_id,pet_id,author_id,feed_date,kind,content) values(c,p_pet,auth.uid(),d,p_kind,p_content) returning id into f;
  insert into public.prompt_answers(couple_id,author_id,source_type,source_id,prompt,answer) values(c,auth.uid(),'feed',f,p_question,p_answer);
  insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),'question',p_answer,jsonb_build_object('source','feed','question',p_question,'feed_id',f,'content',p_content));
  if (select count(*) from public.daily_feeds where couple_id=c and feed_date=d)=2 then
    insert into public.messages(couple_id,sender_id,kind,body,dedupe_key) values(c,auth.uid(),'morning','今天一起喂过猫猫和狗狗啦','morning:'||d::text) on conflict(couple_id,dedupe_key) do nothing;
  end if;
  return f;
end $$;
create function public.duet_create_song(p_title text,p_artist text,p_album text,p_version text,p_media uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); s uuid;
begin
  if p_media is not null and not exists(select 1 from public.media where id=p_media and couple_id=c and owner_id=auth.uid() and purpose='song') then raise exception 'not_found'; end if;
  insert into public.song_cards(couple_id,created_by,title,artist,album,version,media_id) values(c,auth.uid(),p_title,p_artist,p_album,p_version,p_media) returning id into s;
  return s;
end $$;
create function public.duet_send_blind_box(p_items jsonb,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); b uuid; partner uuid; item jsonb;
begin
  select user_id into partner from public.couple_members where couple_id=c and user_id<>auth.uid();
  if partner is null then raise exception 'partner_required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'invalid_items'; end if;
  insert into public.blind_boxes(couple_id,sender_id,recipient_id,note) values(c,auth.uid(),partner,p_note) returning id into b;
  for item in select value from jsonb_array_elements(p_items) loop
    if not exists(select 1 from public.song_cards where id=(item->>'song_id')::uuid and created_by=auth.uid() and couple_id=c) then raise exception 'not_found'; end if;
    insert into public.blind_box_items(couple_id,box_id,song_id,custom_prompt) values(c,b,(item->>'song_id')::uuid,nullif(btrim(item->>'question'),''));
  end loop;
  insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),'blind_box',p_note,jsonb_build_object('box_id',b,'count',jsonb_array_length(p_items)));
  return b;
end $$;
create function public.duet_prepare_draw(p_box uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); d public.draws; item public.blind_box_items; q text;
begin
  perform 1 from public.blind_boxes where id=p_box and couple_id=c and recipient_id=auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  select * into d from public.draws where box_id=p_box and recipient_id=auth.uid() and completed_at is null;
  if d.id is not null then return jsonb_build_object('draw_id',d.id,'question',d.question); end if;
  select * into item from public.blind_box_items where box_id=p_box and opened_at is null order by random() limit 1;
  if item.id is null then raise exception 'box_empty'; end if;
  q:=coalesce(item.custom_prompt,(array['今天下班后最想做什么？','用一个颜色形容今天。','最近有什么小事让你开心？','今天最想和对方分享的一件小事？'])[1+floor(random()*4)::int]);
  insert into public.draws(couple_id,box_id,item_id,recipient_id,question) values(c,p_box,item.id,auth.uid(),q) returning * into d;
  return jsonb_build_object('draw_id',d.id,'question',q);
end $$;
create function public.duet_complete_draw(p_draw uuid,p_answer text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); d public.draws; song public.song_cards;
begin
  select * into d from public.draws where id=p_draw and couple_id=c and recipient_id=auth.uid() for update;
  if d.id is null then raise exception 'not_found'; end if;
  if length(btrim(p_answer))=0 or p_answer is null then raise exception 'answer_required'; end if;
  if d.completed_at is null then
    insert into public.prompt_answers(couple_id,author_id,source_type,source_id,prompt,answer) values(c,auth.uid(),'draw',d.id,d.question,p_answer);
    update public.blind_box_items set opened_at=now() where id=d.item_id;
    update public.draws set completed_at=now() where id=d.id;
    insert into public.messages(couple_id,sender_id,kind,body,metadata) values(c,auth.uid(),'question',p_answer,jsonb_build_object('source','draw','question',d.question,'draw_id',d.id));
  end if;
  select s.* into song from public.song_cards s join public.blind_box_items i on i.song_id=s.id where i.id=d.item_id;
  return to_jsonb(song);
end $$;
create function public.duet_request_deletion() returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); r uuid;
begin
  insert into public.deletion_requests(couple_id,requested_by) values(c,auth.uid()) on conflict(couple_id) where status='pending' do update set couple_id=excluded.couple_id returning id into r;
  return r;
end $$;
create function public.duet_respond_deletion(p_request uuid,p_confirm boolean) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); r public.deletion_requests;
begin
  select * into r from public.deletion_requests where id=p_request and couple_id=c for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.requested_by=auth.uid() then raise exception 'partner_required'; end if;
  if r.status<>'pending' then raise exception 'already_responded'; end if;
  update public.deletion_requests set responded_by=auth.uid(),status=case when p_confirm then 'approved' else 'rejected' end,responded_at=now() where id=r.id;
  if p_confirm then update public.couples set status='deletion_approved' where id=c;
  else insert into public.messages(couple_id,sender_id,kind,body) values(c,auth.uid(),'text','对方不同意，无法注销'); end if;
end $$;
create function public.duet_rate_limit(p_action text,p_limit int,p_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare n int; w timestamptz;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  -- Do not let the caller raise limits; use fixed server-side limits.
  p_limit:=case when p_action='ai' then 20 else 60 end; p_seconds:=60;
  w:=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
  insert into public.rate_limits(user_id,action,window_start) values(auth.uid(),p_action,w)
  on conflict(user_id,action,window_start) do update set count=public.rate_limits.count+1 returning count into n;
  return n<=p_limit;
end $$;

-- Definer functions are the only write path for immutable or transactional data.
do $$ declare t text; f record; begin
  foreach t in array array['profiles','couples','couple_members','invitations','pets','media','song_cards','blind_boxes','blind_box_items','draws','prompt_answers','daily_feeds','messages','message_hides','conversation_reads','entries','deletion_requests','rate_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['pets','blind_boxes','prompt_answers','daily_feeds','messages','conversation_reads','deletion_requests'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy member_read on public.%I for select to authenticated using(private.is_member(couple_id))',t);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'duet_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to authenticated,service_role',f.sig);
  end loop;
end $$;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on function private.is_member(uuid) to authenticated;
grant select on public.couples,public.couple_members,public.profiles,public.song_cards,public.blind_box_items,public.entries,public.media,public.message_hides to authenticated;
create policy member_read on public.couples for select to authenticated using(private.is_member(id));
create policy member_read on public.couple_members for select to authenticated using(private.is_member(couple_id));
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or exists(select 1 from public.couple_members a join public.couple_members b using(couple_id) where a.user_id=auth.uid() and b.user_id=profiles.id));
create policy song_read on public.song_cards for select to authenticated using(created_by=auth.uid() or exists(select 1 from public.blind_box_items i where i.song_id=song_cards.id and i.opened_at is not null and private.is_member(i.couple_id)));
create policy item_read on public.blind_box_items for select to authenticated using(private.is_member(couple_id) and (opened_at is not null or exists(select 1 from public.blind_boxes b where b.id=box_id and b.sender_id=auth.uid())));
create policy hide_read on public.message_hides for select to authenticated using(user_id=auth.uid());
create policy entry_read on public.entries for select to authenticated using(private.is_member(couple_id) and (visibility='shared' or author_id=auth.uid()));
grant insert,update,delete on public.entries to authenticated;
create policy entry_insert on public.entries for insert to authenticated with check(couple_id=private.current_couple() and author_id=auth.uid());
create policy entry_update on public.entries for update to authenticated using(couple_id=private.current_couple() and author_id=auth.uid()) with check(couple_id=private.current_couple() and author_id=auth.uid());
create policy entry_delete on public.entries for delete to authenticated using(couple_id=private.current_couple() and author_id=auth.uid());
grant execute on function private.current_couple() to authenticated;
create policy media_read on public.media for select to authenticated using(private.is_member(couple_id) and (owner_id=auth.uid() or purpose in ('chat','feed','memory') or exists(select 1 from public.song_cards s where s.media_id=media.id)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('duet-private','duet-private',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy duet_file_read on storage.objects for select to authenticated using(bucket_id='duet-private' and exists(select 1 from public.media where path=storage.objects.name));
-- Uploads are accepted via the authenticated backend; no public Storage insert/delete policy.

-- Realtime broadcasts committed shared events under the same RLS checks.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.messages,public.daily_feeds,public.pets,public.entries,public.blind_boxes;
  end if;
end $$;
