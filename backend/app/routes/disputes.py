"""Disputes: wallet-tx preparation and listing."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.db import table
from app.routes.common import addr_link, bytes32_list, chain_or_none, chain_read, tx_link
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


@router.get("/disputes")
async def list_disputes(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    if status and status not in DISPUTE_STATUSES:
        raise HTTPException(400, f"unknown dispute status; expected one of {sorted(DISPUTE_STATUSES)}")

    def _q() -> list[dict[str, Any]]:
        q = table("disputes").select("*")
        if status:
            q = q.eq("status", status)
        return q.order("opened_at", desc=True).range(offset, offset + limit - 1).execute().data or []

    disputes = await asyncio.to_thread(_q)
    pdas = [d["request_pda"] for d in disputes if d.get("request_pda")]
    requests: dict[str, dict[str, Any]] = {}
    program_names: dict[str, str] = {}
    if pdas:
        rows = await asyncio.to_thread(
            lambda: table("requests").select("*").in_("request_pda", pdas).execute().data or []
        )
        requests = {r["request_pda"]: r for r in rows}
        hashes = sorted({r["program_hash"] for r in rows if r.get("program_hash")})
        if hashes:
            progs = await asyncio.to_thread(
                lambda: table("programs").select("program_hash,name").in_("program_hash", hashes).execute().data
                or []
            )
            program_names = {p["program_hash"]: p.get("name") for p in progs}

    out = []
    for d in disputes:
        req = requests.get(d.get("request_pda"))
        out.append({
            **d,
            "open_explorer": tx_link(d.get("open_tx")),
            "resolve_explorer": tx_link(d.get("resolve_tx")),
            "request_explorer": addr_link(d.get("request_pda")),
            "request": req,
            "program_name": program_names.get((req or {}).get("program_hash")),
        })
    return out
