-- =====================================================================
-- Verity — database-enforced audit hash chain, ZK chaos flag, more Realtime tables
-- Apply with the Supabase SQL editor or `python backend/scripts/apply_migration.py`.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ------------------------------------------------------------------ audit_log: DB computes the chain
--
-- Rows written before this migration keep hash_version = 1 (backend-computed,
-- sha256(prev_hash || canonical(payload))). From now on a BEFORE INSERT trigger
-- ignores whatever the client sent for seq / prev_hash / row_hash / anchored_tx and
-- computes them itself under an advisory lock, so even the service role cannot
-- insert a row with a wrong hash or fork the chain. The v2 hash covers every
-- semantic column, not just the payload:
--
--   row_hash = sha256_hex(utf8(concat_ws(E'\x1f',
--       'VERITY_AUDIT_V2', prev_hash, event_type, request_pda, actor, tx_sig, slot, payload::text)))
--   (NULL text columns hash as '')
--
-- backend/app/audit.py (compute_row_hash_v2) recomputes exactly this.

alter table public.audit_log add column if not exists hash_version smallint not null default 1;

create or replace function public.audit_log_row_hash(
  p_prev_hash   text,
  p_event_type  text,
  p_request_pda text,
  p_actor       text,
  p_tx_sig      text,
  p_slot        bigint,
  p_payload     jsonb
)
returns text
language sql
immutable
as $$
  select encode(
    sha256(convert_to(concat_ws(E'\x1f',
      'VERITY_AUDIT_V2',
      p_prev_hash,
      p_event_type,
      coalesce(p_request_pda, ''),
      coalesce(p_actor, ''),
      coalesce(p_tx_sig, ''),
      coalesce(p_slot::text, ''),
      p_payload::text
    ), 'UTF8')),
    'hex'
  );
$$;

create or replace function public.audit_log_chain()
returns trigger
language plpgsql
as $$
declare
  v_prev text;
begin
  -- Serialize appends: the row that takes the lock next always chains onto the
  -- latest committed row, and gets a seq after it.
  perform pg_advisory_xact_lock(hashtext('public.audit_log'));

  select row_hash into v_prev from public.audit_log order by seq desc limit 1;

  new.seq          := nextval(pg_get_serial_sequence('public.audit_log', 'seq'));
  new.prev_hash    := coalesce(v_prev, repeat('0', 64));
  new.hash_version := 2;
  new.anchored_tx  := null;
  new.created_at   := now();
  new.row_hash     := public.audit_log_row_hash(
    new.prev_hash, new.event_type, new.request_pda, new.actor, new.tx_sig, new.slot, new.payload
  );
  return new;
end;
$$;

drop trigger if exists audit_log_chain on public.audit_log;
create trigger audit_log_chain
  before insert on public.audit_log
  for each row execute function public.audit_log_chain();

-- In-database verification of the whole chain (v1 rows: linkage only, since their
-- hash used the backend's canonical JSON; v2 rows: full recomputation).
create or replace function public.audit_log_verify(p_limit int default 100000)
returns table (ok boolean, checked bigint, first_bad_seq bigint, head text)
language plpgsql
stable
as $$
declare
  r       record;
  v_prev  text := repeat('0', 64);
  v_count bigint := 0;
begin
  for r in select * from public.audit_log order by seq limit p_limit loop
    v_count := v_count + 1;
    if r.prev_hash is distinct from v_prev
       or (r.hash_version >= 2 and r.row_hash is distinct from public.audit_log_row_hash(
             r.prev_hash, r.event_type, r.request_pda, r.actor, r.tx_sig, r.slot, r.payload)) then
      return query select false, v_count, r.seq, v_prev;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select true, v_count, null::bigint, v_prev;
end;
$$;

-- hash_version is part of the row; the append-only guard from 0001 still blocks
-- every UPDATE except setting anchored_tx.

-- ------------------------------------------------------------------ chaos flags: scenario 9

insert into public.chaos_flags (name, enabled, updated_at) values
  ('ZK_CORRUPT_PROOF', false, now())
on conflict (name) do nothing;

-- ------------------------------------------------------------------ realtime: live UI without polling

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['requests', 'attestations', 'disputes', 'receipts', 'audit_log',
                           'providers', 'programs', 'chaos_flags']
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
