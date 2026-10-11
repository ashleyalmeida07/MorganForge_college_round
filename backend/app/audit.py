"""Append-only, hash-chained audit log.

Two row formats coexist in one chain (genesis prev_hash = 64 zeros):

v1 (rows written before migration 0003; computed by the backend):
    row_hash = sha256_hex(prev_hash || canonical(payload))

v2 (computed by the database trigger `audit_log_chain`, which also assigns prev_hash
and seq under a lock, so the backend cannot write a wrong hash or fork the chain):
    row_hash = sha256_hex(utf8(join("\\x1f", [
        "VERITY_AUDIT_V2", prev_hash, event_type, request_pda or "", actor or "",
        tx_sig or "", str(slot) or "", payload::text ])))
    `payload::text` is Postgres' own jsonb rendering; read it back with the
    PostgREST cast `payload_text:payload::text` (see AUDIT_SELECT).
"""
import threading
from decimal import Decimal
from typing import Any

from app.db import table
from app.utils import canonical, sha256_hex

GENESIS = "0" * 64
V2_DOMAIN = "VERITY_AUDIT_V2"
V2_SEP = "\x1f"
AUDIT_SELECT = "*,payload_text:payload::text"
_lock = threading.Lock()


def compute_row_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    """v1 row hash (payload only)."""
    return sha256_hex(prev_hash.encode() + canonical(payload))


def compute_row_hash_v2(
    prev_hash: str,
    event_type: str,
    request_pda: str | None,
    actor: str | None,
    tx_sig: str | None,
    slot: int | None,
    payload_text: str,
) -> str:
    """v2 row hash; must match public.audit_log_row_hash() in supabase/migrations/0003_*.sql."""
    parts = [
        V2_DOMAIN,
        prev_hash,
        event_type,
        request_pda or "",
        actor or "",
        tx_sig or "",
        "" if slot is None else str(int(slot)),
        payload_text,
    ]
    return sha256_hex(V2_SEP.join(parts).encode("utf-8"))


def _pg_json_string(s: str) -> str:
    out = ['"']
    for ch in s:
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ord(ch) < 0x20:
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def pg_jsonb_text(value: Any) -> str:
    """Best-effort Python rendering of Postgres `jsonb::text`.

    jsonb sorts object keys by (byte length, bytes) and prints ", " / ": " separators.
    Exact for strings, integers, booleans and null; a float can differ from Postgres'
    numeric rendering (e.g. trailing zeros), so prefer the DB's own payload_text.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return format(Decimal(repr(value)), "f")
    if isinstance(value, str):
        return _pg_json_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(pg_jsonb_text(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted((str(k) for k in value), key=lambda k: (len(k.encode("utf-8")), k.encode("utf-8")))
        return "{" + ", ".join(f"{_pg_json_string(k)}: {pg_jsonb_text(value[k])}" for k in keys) + "}"
    raise TypeError(f"unsupported JSON value {type(value).__name__}")


def expected_row_hash(row: dict[str, Any], prev_hash: str | None = None) -> str:
    """Recompute a row's hash from its own fields (and `prev_hash`, default: the row's)."""
    prev = row["prev_hash"] if prev_hash is None else prev_hash
    if int(row.get("hash_version") or 1) >= 2:
        text = row.get("payload_text")
        if text is None:
            text = pg_jsonb_text(row.get("payload"))
        return compute_row_hash_v2(
            prev, row["event_type"], row.get("request_pda"), row.get("actor"), row.get("tx_sig"),
            row.get("slot"), text,
        )
    return compute_row_hash(prev, row["payload"])


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
        # Once migration 0003 is applied the DB trigger overwrites prev_hash/row_hash/seq;
        # the v1 values below only matter for a database without it.
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


def _fetch_rows(limit: int) -> list[dict[str, Any]]:
    return table("audit_log").select(AUDIT_SELECT).order("seq").limit(limit).execute().data or []


def check_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Walk a full chain (ordered by seq, starting at genesis)."""
    prev = GENESIS
    versions: dict[int, int] = {}
    for r in rows:
        v = int(r.get("hash_version") or 1)
        versions[v] = versions.get(v, 0) + 1
        if r["prev_hash"] != prev or expected_row_hash(r, prev) != r["row_hash"]:
            return {"ok": False, "checked": len(rows), "first_bad_seq": r["seq"], "head": prev, "versions": versions}
        prev = r["row_hash"]
    return {"ok": True, "checked": len(rows), "first_bad_seq": None, "head": prev, "versions": versions}


def verify_chain(limit: int = 5000) -> dict[str, Any]:
    """Recompute the whole chain; returns {ok, checked, first_bad_seq, head, versions}."""
    return check_rows(_fetch_rows(limit))
