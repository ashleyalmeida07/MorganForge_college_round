"""Disputes: wallet-tx preparation and listing."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.db import table
from app.routes.common import addr_link, bytes32_list, chain_or_none, chain_read, parse_iso, tx_link
from app.schemas import DisputePrepareIn, DisputePrepareOut

router = APIRouter(tags=["disputes"])

DISPUTE_STATUSES = {"Open", "ChallengerWon", "ProviderWon"}


@router.post("/disputes/prepare", response_model=DisputePrepareOut)
async def prepare_dispute(body: DisputePrepareIn) -> DisputePrepareOut:
    chain = chain_or_none()
    if chain is None:
        raise HTTPException(503, "chain client unavailable")
    pda = body.request_pda.strip()
    try:
        receipt_pda = str(chain.receipt_pda(pda))
        dispute_pda = str(chain.dispute_pda(pda))
        config_pda = str(chain.config_pda())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"invalid request PDA: {e}") from e

    request, receipt, config, existing = await asyncio.gather(
        chain_read("get_request", pda),
        chain_read("get_receipt", pda),
        chain_read("get_config"),
        chain_read("get_dispute", pda),
    )

    warnings: list[str] = []
    if request is None:
        raise HTTPException(404, "request account not found on chain")
    if receipt is None:
        raise HTTPException(409, "no receipt has been submitted for this request yet")
    if existing is not None:
        raise HTTPException(409, f"a dispute already exists for this request (status {existing.get('status')})")
    if request.get("status") != "AwaitingVerification":
        raise HTTPException(
            409, f"request status is {request.get('status')}; disputes can only be opened while AwaitingVerification"
        )
    if receipt.get("output_hash") and receipt["output_hash"].lower() == body.claimed_output_hash:
        raise HTTPException(400, "claimed output hash equals the receipt's output hash; nothing to dispute")
    if body.challenger and request.get("provider") and body.challenger.strip() == request["provider"]:
        raise HTTPException(400, "the provider cannot dispute its own receipt")

    # Informative only: does any verifier attestation support the claim?
    attestations = await asyncio.to_thread(
        lambda: table("attestations").select("verifier_pubkey,output_hash,counted").eq("request_pda", pda)
        .execute().data or []
    )
    supporting = [a for a in attestations if (a.get("output_hash") or "").lower() == body.claimed_output_hash]
    required = (config or {}).get("required_attestations")
    if not supporting:
        warnings.append(
            "No verifier attestation currently supports the claimed hash; if the quorum does not agree "
            "with you by the end of the challenge window, your stake goes to the provider."
        )
    elif required and sum(1 for a in supporting if a.get("counted")) < int(required):
        warnings.append(
            f"Only {len(supporting)} attestation(s) support the claim; {required} counted attestations are "
            "needed for the challenger to win."
        )

    return DisputePrepareOut(
        program_id=settings.program_id,
        cluster=settings.cluster,
        request_pda=pda,
        receipt_pda=receipt_pda,
        dispute_pda=dispute_pda,
        config_pda=config_pda,
        min_dispute_stake=(config or {}).get("min_dispute_stake"),
        claimed_output_hash=body.claimed_output_hash,
        claimed_output_hash_bytes32=bytes32_list(body.claimed_output_hash),
        receipt_output_hash=receipt.get("output_hash"),
        request_status=request.get("status"),
        warnings=warnings,
    )


def _window_info(opened_at: Any, window_secs: int | None) -> dict[str, Any]:
    """Challenge-window timing for a dispute: when it ends and how long is left."""
    opened = parse_iso(opened_at)
    if opened is None or not window_secs:
        return {"window_ends_at": None, "seconds_remaining": None, "window_expired": None}
    ends = opened.timestamp() + int(window_secs)
    now = datetime.now(timezone.utc).timestamp()
    return {
        "window_ends_at": datetime.fromtimestamp(ends, tz=timezone.utc).isoformat(),
        "seconds_remaining": max(0, int(ends - now)),
        "window_expired": now >= ends,
    }


@router.get("/disputes")
async def list_disputes(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    """List disputes with the evidence needed to reason about resolution.

    Each row carries the challenger's claimed hash, the number of counted
    verifier attestations that support the claim, the quorum required to win,
    and the remaining challenge window (opened_at + challenge_window_secs).
    """
    if status and status not in DISPUTE_STATUSES:
        raise HTTPException(400, f"unknown dispute status; expected one of {sorted(DISPUTE_STATUSES)}")

    def _q() -> list[dict[str, Any]]:
        q = table("disputes").select("*")
        if status:
            q = q.eq("status", status)
        return q.order("opened_at", desc=True).range(offset, offset + limit - 1).execute().data or []

    disputes = await asyncio.to_thread(_q)
    if not disputes:
        return []

    pdas = [d["request_pda"] for d in disputes if d.get("request_pda")]
    config = await chain_read("get_config")
    required = int((config or {}).get("required_attestations") or 0)
    window_secs = int((config or {}).get("challenge_window_secs") or 0)

    def _by_pda(rows: list[dict[str, Any]], key: str = "request_pda") -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            out.setdefault(r.get(key) or "", []).append(r)
        return out

    requests: dict[str, dict[str, Any]] = {}
    program_names: dict[str, str] = {}
    attest_by_pda: dict[str, list[dict[str, Any]]] = {}
    receipt_by_pda: dict[str, dict[str, Any]] = {}
    if pdas:
        req_rows, receipts, attestations = await asyncio.gather(
            asyncio.to_thread(lambda: table("requests").select("*").in_("request_pda", pdas).execute().data or []),
            asyncio.to_thread(
                lambda: table("receipts").select("request_pda,provider_pubkey,output_hash")
                .in_("request_pda", pdas).execute().data or []
            ),
            asyncio.to_thread(
                lambda: table("attestations")
                .select("request_pda,verifier_pubkey,output_hash,matches,counted").in_("request_pda", pdas).execute().data or []
            ),
        )
        requests = {r["request_pda"]: r for r in req_rows}
        receipt_by_pda = {r["request_pda"]: r for r in receipts if r.get("request_pda")}
        attest_by_pda = _by_pda(attestations)
        hashes = sorted({r["program_hash"] for r in req_rows if r.get("program_hash")})
        if hashes:
            progs = await asyncio.to_thread(
                lambda: table("programs").select("program_hash,name").in_("program_hash", hashes).execute().data
                or []
            )
            program_names = {p["program_hash"]: p.get("name") for p in progs}

    out = []
    for d in disputes:
        pda = d.get("request_pda")
        req = requests.get(pda)
        receipt = receipt_by_pda.get(pda) or {}
        claimed = (d.get("claimed_output_hash") or "").lower().removeprefix("0x")
        atts = attest_by_pda.get(pda or "", [])
        support = {
            a.get("verifier_pubkey")
            for a in atts
            if a.get("counted") and not a.get("matches")
            and (a.get("output_hash") or "").lower().removeprefix("0x") == claimed
        }
        dissenters = [a.get("verifier_pubkey") for a in atts if a.get("counted") and not a.get("matches")]
        out.append({
            **d,
            **(_window_info(d.get("opened_at"), window_secs) if d.get("status") == "Open" else
               {"window_ends_at": None, "seconds_remaining": None, "window_expired": None}),
            "open_explorer": tx_link(d.get("open_tx")),
            "resolve_explorer": tx_link(d.get("resolve_tx")),
            "request_explorer": addr_link(pda),
            "challenger_explorer": addr_link(d.get("challenger_pubkey") or d.get("challenger")),
            "provider_explorer": addr_link((req or {}).get("provider_pubkey") or receipt.get("provider_pubkey")),
            "request": req,
            "program_name": program_names.get((req or {}).get("program_hash")),
            "receipt_output_hash": receipt.get("output_hash"),
            "provider_pubkey": (req or {}).get("provider_pubkey") or receipt.get("provider_pubkey"),
            "support_count": len(support),
            "supporting_verifiers": sorted(v for v in support if v),
            "dissent_count": len(dissenters),
            "attestation_total": len(atts),
            "required_attestations": required or None,
            "challenge_window_secs": window_secs or None,
            "challenger_wins_now": bool(required) and len(support) >= required,
        })
    return out
