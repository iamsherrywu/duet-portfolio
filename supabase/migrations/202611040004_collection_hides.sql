begin;
create table public.collection_hides(user_id uuid not null references auth.users(id) on delete cascade,song_id uuid not null references public.song_cards(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_id,song_id));
alter table public.collection_hides enable row level security;
revoke all on public.collection_hides from anon,authenticated;
grant all on public.collection_hides to service_role;
commit;
