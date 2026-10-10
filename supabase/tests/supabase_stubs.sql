-- Minimal stand-ins for the Supabase-managed objects the migrations reference
-- (auth.users, storage.*, the anon/authenticated roles), so supabase/migrations/*.sql
-- can be applied to a plain Postgres in CI (backend/tests/test_audit_db.py).
-- Never apply this to a real Supabase project.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id     text primary key,
  name   text,
  public boolean
);
create table if not exists storage.objects (
  id        bigint generated always as identity primary key,
  bucket_id text,
  name      text
);
alter table storage.objects enable row level security;
