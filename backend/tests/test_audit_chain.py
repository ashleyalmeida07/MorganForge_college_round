"""Audit hash chain: v1 (backend) + v2 (database trigger) rows, and chaos-flag persistence.

tests/data/audit_chain_pg.json was produced by Postgres itself (stub schema + supabase/migrations,
one legacy v1 row then three trigger-hashed v2 rows), so these tests pin the Python verifier to
what the trigger in 0003_audit_chain_trigger.sql computes. test_audit_db.py re-checks it against a
live Postgres in CI.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app import audit

ROWS = json.loads((Path(__file__).parent / "data" / "audit_chain_pg.json").read_text(encoding="utf-8"))


def test_postgres_computed_chain_verifies():
    res = audit.check_rows(ROWS)
    assert res["ok"], res
    assert res["versions"] == {1: 1, 2: 3}
    assert res["head"] == ROWS[-1]["row_hash"]


def test_pg_jsonb_text_matches_postgres_rendering():
    for r in ROWS:
        assert audit.pg_jsonb_text(r["payload"]) == r["payload_text"]
    # without the DB's payload_text the Python mirror still verifies
    assert audit.check_rows([{k: v for k, v in r.items() if k != "payload_text"} for r in ROWS])["ok"]


@pytest.mark.parametrize("field,value", [
    ("event_type", "Forged"), ("request_pda", "OtherPDA"), ("actor", "mallory"),
    ("tx_sig", "othersig"), ("slot", 7), ("payload_text", '{"n": 6}'),
])
def test_v2_hash_covers_every_column(field, value):
    rows = copy.deepcopy(ROWS)
    rows[1][field] = value
    res = audit.check_rows(rows)
    assert not res["ok"] and res["first_bad_seq"] == rows[1]["seq"]


def test_v1_payload_tamper_and_broken_link_detected():
    rows = copy.deepcopy(ROWS)
    rows[0]["payload"] = {"a": 2, "b": "x"}
    assert audit.check_rows(rows)["first_bad_seq"] == 1

    rows = copy.deepcopy(ROWS)
    del rows[2]  # a deleted row breaks the next row's prev_hash link
    assert audit.check_rows(rows)["first_bad_seq"] == ROWS[3]["seq"]


def test_append_event_still_sends_v1_hash_for_unmigrated_db(monkeypatch):
    sent = {}

    class Q:
        def __init__(self, rows=None):
            self.rows = rows

        def select(self, *_):
            return self

        def order(self, *_a, **_k):
            return self

        def limit(self, *_):
            return self

        def insert(self, row):
            sent.update(row)
            return self

        def execute(self):
            return type("R", (), {"data": self.rows if self.rows is not None else [dict(sent, seq=2)]})()

    last = {"row_hash": "ab" * 32, "seq": 1}
    calls = iter([Q([last]), Q()])  # latest_row() read, then the insert
    monkeypatch.setattr(audit, "table", lambda name: next(calls))
    row = audit.append_event("E", {"x": 1}, "PDA", "actor", "sig", 5)
    assert sent["prev_hash"] == last["row_hash"]
    assert sent["row_hash"] == audit.compute_row_hash(last["row_hash"], {"x": 1})
    assert row["seq"] == 2


# ---------------------------------------------------------------- chaos flags survive restarts

def test_chaos_flags_are_loaded_from_the_database(monkeypatch):
    from app import db

    stored = [{"name": "PROVIDER_TAMPER_OUTPUT", "enabled": True},
              {"name": "ZK_CORRUPT_PROOF", "enabled": True},
              {"name": "UNKNOWN_FLAG", "enabled": True}]
    writes = []

    class T:
        def select(self, *_):
            return self

        def execute(self):
            return type("R", (), {"data": stored})()

    monkeypatch.setattr(db.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(db.settings, "supabase_service_role_key", "service-key")
    monkeypatch.setattr(db, "table", lambda name: T())
    monkeypatch.setattr(db, "upsert", lambda name, row, *a: writes.append(row))
    monkeypatch.setattr(db, "_chaos_state", {f: False for f in db.CHAOS_FLAGS})
    monkeypatch.setattr(db, "_chaos_loaded", False)
    monkeypatch.setattr(db, "_chaos_next_try", 0.0)

    assert db.chaos("PROVIDER_TAMPER_OUTPUT") is True, "restart must restore armed flags"
    assert db.chaos("ZK_CORRUPT_PROOF") is True
    assert db.chaos("VERIFIER_LAZY") is False
    assert "UNKNOWN_FLAG" not in db.get_chaos_flags()

    db.set_chaos_flag("PROVIDER_TAMPER_OUTPUT", False)
    assert db.chaos("PROVIDER_TAMPER_OUTPUT") is False, "a loaded state must not be re-read over a newer write"
    assert writes[-1]["name"] == "PROVIDER_TAMPER_OUTPUT" and writes[-1]["enabled"] is False


def test_chaos_flags_fall_back_to_memory_when_db_is_down(monkeypatch):
    from app import db

    def down(name):
        raise RuntimeError("db down")

    monkeypatch.setattr(db.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(db.settings, "supabase_service_role_key", "service-key")
    monkeypatch.setattr(db, "table", down)
    monkeypatch.setattr(db, "upsert", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    monkeypatch.setattr(db, "_chaos_state", {f: False for f in db.CHAOS_FLAGS})
    monkeypatch.setattr(db, "_chaos_loaded", False)
    monkeypatch.setattr(db, "_chaos_next_try", 0.0)

    db.set_chaos_flag("VERIFIER_LAZY", True)
    assert db.chaos("VERIFIER_LAZY") is True
    assert db.load_chaos_flags() is False
