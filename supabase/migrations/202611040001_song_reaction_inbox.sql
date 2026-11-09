begin;
create table if not exists public.song_reaction_inbox (
 id uuid primary key default gen_random_uuid(),
 couple_id uuid not null references public.couples(id) on delete cascade,
 recipient_id uuid not null references auth.users(id),
 author_id uuid not null references auth.users(id),
 song_id uuid not null references public.song_cards(id) on delete cascade,
 prompt text not null,
 answer text not null check(length(answer) between 1 and 2200),
 created_at timestamptz not null default now(),
 read_at timestamptz
);
alter table public.song_reaction_inbox enable row level security;
revoke all on public.song_reaction_inbox from anon,authenticated;
grant all on public.song_reaction_inbox to service_role;
create index if not exists song_reaction_inbox_recipient on public.song_reaction_inbox(recipient_id,created_at desc);
commit;
