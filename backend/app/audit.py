"""Append-only, hash-chained audit log.

row_hash = sha256_hex(prev_hash || canonical(payload)); genesis prev_hash = 64 zeros.
"""
import threading
from typing import Any

from app.db import table
from app.utils import canonical, sha256_hex

GENESIS = "0" * 64
_lock = threading.Lock()


def compute_row_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    return sha256_hex(prev_hash.encode() + canonical(payload))


def latest_row() -> dict[str, Any] | None:
    rows = table("audit_log").select("*").order("seq", desc=True).limit(1).execute().data
    return rows[0] if rows else None


def append_event(
    event_type: str,
    payload: dict[str, Any],
    request_pda: str | None = None,
    actor: str | None = None,
    tx_sig: str | None = None,
    slot: int | None = None,
) -> dict[str, Any]:
    with _lock:
        last = latest_row()
        prev_hash = last["row_hash"] if last else GENESIS
        row = {
            "event_type": event_type,
            "request_pda": request_pda,
            "actor": actor,
            "payload": payload,
            "tx_sig": tx_sig,
            "slot": slot,
            "prev_hash": prev_hash,
            "row_hash": compute_row_hash(prev_hash, payload),
        }
        res = table("audit_log").insert(row).execute()
        return res.data[0] if res.data else row


def verify_chain(limit: int = 5000) -> dict[str, Any]:
    """Recompute the whole chain; returns {ok, checked, first_bad_seq, head}."""
    rows = table("audit_log").select("*").order("seq").limit(limit).execute().data or []
    prev = GENESIS
    for r in rows:
        if r["prev_hash"] != prev or compute_row_hash(prev, r["payload"]) != r["row_hash"]:
            return {"ok": False, "checked": len(rows), "first_bad_seq": r["seq"], "head": prev}
        prev = r["row_hash"]
    return {"ok": True, "checked": len(rows), "first_bad_seq": None, "head": prev}
