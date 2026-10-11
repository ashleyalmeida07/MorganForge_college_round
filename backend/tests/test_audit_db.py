"""Migrations + audit-chain trigger against a real Postgres (CI: postgres service container).

Skipped unless VERITY_TEST_DATABASE_URL points at a *throwaway* database: the test creates
Supabase stand-ins (supabase/tests/supabase_stubs.sql) and applies supabase/migrations/*.sql.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import pytest

from app import audit

DB_URL = os.environ.get("VERITY_TEST_DATABASE_URL", "")
REPO = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(not DB_URL, reason="set VERITY_TEST_DATABASE_URL to a throwaway Postgres")


@pytest.fixture(scope="module")
def conn():
    import psycopg

    with psycopg.connect(DB_URL, autocommit=True) as c:
        c.execute("drop schema if exists public cascade; create schema public;")
        c.execute((REPO / "supabase" / "tests" / "supabase_stubs.sql").read_text(encoding="utf-8"))
        migrations = sorted((REPO / "supabase" / "migrations").glob("*.sql"))
        for m in migrations:
            if m.name.startswith("0003"):
                # a row written by the pre-trigger backend (v1)
                c.execute(
                    "insert into public.audit_log (event_type, payload, prev_hash, row_hash) values (%s, %s, %s, %s)",
                    ("Legacy", json.dumps({"a": 1}), audit.GENESIS, audit.compute_row_hash(audit.GENESIS, {"a": 1})),
                )
            c.execute(m.read_text(encoding="utf-8"))
        for m in migrations:  # migrations are idempotent
            c.execute(m.read_text(encoding="utf-8"))
        yield c


def _rows(c):
    cur = c.execute(
        "select seq, event_type, request_pda, actor, payload, tx_sig, slot, prev_hash, row_hash, hash_version, "
        "payload::text as payload_text from public.audit_log order by seq"
    )
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def test_trigger_computes_and_python_verifies(conn):
    conn.execute(
        "insert into public.audit_log (event_type, request_pda, actor, payload, tx_sig, slot, prev_hash, row_hash) "
        "values (%s, %s, %s, %s, %s, %s, 'forged', 'forged')",
        ("ReceiptSubmitted", "PDA1", "provider", json.dumps({"out": "é\n", "fuel": 12, "z": [1, {"b": None}]}),
         "sig1", 99),
    )
    conn.execute("insert into public.audit_log (event_type, payload) values ('Bare', '{}')")
    rows = _rows(conn)
    assert [r["hash_version"] for r in rows][:3] == [1, 2, 2]
    assert rows[1]["prev_hash"] == rows[0]["row_hash"], "trigger chains onto the latest row, ignoring client input"
    res = audit.check_rows(rows)
    assert res["ok"], res
    db_res = conn.execute("select ok, checked, head from public.audit_log_verify()").fetchone()
    assert db_res == (True, len(rows), res["head"])


def test_updates_and_deletes_are_blocked(conn):
    import psycopg

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("update public.audit_log set actor = 'mallory' where seq = (select max(seq) from public.audit_log)")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("delete from public.audit_log where seq = (select min(seq) from public.audit_log)")
    conn.execute("update public.audit_log set anchored_tx = 'tx' where seq = (select max(seq) from public.audit_log)")


def test_concurrent_appends_keep_one_linear_chain(conn):
    import psycopg

    def worker(n: int) -> None:
        with psycopg.connect(DB_URL, autocommit=True) as c:
            for i in range(10):
                c.execute("insert into public.audit_log (event_type, actor, payload) values ('Load', %s, %s)",
                          (f"w{n}", json.dumps({"i": i})))

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    res = audit.check_rows(_rows(conn))
    assert res["ok"], res


def test_chaos_and_realtime_setup(conn):
    names = {r[0] for r in conn.execute("select name from public.chaos_flags").fetchall()}
    from app.db import CHAOS_FLAGS

    assert set(CHAOS_FLAGS) <= names
    published = {r[0] for r in conn.execute(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime'").fetchall()}
    assert {"requests", "attestations", "disputes", "receipts", "audit_log", "chaos_flags", "providers"} <= published
