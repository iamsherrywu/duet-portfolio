begin;
create table if not exists public.user_feedback (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 nonce uuid not null,
 topic text not null check(char_length(topic) between 1 and 100),
 body text not null check(char_length(body) between 1 and 2000),
 email text, display_name text,
 created_at timestamptz not null default now(), sent_at timestamptz,
 unique(user_id,nonce)
);
alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from anon,authenticated;
grant all on public.user_feedback to service_role;
commit;
