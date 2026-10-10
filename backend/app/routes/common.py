"""Shared helpers for route modules: DB lookups, artifact descriptors, integrity checks, timelines."""
from __future__ import annotations

import asyncio
import inspect
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import base58

from app.chain import indexer
from app.chain.client import get_chain
from app.chain.signer import input_commitment_message, receipt_message, verify_receipt
from app.config import settings
from app.db import download_blob, first, public_url, table
from app.ipfs import gateway_url
from app.utils import explorer_addr, explorer_tx, sha256_hex

log = logging.getLogger("verity.routes")

TERMINAL_STATUSES = {"Verified", "Rejected", "Expired"}


# ------------------------------------------------------------------ generic async helpers

async def call_any(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Call a function that may be sync or async; sync functions run in a worker thread."""
    if inspect.iscoroutinefunction(fn):
        return await fn(*args, **kwargs)
    result = await asyncio.to_thread(fn, *args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


async def safe(awaitable: Awaitable[Any], default: Any = None, what: str = "") -> Any:
    """Await something and swallow (log) any exception, returning `default`."""
    try:
        return await awaitable
    except Exception as e:  # noqa: BLE001 - best-effort helper
        log.warning("best-effort call failed%s: %s", f" ({what})" if what else "", e)
        return default


def chain_or_none():
    """Return the chain client, or None if it cannot be constructed (bad RPC config etc.)."""
    try:
        return get_chain()
    except Exception as e:  # noqa: BLE001
        log.warning("chain client unavailable: %s", e)
        return None


async def chain_read(method: str, *args: Any, default: Any = None) -> Any:
    """Best-effort read through the chain client: `await chain_read("get_config")`."""
    chain = chain_or_none()
    if chain is None:
        return default
    return await safe(getattr(chain, method)(*args), default=default, what=method)


def bytes32_list(hex_str: str | None) -> list[int]:
    if not hex_str:
        return []
    return list(bytes.fromhex(hex_str.lower().removeprefix("0x")))


def parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def tx_link(sig: str | None) -> str | None:
    return explorer_tx(sig, settings.cluster)


def addr_link(addr: str | None) -> str | None:
    return explorer_addr(addr, settings.cluster)


def program_wasm_uri(program_hash: str) -> str:
    return f"programs/{program_hash}.wasm"


def input_uri_for(input_hash: str) -> str:
    return f"inputs/{input_hash}.json"


def output_uri_for(request_pda: str) -> str:
    return f"outputs/{request_pda}.json"


# ------------------------------------------------------------------ DB lookups (sync; call via to_thread)

def db_request(pda: str) -> dict[str, Any] | None:
    return first(table("requests").select("*").eq("request_pda", pda).limit(1).execute())


def db_receipt(pda: str) -> dict[str, Any] | None:
    return first(table("receipts").select("*").eq("request_pda", pda).limit(1).execute())


def db_attestations(pda: str) -> list[dict[str, Any]]:
    return table("attestations").select("*").eq("request_pda", pda).order("attested_at").execute().data or []


def db_dispute(pda: str) -> dict[str, Any] | None:
    return first(table("disputes").select("*").eq("request_pda", pda).limit(1).execute())


def db_input_commitment(pda: str) -> dict[str, Any] | None:
    return first(table("input_commitments").select("*").eq("request_pda", pda).limit(1).execute())


def db_program(program_hash: str | None) -> dict[str, Any] | None:
    if not program_hash:
        return None
    return first(table("programs").select("*").eq("program_hash", program_hash).limit(1).execute())


def db_audit_rows(pda: str, limit: int = 500) -> list[dict[str, Any]]:
    return (
        table("audit_log").select("*").eq("request_pda", pda).order("seq").limit(limit).execute().data or []
    )


def decorate_program(p: dict[str, Any] | None) -> dict[str, Any] | None:
    if not p:
        return p
    out = dict(p)
    out["wasm_url"] = public_url(p.get("wasm_uri"))
    out["source_url"] = public_url(p.get("source_uri"))
    out["ipfs_url"] = gateway_url(p.get("ipfs_cid"))
    return out


def decorate_request(r: dict[str, Any] | None) -> dict[str, Any] | None:
    if not r:
        return r
    out = dict(r)
    out["explorer"] = addr_link(r.get("request_pda"))
    out["create_tx_explorer"] = tx_link(r.get("create_tx"))
    return out


def decorate_audit_row(r: dict[str, Any]) -> dict[str, Any]:
    out = dict(r)
    out["explorer"] = tx_link(r.get("tx_sig"))
    out["request_explorer"] = addr_link(r.get("request_pda"))
    out["anchored_explorer"] = tx_link(r.get("anchored_tx"))
    return out


# ------------------------------------------------------------------ bundle loading

async def load_bundle(pda: str, *, sync_if_missing: bool = True, live: bool = True) -> dict[str, Any] | None:
    """Gather DB rows + (optionally) live chain state for one request. Returns None if unknown."""
    row = await asyncio.to_thread(db_request, pda)
    synced: dict[str, Any] | None = None
    if row is None and sync_if_missing:
        synced = await safe(indexer.sync_request(pda), what=f"sync_request {pda}")
        if synced is not None:
            row = await asyncio.to_thread(db_request, pda)

    chain_req = chain_receipt = chain_dispute = None
    if live:
        chain_req, chain_receipt, chain_dispute = await asyncio.gather(
            chain_read("get_request", pda),
            chain_read("get_receipt", pda),
            chain_read("get_dispute", pda),
        )
    if chain_req is None and synced is not None:
        chain_req = synced

    if row is None and chain_req is None:
        return None

    receipt, attestations, dispute, input_commitment = await asyncio.gather(
        asyncio.to_thread(db_receipt, pda),
        asyncio.to_thread(db_attestations, pda),
        asyncio.to_thread(db_dispute, pda),
        asyncio.to_thread(db_input_commitment, pda),
    )
    program_hash = (chain_req or {}).get("program_hash") or (row or {}).get("program_hash")
    program = await asyncio.to_thread(db_program, program_hash)

    return {
        "pda": pda,
        "row": row,
        "chain": chain_req,
        "chain_receipt": chain_receipt,
        "chain_dispute": chain_dispute,
        "receipt": receipt,
        "attestations": attestations,
        "dispute": dispute,
        "program": program,
        "input_commitment": input_commitment,
    }


def expected_hashes(b: dict[str, Any]) -> dict[str, Any]:
    """Expected commitments, chain values preferred over DB copies."""
    row, ch = b.get("row") or {}, b.get("chain") or {}
    rc_chain, rc_db = b.get("chain_receipt") or {}, b.get("receipt") or {}
    return {
        "program_hash": ch.get("program_hash") or row.get("program_hash"),
        "input_hash": ch.get("input_hash") or row.get("input_hash"),
        "input_uri_hash": ch.get("input_uri_hash") or row.get("input_uri_hash"),
        "output_hash": rc_chain.get("output_hash") or rc_db.get("output_hash"),
        "trace_root": rc_chain.get("trace_root") or rc_db.get("trace_root"),
        "fuel_used": rc_chain.get("fuel_used") if rc_chain.get("fuel_used") is not None else rc_db.get("fuel_used"),
        "signature": rc_chain.get("signature") or rc_db.get("signature"),
        "provider": rc_chain.get("provider") or rc_db.get("provider_pubkey") or ch.get("provider")
        or row.get("provider_pubkey"),
        "source": "chain" if ch else "db",
    }


def blob_uris(b: dict[str, Any]) -> dict[str, str | None]:
    row, prog, rc = b.get("row") or {}, b.get("program") or {}, b.get("receipt") or {}
    exp = expected_hashes(b)
    has_receipt = bool(b.get("chain_receipt") or b.get("receipt"))
    return {
        "wasm": prog.get("wasm_uri") or (program_wasm_uri(exp["program_hash"]) if exp["program_hash"] else None),
        "source": prog.get("source_uri"),
        "input": row.get("input_uri") or (input_uri_for(exp["input_hash"]) if exp["input_hash"] else None),
        "output": rc.get("output_uri") or (output_uri_for(b["pda"]) if has_receipt else None),
    }


def build_artifacts(b: dict[str, Any]) -> dict[str, Any]:
    row, prog, rc = b.get("row") or {}, b.get("program") or {}, b.get("receipt") or {}
    exp, uris = expected_hashes(b), blob_uris(b)
    return {
        "request_pda": b["pda"],
        "hash_source": exp["source"],
        "wasm": {
            "uri": uris["wasm"],
            "url": public_url(uris["wasm"]),
            "expected_hash": exp["program_hash"],
            "ipfs_cid": prog.get("ipfs_cid"),
            "ipfs_url": gateway_url(prog.get("ipfs_cid")),
            "size": prog.get("wasm_size"),
        },
        "source": {"uri": uris["source"], "url": public_url(uris["source"])},
        "input": {
            "uri": uris["input"],
            "url": public_url(uris["input"]),
            "expected_hash": exp["input_hash"],
            "expected_uri_hash": exp["input_uri_hash"],
            "ipfs_cid": row.get("input_ipfs_cid"),
            "ipfs_url": gateway_url(row.get("input_ipfs_cid")),
        },
        "output": {
            "uri": uris["output"],
            "url": public_url(uris["output"]),
            "expected_hash": exp["output_hash"],
            "ipfs_cid": rc.get("output_ipfs_cid"),
            "ipfs_url": gateway_url(rc.get("output_ipfs_cid")),
        },
    }


# ------------------------------------------------------------------ blobs + integrity

async def fetch_blob(uri: str | None) -> tuple[bytes | None, str | None]:
    if not uri:
        return None, "no uri"
    try:
        data = await asyncio.to_thread(download_blob, uri)
        if data is None:
            return None, "not found"
        return bytes(data), None
    except Exception as e:  # noqa: BLE001
        return None, str(e)[:300]


def _hash_check(data: bytes | None, err: str | None, expected: str | None, uri: str | None) -> dict[str, Any]:
    if data is None:
        return {"status": "missing", "uri": uri, "expected": expected, "actual": None, "error": err}
    actual = sha256_hex(data)
    if not expected:
        return {"status": "unknown", "uri": uri, "expected": None, "actual": actual, "size": len(data)}
    status = "ok" if actual == expected.lower() else "tampered"
    return {"status": status, "uri": uri, "expected": expected, "actual": actual, "size": len(data)}


def check_receipt_signature(pda: str, exp: dict[str, Any]) -> dict[str, Any]:
    needed = ("program_hash", "input_hash", "output_hash", "trace_root", "signature", "provider")
    if not exp.get("output_hash"):
        return {"status": "pending"}
    if any(not exp.get(k) for k in needed) or exp.get("fuel_used") is None:
        return {"status": "unknown", "error": "incomplete receipt data"}
    try:
        msg = receipt_message(
            pda,
            bytes.fromhex(exp["program_hash"]),
            bytes.fromhex(exp["input_hash"]),
            bytes.fromhex(exp["output_hash"]),
            bytes.fromhex(exp["trace_root"]),
            int(exp["fuel_used"]),
        )
        ok = verify_receipt(exp["provider"], msg, bytes.fromhex(exp["signature"]))
        return {
            "status": "valid" if ok else "invalid",
            "signer": exp["provider"],
            "message_hex": msg.hex(),
            "signature": exp["signature"],
        }
    except Exception as e:  # noqa: BLE001
        return {"status": "invalid", "signer": exp.get("provider"), "error": str(e)[:300]}


def check_input_commitment(b: dict[str, Any], exp: dict[str, Any]) -> dict[str, Any]:
    """Verify the Requester's wallet signature over (program_hash, input_hash, input_uri_hash)."""
    commitment = b.get("input_commitment")
    if not commitment:
        return {"status": "missing"}
    needed = ("program_hash", "input_hash", "input_uri_hash")
    if any(not exp.get(k) for k in needed):
        return {"status": "unknown", "error": "incomplete commitments to check against"}
    mismatches = [k for k in needed if (commitment.get(k) or "").lower() != (exp[k] or "").lower()]
    if mismatches:
        return {"status": "tampered", "mismatches": mismatches, "signer": commitment.get("requester_pubkey")}
    try:
        msg = input_commitment_message(
            bytes.fromhex(exp["program_hash"]), bytes.fromhex(exp["input_hash"]), bytes.fromhex(exp["input_uri_hash"])
        )
        sig = base58.b58decode(commitment["signature"])
        ok = verify_receipt(commitment["requester_pubkey"], msg, sig)
        return {
            "status": "valid" if ok else "invalid",
            "signer": commitment.get("requester_pubkey"),
            "message_hex": msg.hex(),
            "signature": commitment.get("signature"),
        }
    except Exception as e:  # noqa: BLE001
        return {"status": "invalid", "signer": commitment.get("requester_pubkey"), "error": str(e)[:300]}


async def compute_integrity(b: dict[str, Any]) -> dict[str, Any]:
    """Re-hash every stored blob against the on-chain commitments."""
    pda = b["pda"]
    exp, uris = expected_hashes(b), blob_uris(b)
    row = b.get("row") or {}
    ch = b.get("chain") or {}
    rc_db = b.get("receipt") or {}
    rc_chain = b.get("chain_receipt") or {}
    has_receipt = bool(rc_chain or rc_db)

    (wasm, wasm_err), (inp, inp_err), (out, out_err) = await asyncio.gather(
        fetch_blob(uris["wasm"]),
        fetch_blob(uris["input"]),
        fetch_blob(uris["output"]) if has_receipt else asyncio.sleep(0, result=(None, None)),
    )

    program = _hash_check(wasm, wasm_err, exp["program_hash"], uris["wasm"])
    input_ = _hash_check(inp, inp_err, exp["input_hash"], uris["input"])
    output = _hash_check(out, out_err, exp["output_hash"], uris["output"]) if has_receipt else {"status": "pending"}

    if uris["input"] and exp["input_uri_hash"]:
        actual_uri_hash = sha256_hex(uris["input"].encode("utf-8"))
        input_uri = {
            "status": "ok" if actual_uri_hash == exp["input_uri_hash"] else "tampered",
            "uri": uris["input"],
            "expected": exp["input_uri_hash"],
            "actual": actual_uri_hash,
        }
    else:
        input_uri = {"status": "unknown"}

    signature = await asyncio.to_thread(check_receipt_signature, pda, exp)
    input_commitment = check_input_commitment(b, exp)

    db_vs_chain: dict[str, Any] = {"status": "unknown", "mismatches": []}
    if ch and row:
        mism = [k for k in ("program_hash", "input_hash", "input_uri_hash") if row.get(k) and ch.get(k)
                and row[k].lower() != ch[k].lower()]
        if rc_chain and rc_db:
            mism += [f"receipt.{k}" for k in ("output_hash", "trace_root") if rc_db.get(k) and rc_chain.get(k)
                     and rc_db[k].lower() != rc_chain[k].lower()]
        if row.get("status") and ch.get("status") and row["status"] != ch["status"]:
            mism.append("status (db lagging chain)")
        db_vs_chain = {"status": "ok" if not mism else "drift", "mismatches": mism}

    statuses = [program["status"], input_["status"], input_uri["status"], signature["status"], input_commitment["status"]]
    if has_receipt:
        statuses.append(output["status"])
    if any(s in ("tampered", "invalid") for s in statuses):
        overall = "tampered"
    elif all(s in ("ok", "valid") for s in statuses):
        overall = "ok"
    else:
        overall = "incomplete"

    return {
        "overall": overall,
        "hash_source": exp["source"],
        "program": program,
        "input": input_,
        "input_uri": input_uri,
        "output": output,
        "receipt_signature": signature,
        "input_commitment": input_commitment,
        "db_vs_chain": db_vs_chain,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


async def reexecute(b: dict[str, Any]) -> dict[str, Any]:
    """Server-side independent re-execution of a request against its committed program + input."""
    from app.engine.runner import ExecutionError, run  # local import: engine is heavy (wasmtime)

    exp, uris = expected_hashes(b), blob_uris(b)
    (wasm, wasm_err), (inp, inp_err) = await asyncio.gather(fetch_blob(uris["wasm"]), fetch_blob(uris["input"]))

    report: dict[str, Any] = {
        "request_pda": b["pda"],
        "hash_source": exp["source"],
        "expected_program_hash": exp["program_hash"],
        "expected_input_hash": exp["input_hash"],
        "program_hash": sha256_hex(wasm) if wasm is not None else None,
        "input_hash": sha256_hex(inp) if inp is not None else None,
        "program_ok": None,
        "input_ok": None,
        "output_hash": None,
        "receipt_output_hash": exp["output_hash"],
        "trace_root": None,
        "receipt_trace_root": exp["trace_root"],
        "fuel_used": None,
        "receipt_fuel_used": exp["fuel_used"],
        "matches": False,
        "trace_matches": None,
        "fuel_matches": None,
        "output": None,
        "output_bytes_utf8": None,
        "error": None,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    if wasm is None:
        report["error"] = f"program blob unavailable: {wasm_err}"
        return report
    if inp is None:
        report["error"] = f"input blob unavailable: {inp_err}"
        return report

    report["program_ok"] = bool(exp["program_hash"]) and report["program_hash"] == exp["program_hash"]
    report["input_ok"] = bool(exp["input_hash"]) and report["input_hash"] == exp["input_hash"]

    try:
        res = await asyncio.to_thread(run, wasm, inp, fuel_limit=settings.fuel_limit)
    except ExecutionError as e:
        report["error"] = f"execution failed: {e}"
        return report
    except Exception as e:  # noqa: BLE001
        report["error"] = f"execution failed: {type(e).__name__}: {e}"
        return report

    out_hash = res.output_hash.hex()
    trace_hex = res.trace_root.hex()
    report.update(
        output_hash=out_hash,
        trace_root=trace_hex,
        fuel_used=res.fuel_used,
        output=res.output,
    )
    try:
        report["output_bytes_utf8"] = res.output_bytes.decode("utf-8")
    except UnicodeDecodeError:
        report["output_bytes_utf8"] = None
    if exp["output_hash"]:
        report["matches"] = bool(report["program_ok"] and report["input_ok"] and out_hash == exp["output_hash"])
        report["trace_matches"] = trace_hex == (exp["trace_root"] or "")
        report["fuel_matches"] = (
            int(exp["fuel_used"]) == res.fuel_used if exp["fuel_used"] is not None else None
        )
    return report


# ------------------------------------------------------------------ timeline

def _timeline_item(event_type: str, at: Any, tx_sig: str | None = None, slot: Any = None,
                   payload: Any = None, actor: str | None = None, seq: Any = None,
                   source: str = "audit_log") -> dict[str, Any]:
    return {
        "seq": seq,
        "event_type": event_type,
        "at": at,
        "tx_sig": tx_sig,
        "slot": slot,
        "explorer": tx_link(tx_sig),
        "actor": actor,
        "payload": payload or {},
        "source": source,
    }


def build_timeline(b: dict[str, Any], audit_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = [
        _timeline_item(r["event_type"], r.get("created_at"), r.get("tx_sig"), r.get("slot"),
                       r.get("payload"), r.get("actor"), r.get("seq"))
        for r in audit_rows
    ]
    seen = {i["event_type"] for i in items}

    # Fill gaps from indexed state so the stepper is never blank if the indexer lags.
    row, rc, disp = b.get("row") or {}, b.get("receipt") or {}, b.get("dispute") or {}
    synthetic: list[dict[str, Any]] = []
    if row and "RequestCreated" not in seen:
        synthetic.append(_timeline_item("RequestCreated", row.get("created_at"), row.get("create_tx"),
                                        row.get("created_slot"), {"requester": row.get("requester_pubkey"),
                                                                  "bounty": row.get("bounty_lamports")},
                                        row.get("requester_pubkey"), source="db"))
    if rc and "ReceiptSubmitted" not in seen:
        synthetic.append(_timeline_item("ReceiptSubmitted", rc.get("submitted_at"), rc.get("tx_sig"), rc.get("slot"),
                                        {"output_hash": rc.get("output_hash"), "fuel_used": rc.get("fuel_used")},
                                        rc.get("provider_pubkey"), source="db"))
    if "Attested" not in seen:
        for a in b.get("attestations") or []:
            synthetic.append(_timeline_item("Attested", a.get("attested_at"), a.get("tx_sig"), a.get("slot"),
                                            {"verifier": a.get("verifier_pubkey"), "matches": a.get("matches"),
                                             "counted": a.get("counted")}, a.get("verifier_pubkey"), source="db"))
    if disp and "DisputeOpened" not in seen:
        synthetic.append(_timeline_item("DisputeOpened", disp.get("opened_at"), disp.get("open_tx"), None,
                                        {"challenger": disp.get("challenger_pubkey"),
                                         "claimed_output_hash": disp.get("claimed_output_hash")},
                                        disp.get("challenger_pubkey"), source="db"))
    if disp and disp.get("resolved_at") and "DisputeResolved" not in seen:
        synthetic.append(_timeline_item("DisputeResolved", disp.get("resolved_at"), disp.get("resolve_tx"), None,
                                        {"status": disp.get("status")}, None, source="db"))

    if synthetic:
        items.extend(synthetic)
        epoch = datetime.min.replace(tzinfo=timezone.utc)
        items.sort(key=lambda i: (parse_iso(i["at"]) or epoch, i["seq"] if i["seq"] is not None else 0))
    return items


# ------------------------------------------------------------------ full detail

async def build_request_detail(pda: str, *, include_integrity: bool = True) -> dict[str, Any] | None:
    b = await load_bundle(pda)
    if b is None:
        return None

    audit_rows_task = asyncio.to_thread(db_audit_rows, pda)
    config_task = chain_read("get_config")
    integrity_task = compute_integrity(b) if include_integrity else asyncio.sleep(0, result=None)
    audit_rows, config, integrity = await asyncio.gather(audit_rows_task, config_task, integrity_task)

    row = b.get("row") or {}
    chain_req = b.get("chain") or {}

    challenge: dict[str, Any] | None = None
    receipt_at = chain_req.get("receipt_at")
    if config and receipt_at:
        window = int(config.get("challenge_window_secs") or 0)
        ends = int(receipt_at) + window
        now = int(datetime.now(timezone.utc).timestamp())
        challenge = {
            "window_secs": window,
            "receipt_at": datetime.fromtimestamp(int(receipt_at), tz=timezone.utc).isoformat(),
            "ends_at": datetime.fromtimestamp(ends, tz=timezone.utc).isoformat(),
            "seconds_remaining": max(0, ends - now),
            "required_attestations": config.get("required_attestations"),
            "min_dispute_stake": config.get("min_dispute_stake"),
        }

    attestations = [
        {**a, "explorer": tx_link(a.get("tx_sig")), "verifier_explorer": addr_link(a.get("verifier_pubkey"))}
        for a in b.get("attestations") or []
    ]
    receipt = b.get("receipt")
    if receipt:
        receipt = {**receipt, "explorer": tx_link(receipt.get("tx_sig")),
                   "output_url": public_url(receipt.get("output_uri"))}
    dispute = b.get("dispute")
    if dispute:
        dispute = {**dispute, "open_explorer": tx_link(dispute.get("open_tx")),
                   "resolve_explorer": tx_link(dispute.get("resolve_tx"))}

    status = chain_req.get("status") or row.get("status")
    return {
        "request_pda": pda,
        "status": status,
        "is_terminal": status in TERMINAL_STATUSES,
        "request": decorate_request(row) if row else None,
        "chain": chain_req or None,
        "chain_receipt": b.get("chain_receipt"),
        "chain_dispute": b.get("chain_dispute"),
        "receipt": receipt,
        "attestations": attestations,
        "dispute": dispute,
        "program": decorate_program(b.get("program")),
        "artifacts": build_artifacts(b),
        "timeline": build_timeline(b, audit_rows),
        "integrity": integrity,
        "challenge": challenge,
        "links": {
            "request": addr_link(pda),
            "requester": addr_link(chain_req.get("requester") or row.get("requester_pubkey")),
            "provider": addr_link(chain_req.get("provider") or row.get("provider_pubkey")),
            "program": addr_link(settings.program_id),
        },
        "cluster": settings.cluster,
        "program_id": settings.program_id,
    }
