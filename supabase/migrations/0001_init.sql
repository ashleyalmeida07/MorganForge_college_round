-- =====================================================================
-- Verity — initial schema (idempotent: safe to re-run)
-- Apply with the Supabase SQL editor or `python backend/scripts/apply_migration.py`.
-- Writes go through the backend using the service role (bypasses RLS).
-- =====================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now()
);

create table if not exists public.wallets (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  pubkey      text unique not null,
  verified_at timestamptz default now()
);

create table if not exists public.wallet_nonces (
  nonce      text primary key,
  user_id    uuid,
  wallet     text,
  message    text,
  expires_at timestamptz,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.programs (
  program_hash  text primary key,           -- hex sha256 of the wasm bytes
  name          text not null,
  description   text,
  version       text,
  language      text,
  input_schema  jsonb,
  output_schema jsonb,
  example_input jsonb,
  wasm_uri      text not null,              -- programs/{program_hash}.wasm
  source_uri    text,                       -- programs/{program_hash}.src.txt
  ipfs_cid      text,
  wasm_size     int,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.providers (
  pubkey           text primary key,
  user_id          uuid references public.profiles (id) on delete set null,
  name             text,
  stake_lamports   bigint default 0,
  completed        int default 0,
  slashed          int default 0,
  active_jobs      int default 0,
  active           boolean default true,
  last_synced_slot bigint,
  updated_at       timestamptz
);

create table if not exists public.requests (
  request_pda           text primary key,
  onchain_id            bigint,
  requester_pubkey      text not null,
  requester_user        uuid references public.profiles (id) on delete set null,
  title                 text,
  program_hash          text,               -- intentionally no FK
  input_hash            text not null,
  input_uri             text,
  input_uri_hash        text,
  input_ipfs_cid        text,
  bounty_lamports       bigint,
  deadline              timestamptz,
  status                text not null,      -- mirrors the on-chain RequestStatus enum
  provider_pubkey       text,
  attest_count_match    int default 0,
  attest_count_mismatch int default 0,
  attest_count_total    int default 0,
  settled               boolean default false,
  receipt_at            timestamptz,
  create_tx             text,
  created_slot          bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.receipts (
  request_pda     text primary key,         -- intentionally no FK
  provider_pubkey text,
  output_hash     text,
  trace_root      text,
  fuel_used       bigint,
  signature       text,
  output_uri      text,
  output_ipfs_cid text,
  tx_sig          text,
  slot            bigint,
  submitted_at    timestamptz
);

create table if not exists public.attestations (
  id              bigint generated always as identity primary key,
  request_pda     text,
  verifier_pubkey text,
  output_hash     text,
  trace_root      text,
  fuel_used       bigint,
  matches         boolean,
  counted         boolean,
  tx_sig          text,
  slot            bigint,
  attested_at     timestamptz,
  unique (request_pda, verifier_pubkey)
);

create table if not exists public.disputes (
  request_pda         text primary key,
  challenger_pubkey   text,
  stake_lamports      bigint,
  claimed_output_hash text,
  status              text,
  open_tx             text,
  resolve_tx          text,
  opened_at           timestamptz,
  resolved_at         timestamptz,
  ai_explanation      text
);

create table if not exists public.audit_log (
  seq         bigint generated always as identity primary key,
  event_type  text not null,
  request_pda text,
  actor       text,
  payload     jsonb not null,
  tx_sig      text,
  slot        bigint,
  prev_hash   text not null,
  row_hash    text not null,
  anchored_tx text,                         -- set once the root is anchored on-chain
  created_at  timestamptz not null default now()
);

create table if not exists public.chaos_flags (
  name       text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz
);

create table if not exists public.indexer_state (
  key        text primary key,
  value      text,
  updated_at timestamptz
);

-- ------------------------------------------------------------------ indexes

create index if not exists requests_status_idx        on public.requests (status);
create index if not exists requests_requester_idx     on public.requests (requester_pubkey);
create index if not exists requests_created_at_idx    on public.requests (created_at desc);
create index if not exists requests_provider_idx      on public.requests (provider_pubkey);
create index if not exists attestations_request_idx   on public.attestations (request_pda);
create index if not exists attestations_verifier_idx  on public.attestations (verifier_pubkey);
create index if not exists audit_log_request_idx      on public.audit_log (request_pda);
create index if not exists audit_log_seq_desc_idx     on public.audit_log (seq desc);
create index if not exists wallets_user_idx           on public.wallets (user_id);
create index if not exists wallet_nonces_expires_idx  on public.wallet_nonces (expires_at);

-- ------------------------------------------------------------------ triggers: updated_at on requests

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists requests_set_updated_at on public.requests;
create trigger requests_set_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ triggers: auth.users -> profiles

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data ->> 'email'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that signed up before this trigger existed.
insert into public.profiles (id, email, display_name, avatar_url)
select
  u.id,
  coalesce(u.email, u.raw_user_meta_data ->> 'email'),
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

-- ------------------------------------------------------------------ audit_log: append-only

create or replace function public.audit_log_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log is append-only: deletes are not allowed (seq=%)', old.seq
      using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: the only permitted change is setting anchored_tx.
  if (to_jsonb(new) - 'anchored_tx') is distinct from (to_jsonb(old) - 'anchored_tx') then
    raise exception 'audit_log is append-only: only anchored_tx may be set (seq=%)', old.seq
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

revoke update, delete, truncate on public.audit_log from anon, authenticated;

-- ------------------------------------------------------------------ row level security

alter table public.profiles      enable row level security;
alter table public.wallets       enable row level security;
alter table public.wallet_nonces enable row level security;
alter table public.programs      enable row level security;
alter table public.providers     enable row level security;
alter table public.requests      enable row level security;
alter table public.receipts      enable row level security;
alter table public.attestations  enable row level security;
alter table public.disputes      enable row level security;
alter table public.audit_log     enable row level security;
alter table public.chaos_flags   enable row level security;
alter table public.indexer_state enable row level security;

-- profiles: owner can read + update (but never their own role)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- wallets: owner can read + update their own rows. Linking a new wallet goes
-- through the backend (signature-verified), so pubkey itself is not client-writable.
drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "wallets_update_own" on public.wallets;
create policy "wallets_update_own" on public.wallets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke insert, update, delete on public.wallets from anon, authenticated;
grant select on public.wallets to authenticated;
grant update (verified_at) on public.wallets to authenticated;

-- public transparency tables: anyone may read, nobody but the service role writes
do $$
declare
  t text;
begin
  foreach t in array array[
    'requests', 'receipts', 'attestations', 'disputes',
    'programs', 'providers', 'audit_log', 'chaos_flags'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- private tables: no client access at all (RLS on, no policies, no grants)
revoke all on public.wallet_nonces from anon, authenticated;
revoke all on public.indexer_state from anon, authenticated;

-- ------------------------------------------------------------------ seed: chaos flags

insert into public.chaos_flags (name, enabled, updated_at) values
  ('PROVIDER_TAMPER_OUTPUT', false, now()),
  ('PROVIDER_SWAP_PROGRAM',  false, now()),
  ('STORAGE_TAMPER_INPUT',   false, now()),
  ('STORAGE_TAMPER_OUTPUT',  false, now()),
  ('PROVIDER_BAD_SIG',       false, now()),
  ('VERIFIER_LAZY',          false, now())
on conflict (name) do nothing;

-- ------------------------------------------------------------------ storage buckets (public read)

insert into storage.buckets (id, name, public) values
  ('programs', 'programs', true),
  ('inputs',   'inputs',   true),
  ('outputs',  'outputs',  true)
on conflict (id) do nothing;

drop policy if exists "verity_public_read" on storage.objects;
create policy "verity_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('programs', 'inputs', 'outputs'));

-- ------------------------------------------------------------------ realtime

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['requests', 'attestations', 'disputes', 'receipts', 'audit_log']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
