"""Chain -> DB indexer.

* `sync_request` / `sync_provider` mirror on-chain account state into Supabase tables,
  never clobbering non-null off-chain columns with nulls.
* `index_once` walks new program signatures (cursor in `indexer_state.last_signature`),
  decodes events oldest-first, appends them to the hash-chained audit log and records
  tx signatures into the relevant rows.
* `maybe_anchor_audit_root` periodically anchors the audit-log head on chain.
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from typing import Any

from app.audit import append_event, latest_row
from app.chain.client import ChainError, get_chain
from app.chain.keys import admin_keypair
from app.config import settings
from app.db import first, table, upsert
from app.utils import sha256_hex, ts_to_iso, utcnow_iso

log = logging.getLogger(__name__)

CURSOR_KEY = "last_signature"
SIGNATURE_PAGE_SIZE = 1000
MAX_SIGNATURE_PAGES = 20

# Event field naming the acting wallet, for audit_log.actor.
ACTOR_FIELD = {
    "Initialized": "authority",
    "VerifierRegistered": "verifier",
    "VerifierStatusChanged": "verifier",
    "ProviderRegistered": "provider",
    "ProviderStaked": "provider",
    "ProviderUnstaked": "provider",
    "RequestCreated": "requester",
    "RequestClaimed": "provider",
    "ReceiptSubmitted": "provider",
    "Attested": "verifier",
    "DisputeOpened": "challenger",
    "DisputeResolved": "winner",
    "Finalized": "provider",
}

# Events whose `provider` field is a provider owner whose account changed.
PROVIDER_FIELD_EVENTS = {
    "ProviderRegistered",
    "ProviderStaked",
    "ProviderUnstaked",
    "RequestClaimed",
    "ReceiptSubmitted",
    "Finalized",
}
# Events that may change the request's provider account (slash / active_jobs).
REQUEST_PROVIDER_EVENTS = {"DisputeResolved", "Expired"}

_index_lock = asyncio.Lock()
_anchor_lock = asyncio.Lock()


# ------------------------------------------------------------------ helpers

def _merge(existing: dict[str, Any] | None, fresh: dict[str, Any]) -> dict[str, Any]:
    """Overlay chain-derived `fresh` values on `existing`, but never replace non-null with null."""
    merged = dict(existing or {})
    for key, value in fresh.items():
        if value is None and merged.get(key) is not None:
            continue
        merged[key] = value
    return merged


def _json_safe(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if value is None or isinstance(value, (bool, int, str)):
            out[key] = value
        elif isinstance(value, (bytes, bytearray)):
            out[key] = bytes(value).hex()
        elif isinstance(value, float):
            out[key] = int(value) if value.is_integer() else str(value)
        else:
            out[key] = str(value)
    return out


def _select_one(name: str, **eq: Any) -> dict[str, Any] | None:
    q = table(name).select("*")
    for col, val in eq.items():
        q = q.eq(col, val)
    return first(q.limit(1).execute())


def _update(name: str, values: dict[str, Any], **eq: Any) -> None:
    q = table(name).update(values)
    for col, val in eq.items():
        q = q.eq(col, val)
    q.execute()


def _get_cursor() -> str | None:
    row = _select_one("indexer_state", key=CURSOR_KEY)
    value = (row or {}).get("value")
    return value or None


def _set_cursor(sig: str) -> None:
    upsert("indexer_state", {"key": CURSOR_KEY, "value": sig, "updated_at": utcnow_iso()}, on_conflict="key")


def _audit_counts(sig: str) -> Counter:
    rows = table("audit_log").select("event_type").eq("tx_sig", sig).execute().data or []
    return Counter(r["event_type"] for r in rows)


# ------------------------------------------------------------------ account sync

def _request_row(req: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {
        "request_pda": req["pda"],
        "onchain_id": req["id"],
        "requester_pubkey": req["requester"],
        "program_hash": req["program_hash"],
        "input_hash": req["input_hash"],
        "input_uri_hash": req["input_uri_hash"],
        "bounty_lamports": req["bounty"],
        "deadline": ts_to_iso(req["deadline"]),
        "status": req["status"],
        "provider_pubkey": req["provider"],
        "attest_count_match": req["attest_count_match"],
        "attest_count_mismatch": req["attest_count_mismatch"],
        "attest_count_total": req["attest_count_total"],
        "settled": req["settled"],
        "receipt_at": ts_to_iso(req["receipt_at"]),
        "created_at": ts_to_iso(req["created_at"]),
        "updated_at": utcnow_iso(),
    }
    return row


def _sync_receipt_row(request_pda: str, rc: dict[str, Any]) -> None:
    existing = _select_one("receipts", request_pda=request_pda)
    fresh = {
        "request_pda": request_pda,
        "provider_pubkey": rc["provider"],
        "output_hash": rc["output_hash"],
        "trace_root": rc["trace_root"],
        "fuel_used": rc["fuel_used"],
        "signature": rc["signature"],
        "submitted_at": ts_to_iso(rc["submitted_at"]),
    }
    upsert("receipts", _merge(existing, fresh), on_conflict="request_pda")


def _sync_attestation_rows(request_pda: str, atts: list[dict[str, Any]]) -> None:
    if not atts:
        return
    rows = table("attestations").select("*").eq("request_pda", request_pda).execute().data or []
    by_verifier = {r.get("verifier_pubkey"): r for r in rows}
    for att in atts:
        fresh = {
            "request_pda": request_pda,
            "verifier_pubkey": att["verifier"],
            "output_hash": att["output_hash"],
            "trace_root": att["trace_root"],
            "fuel_used": att["fuel_used"],
            "matches": att["matches"],
            "counted": att["counted"],
            "attested_at": ts_to_iso(att["attested_at"]),
        }
        merged = _merge(by_verifier.get(att["verifier"]), fresh)
        merged.pop("id", None)  # identity column; conflict target is (request_pda, verifier_pubkey)
        upsert("attestations", merged, on_conflict="request_pda,verifier_pubkey")


def _sync_dispute_row(request_pda: str, d: dict[str, Any]) -> None:
    existing = _select_one("disputes", request_pda=request_pda)
    fresh = {
        "request_pda": request_pda,
        "challenger_pubkey": d["challenger"],
        "stake_lamports": d["stake"],
        "claimed_output_hash": d["claimed_output_hash"],
        "status": d["status"],
        "opened_at": ts_to_iso(d["opened_at"]),
        "resolved_at": ts_to_iso(d["resolved_at"]),
    }
    upsert("disputes", _merge(existing, fresh), on_conflict="request_pda")


async def sync_request(request_pda: str, tx_sig: str | None = None) -> dict[str, Any] | None:
    """Mirror a request (and its receipt / attestations / dispute) from chain into the DB.

    Returns the merged `requests` row, or None if the request account does not exist.
    `tx_sig`, when given, fills `create_tx` if it is not yet recorded.
    """
    chain = get_chain()
    request_pda = str(request_pda)
    req = await chain.get_request(request_pda)
    if req is None:
        log.info("sync_request: request %s not found on chain", request_pda)
        return None

    receipt = attestations = dispute = None
    if req["receipt_at"] or req["status"] not in ("Open", "Claimed", "Expired"):
        receipt, attestations, dispute = await asyncio.gather(
            chain.get_receipt(request_pda),
            chain.list_attestations(request_pda),
            chain.get_dispute(request_pda),
        )

    existing = _select_one("requests", request_pda=request_pda)
    fresh = _request_row(req)
    if tx_sig and not (existing or {}).get("create_tx"):
        fresh["create_tx"] = tx_sig
    if not (existing or {}).get("input_uri"):
        default_uri = f"inputs/{req['input_hash']}.json"
        if sha256_hex(default_uri.encode("utf-8")) == req["input_uri_hash"]:
            fresh["input_uri"] = default_uri
    merged = _merge(existing, fresh)
    upsert("requests", merged, on_conflict="request_pda")

    if receipt is not None:
        _sync_receipt_row(request_pda, receipt)
    if attestations:
        _sync_attestation_rows(request_pda, attestations)
    if dispute is not None:
        _sync_dispute_row(request_pda, dispute)
    return merged


async def sync_provider(owner: str, slot: int | None = None) -> None:
    """Mirror a provider account into the `providers` table (keeps user_id / name)."""
    owner = str(owner)
    prov = await get_chain().get_provider(owner)
    if prov is None:
        log.info("sync_provider: provider %s not registered on chain", owner)
        return
    existing = _select_one("providers", pubkey=owner)
    fresh = {
        "pubkey": owner,
        "stake_lamports": prov["stake"],
        "completed": prov["completed"],
        "slashed": prov["slashed"],
        "active_jobs": prov["active_jobs"],
        "active": prov["active"],
        "last_synced_slot": slot,
        "updated_at": utcnow_iso(),
    }
    upsert("providers", _merge(existing, fresh), on_conflict="pubkey")


# ------------------------------------------------------------------ event processing

async def _apply_event(
    name: str,
    data: dict[str, Any],
    sig: str,
    slot: int,
    synced_requests: dict[str, dict[str, Any] | None],
    synced_providers: set[str],
) -> None:
    req = data.get("request")
    if req and req not in synced_requests:
        synced_requests[req] = await sync_request(req, tx_sig=sig if name == "RequestCreated" else None)

    if req and synced_requests.get(req) is not None:
        if name == "RequestCreated":
            _update("requests", {"create_tx": sig, "created_slot": slot}, request_pda=req)
        elif name == "ReceiptSubmitted":
            _update("receipts", {"tx_sig": sig, "slot": slot}, request_pda=req)
        elif name == "Attested":
            _update(
                "attestations",
                {"tx_sig": sig, "slot": slot},
                request_pda=req,
                verifier_pubkey=data["verifier"],
            )
        elif name == "DisputeOpened":
            _update("disputes", {"open_tx": sig}, request_pda=req)
        elif name == "DisputeResolved":
            _update("disputes", {"resolve_tx": sig}, request_pda=req)

    owners: list[str] = []
    if name in PROVIDER_FIELD_EVENTS and data.get("provider"):
        owners.append(data["provider"])
    if name in REQUEST_PROVIDER_EVENTS and req:
        row = synced_requests.get(req) or {}
        if row.get("provider_pubkey"):
            owners.append(row["provider_pubkey"])
    for owner in owners:
        if owner not in synced_providers:
            synced_providers.add(owner)
            await sync_provider(owner, slot=slot)


async def _process_transaction(sig: str, slot: int, events: list[dict[str, Any]]) -> int:
    try:
        existing = _audit_counts(sig)
    except Exception:  # noqa: BLE001
        log.exception("indexer: could not read audit rows for %s", sig)
        existing = Counter()
    seen: Counter = Counter()
    synced_requests: dict[str, dict[str, Any] | None] = {}
    synced_providers: set[str] = set()
    processed = 0

    for ev in events:
        name = ev["name"]
        data = ev["data"]
        ev_slot = int(ev.get("slot") or slot)
        occurrence = seen[name]
        seen[name] += 1

        try:
            await _apply_event(name, data, sig, ev_slot, synced_requests, synced_providers)
        except Exception:  # noqa: BLE001
            log.exception("indexer: failed to apply %s from %s", name, sig)

        if occurrence < existing.get(name, 0):
            processed += 1
            continue  # already in the audit log (re-processed after a crash)
        try:
            field = ACTOR_FIELD.get(name)
            append_event(
                name,
                payload=_json_safe(data),
                request_pda=data.get("request"),
                actor=data.get(field) if field else None,
                tx_sig=sig,
                slot=ev_slot,
            )
            processed += 1
        except Exception:  # noqa: BLE001
            log.exception("indexer: failed to append audit event %s from %s", name, sig)
    return processed


async def _collect_new_signatures(cursor: str | None) -> list[dict[str, Any]]:
    """All program signatures newer than `cursor`, newest-first."""
    chain = get_chain()
    collected: list[dict[str, Any]] = []
    before: str | None = None
    for _ in range(MAX_SIGNATURE_PAGES):
        page = await chain.get_signatures_for_program(until=cursor, limit=SIGNATURE_PAGE_SIZE, before=before)
        if not page:
            break
        collected.extend(page)
        if len(page) < SIGNATURE_PAGE_SIZE:
            break
        before = page[-1]["signature"]
    else:
        log.warning(
            "indexer: signature backlog exceeds %d; indexing the newest batch only",
            SIGNATURE_PAGE_SIZE * MAX_SIGNATURE_PAGES,
        )
    return collected


async def index_once() -> int:
    """Index new program transactions since the cursor. Returns the number of events processed."""
    async with _index_lock:
        chain = get_chain()
        cursor = _get_cursor()
        signatures = await _collect_new_signatures(cursor)
        if not signatures:
            return 0

        total = 0
        for entry in reversed(signatures):  # oldest-first
            sig = entry["signature"]
            if entry.get("err") is not None:
                log.debug("indexer: skipping failed tx %s (%s)", sig, entry["err"])
                _set_cursor(sig)
                continue
            try:
                events = await chain.get_transaction_events(sig, require=True)
            except ChainError as e:
                # RPC hiccup or tx not yet retrievable: stop here and retry from this tx next tick.
                log.warning("indexer: could not load tx %s, will retry: %s", sig, e)
                break
            if events:
                total += await _process_transaction(sig, int(entry.get("slot") or 0), events)
            _set_cursor(sig)

        if total:
            log.info("indexer: processed %d event(s)", total)
        return total


# ------------------------------------------------------------------ audit anchoring

async def maybe_anchor_audit_root() -> str | None:
    """Anchor the audit-log head on chain once `audit_anchor_every` rows accumulated since the last anchor."""
    every = int(settings.audit_anchor_every or 0)
    if every <= 0:
        return None
    async with _anchor_lock:
        last = first(
            table("audit_log")
            .select("seq")
            .filter("anchored_tx", "not.is", "null")
            .order("seq", desc=True)
            .limit(1)
            .execute()
        )
        since = int(last["seq"]) if last else 0
        resp = table("audit_log").select("seq", count="exact").gt("seq", since).limit(1).execute()
        pending = int(getattr(resp, "count", None) or 0)
        if pending < every:
            return None

        head = latest_row()
        if not head or not head.get("row_hash"):
            return None
        admin = admin_keypair()
        if admin is None:
            log.warning("maybe_anchor_audit_root: no admin keypair configured; skipping")
            return None

        sig = await get_chain().anchor_audit_root(admin, bytes.fromhex(head["row_hash"]))
        _update("audit_log", {"anchored_tx": sig}, seq=head["seq"])
        log.info("anchored audit root %s (seq %s) in %s", head["row_hash"], head["seq"], sig)
        return sig
