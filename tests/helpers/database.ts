import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';

export const users = {
  a: '10000000-0000-4000-8000-000000000001',
  b: '10000000-0000-4000-8000-000000000002',
  c: '10000000-0000-4000-8000-000000000003',
  d: '10000000-0000-4000-8000-000000000004',
  outsider: '10000000-0000-4000-8000-000000000005',
};

export async function database(throughMigration?: string) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets, name text, owner_id text,
      unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, service_role;
    grant all on storage.objects, storage.buckets to service_role;
    grant select, insert on storage.objects to authenticated;
  `);
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && (!throughMigration || f <= throughMigration)).sort();
  for (const file of files) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  for (const [key, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${key}@example.test`]);
  }
  await db.exec("insert into private.creator_emails(email) values ('a@example.test'),('c@example.test')");
  return db;
}

export async function asUser(db: PGlite, id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}

export async function admin(db: PGlite) { await db.exec('reset role'); }
export async function scalar<T = string>(db: PGlite, sql: string, args: unknown[] = []) {
  const result = await db.query<{ value: T }>(sql, args);
  return result.rows[0]?.value;
}

export async function paired(db: PGlite, first: string, second: string) {
  await asUser(db, first);
  const couple = await scalar<string>(db, 'select public.duet_create_couple() as value');
  const token = await scalar<string>(db, 'select public.duet_create_invitation() as value');
  await asUser(db, second);
  await db.query('select public.duet_accept_invitation($1)', [token]);
  return couple;
}
