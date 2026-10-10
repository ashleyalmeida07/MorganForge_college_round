-- =====================================================================
-- Verity — requester-signed input commitments (§4.4 "Plus")
-- Apply with the Supabase SQL editor or `python backend/scripts/apply_migration.py`.
-- =====================================================================

create table if not exists public.input_commitments (
  request_pda      text primary key,         -- predicted PDA, set before on-chain creation
  requester_pubkey text not null,
  program_hash     text not null,
  input_hash       text not null,
  input_uri_hash   text not null,
  signature        text not null,            -- ed25519 sig, base58
  created_at       timestamptz not null default now()
);

create index if not exists input_commitments_requester_idx
  on public.input_commitments (requester_pubkey);

alter table public.input_commitments enable row level security;

-- public transparency table: anyone may read, nobody but the service role writes
drop policy if exists "input_commitments_public_read" on public.input_commitments;
create policy "input_commitments_public_read" on public.input_commitments
  for select to anon, authenticated
  using (true);

revoke insert, update, delete on public.input_commitments from anon, authenticated;
grant select on public.input_commitments to anon, authenticated;
