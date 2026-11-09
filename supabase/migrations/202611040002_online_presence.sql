begin;
create table if not exists public.user_presence (
 user_id uuid primary key references auth.users(id) on delete cascade,
 last_seen_at timestamptz not null default now(),
 online boolean not null default false
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon,authenticated;
grant all on public.user_presence to service_role;
commit;
