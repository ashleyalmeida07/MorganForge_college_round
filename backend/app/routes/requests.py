"""Computation requests: prepare/confirm, listing, detail, artifacts, evidence bundle, re-verification."""
from __future__ import annotations

import asyncio
import io
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

import base58

from app.audit import append_event
from app.auth import User, get_current_user, get_optional_user
from app.chain import indexer
from app.chain.signer import input_commitment_message, verify_receipt
from app.config import settings
from app.db import BUCKET_INPUTS, public_url, table, upload_blob, upsert
from app.ipfs import gateway_url, pin_bytes
from app.routes.auth_wallet import _decode_pubkey, _decode_signature
from app.routes.common import (
    addr_link,
    build_artifacts,
    build_request_detail,
    bytes32_list,
    call_any,
    chain_or_none,
    chain_read,
    db_input_commitment,
    db_program,
    db_request,
    decorate_request,
    input_uri_for,
    load_bundle,
    reexecute,
    safe,
)
from app.schemas import ConfirmRequestIn, InputCommitmentIn, PrepareRequestIn, PrepareRequestOut
from app.utils import canonical, sha256_hex

log = logging.getLogger("verity.routes.requests")
router = APIRouter(tags=["requests"])

REQUEST_STATUSES = {"Open", "Claimed", "AwaitingVerification", "Disputed", "Verified", "Rejected", "Expired"}
MAX_INPUT_BYTES = 1024 * 1024


def _wallets_of(user_id: str) -> list[str]:
    rows = table("wallets").select("pubkey").eq("user_id", user_id).execute().data or []
    return [r["pubkey"] for r in rows if r.get("pubkey")]


# ------------------------------------------------------------------ prepare / confirm

@router.post("/requests/prepare", response_model=PrepareRequestOut)
async def prepare_request(body: PrepareRequestIn, user: User = Depends(get_current_user)) -> PrepareRequestOut:
    program = await asyncio.to_thread(db_program, body.program_hash)
    if not program:
        raise HTTPException(404, "program not registered")

    try:
        canonical_bytes = canonical(body.input)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"input is not JSON-serializable: {e}") from e
    if len(canonical_bytes) > MAX_INPUT_BYTES:
        raise HTTPException(413, "input exceeds 1 MiB")

    input_hash = sha256_hex(canonical_bytes)
    input_uri = await asyncio.to_thread(
        upload_blob, BUCKET_INPUTS, f"{input_hash}.json", canonical_bytes, "application/json"
    )
    expected_uri = input_uri_for(input_hash)
    if input_uri != expected_uri:  # storage layer must honour the deterministic layout
        log.warning("upload returned unexpected uri %s (expected %s)", input_uri, expected_uri)
        input_uri = expected_uri
    input_uri_hash = sha256_hex(input_uri.encode("utf-8"))

    ipfs_cid = None
    if body.pin_ipfs:
        ipfs_cid = await call_any(pin_bytes, canonical_bytes, f"verity-input-{input_hash}.json")

    config_pda = predicted_pda = predicted_id = None
    chain = chain_or_none()
    if chain is not None:
        try:
            config_pda = str(chain.config_pda())
        except Exception as e:  # noqa: BLE001
            log.warning("config_pda failed: %s", e)
        if body.requester:
            cfg = await chain_read("get_config")
            if cfg and cfg.get("request_count") is not None:
                try:
                    predicted_id = int(cfg["request_count"])
                    predicted_pda = str(chain.request_pda(body.requester.strip(), predicted_id))
                except Exception as e:  # noqa: BLE001
                    log.warning("request PDA prediction failed: %s", e)
                    predicted_id = predicted_pda = None

    return PrepareRequestOut(
        program_hash=body.program_hash,
        input_hash=input_hash,
        input_uri=input_uri,
        input_uri_hash=input_uri_hash,
        canonical_input=canonical_bytes.decode("utf-8"),
        input_url=public_url(input_uri),
        ipfs_cid=ipfs_cid,
        ipfs_url=gateway_url(ipfs_cid),
        program_hash_bytes32=bytes32_list(body.program_hash),
        input_hash_bytes32=bytes32_list(input_hash),
        input_uri_hash_bytes32=bytes32_list(input_uri_hash),
        program_id=settings.program_id,
        cluster=settings.cluster,
        config_pda=config_pda,
        predicted_request_id=predicted_id,
        predicted_request_pda=predicted_pda,
    )


@router.post("/requests/commit-input")
async def commit_input(body: InputCommitmentIn, user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Store the Requester's wallet signature over (program_hash, input_hash, input_uri_hash).

    Must succeed *before* `create_request` is sent on-chain: `confirm_request` refuses to link a
    request that has no matching, valid commitment (§4.4 "Requester-signed input commitment").
    """
    pubkey_bytes = _decode_pubkey(body.requester)
    sig = _decode_signature(body.signature)
    msg = input_commitment_message(
        bytes.fromhex(body.program_hash), bytes.fromhex(body.input_hash), bytes.fromhex(body.input_uri_hash)
    )
    if not verify_receipt(pubkey_bytes, msg, sig):
        raise HTTPException(401, "input commitment signature verification failed")

    row = {
        "request_pda": body.request_pda.strip(),
        "requester_pubkey": body.requester.strip(),
        "program_hash": body.program_hash,
        "input_hash": body.input_hash,
        "input_uri_hash": body.input_uri_hash,
        "signature": base58.b58encode(sig).decode(),
    }
    await asyncio.to_thread(upsert, "input_commitments", row, "request_pda")
    return {"ok": True}


@router.post("/requests/confirm")
async def confirm_request(body: ConfirmRequestIn, user: User = Depends(get_current_user)) -> dict[str, Any]:
    pda = body.request_pda.strip()
    try:
        synced = await indexer.sync_request(pda, body.tx_sig)
    except Exception as e:  # noqa: BLE001
        log.warning("sync_request failed for %s: %s", pda, e)
        synced = None
    if not synced:
        raise HTTPException(404, "request account not found on chain (is the transaction confirmed?)")

    row = await asyncio.to_thread(db_request, pda) or {}
    requester = synced.get("requester") or row.get("requester_pubkey")
    my_wallets = await asyncio.to_thread(_wallets_of, user.id)

    existing_owner = row.get("requester_user")
    if existing_owner and existing_owner != user.id and requester not in my_wallets:
        raise HTTPException(403, "request is already linked to another account")

    commitment = await asyncio.to_thread(db_input_commitment, pda)
    expected_program_hash = synced.get("program_hash") or row.get("program_hash")
    expected_input_hash = synced.get("input_hash") or row.get("input_hash")
    expected_input_uri_hash = synced.get("input_uri_hash") or row.get("input_uri_hash")
    commitment_valid = bool(
        commitment
        and commitment.get("requester_pubkey") == requester
        and (commitment.get("program_hash") or "").lower() == (expected_program_hash or "").lower()
        and (commitment.get("input_hash") or "").lower() == (expected_input_hash or "").lower()
        and (commitment.get("input_uri_hash") or "").lower() == (expected_input_uri_hash or "").lower()
    )
    if not commitment_valid:
        raise HTTPException(400, "missing or invalid requester-signed input commitment for this request")

    input_hash = synced.get("input_hash") or row.get("input_hash")
    update: dict[str, Any] = {"requester_user": user.id}
    if body.title:
        update["title"] = body.title.strip()
    if input_hash and not row.get("input_uri"):
        update["input_uri"] = input_uri_for(input_hash)
    if body.input_ipfs_cid and not row.get("input_ipfs_cid"):
        update["input_ipfs_cid"] = body.input_ipfs_cid.strip()
    if body.tx_sig and not row.get("create_tx"):
        update["create_tx"] = body.tx_sig
    await asyncio.to_thread(lambda: table("requests").update(update).eq("request_pda", pda).execute())

    try:
        await asyncio.to_thread(
            append_event,
            "RequestConfirmed",
            {
                "request_pda": pda,
                "tx_sig": body.tx_sig,
                "title": update.get("title"),
                "requester": requester,
                "requester_wallet_linked": requester in my_wallets,
                "program_hash": synced.get("program_hash"),
                "input_hash": input_hash,
                "user_id": user.id,
            },
            pda,
            user.email or user.id,
            body.tx_sig,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("audit append failed for RequestConfirmed: %s", e)

    detail = await build_request_detail(pda, include_integrity=False)
    if detail is None:
        raise HTTPException(404, "request not found")
    return detail


# ------------------------------------------------------------------ listing

@router.get("/requests")
async def list_requests(
    scope: Literal["mine", "all"] = Query(default="all"),
    status: str | None = Query(default=None),
    wallet: str | None = Query(default=None),
    program_hash: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User | None = Depends(get_optional_user),
) -> list[dict[str, Any]]:
    if status and status not in REQUEST_STATUSES:
        raise HTTPException(400, f"unknown status; expected one of {sorted(REQUEST_STATUSES)}")

    my_wallets: list[str] = []
    if scope == "mine":
        if user is None:
            raise HTTPException(401, "login required for scope=mine")
        my_wallets = await asyncio.to_thread(_wallets_of, user.id)

    def _query() -> list[dict[str, Any]]:
        q = table("requests").select("*")
        if scope == "mine" and user is not None:
            clauses = [f"requester_user.eq.{user.id}"]
            if my_wallets:
                clauses.append(f"requester_pubkey.in.({','.join(my_wallets)})")
            q = q.or_(",".join(clauses))
        if status:
            q = q.eq("status", status)
        if wallet:
            q = q.eq("requester_pubkey", wallet.strip())
        if program_hash:
            q = q.eq("program_hash", program_hash.strip().lower())
        return q.order("created_at", desc=True).range(offset, offset + limit - 1).execute().data or []

    rows = await asyncio.to_thread(_query)

    hashes = sorted({r["program_hash"] for r in rows if r.get("program_hash")})
    names: dict[str, str] = {}
    if hashes:
        progs = await asyncio.to_thread(
            lambda: table("programs").select("program_hash,name,version").in_("program_hash", hashes).execute().data
            or []
        )
        names = {p["program_hash"]: p.get("name") for p in progs}

    out = []
    for r in rows:
        d = decorate_request(r) or {}
        d["program_name"] = names.get(r.get("program_hash"))
        d["mine"] = bool(user and (r.get("requester_user") == user.id or r.get("requester_pubkey") in my_wallets))
        out.append(d)
    return out


# ------------------------------------------------------------------ detail / artifacts / evidence

@router.get("/requests/{pda}")
async def get_request(pda: str, integrity: bool = Query(default=True)) -> dict[str, Any]:
    detail = await build_request_detail(pda.strip(), include_integrity=integrity)
    if detail is None:
        raise HTTPException(404, "request not found in database or on chain")
    return detail


@router.get("/requests/{pda}/artifacts")
async def get_artifacts(pda: str) -> dict[str, Any]:
    b = await load_bundle(pda.strip())
    if b is None:
        raise HTTPException(404, "request not found")
    out = build_artifacts(b)
    out["links"] = {"request": addr_link(pda)}
    return out


@router.get("/requests/{pda}/evidence.zip")
async def get_evidence_zip(pda: str) -> StreamingResponse:
    from app.evidence import build_evidence_zip

    result = await build_evidence_zip(pda.strip())
    if result is None:
        raise HTTPException(404, "request not found")
    data, filename = result
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


@router.post("/requests/{pda}/reverify")
async def reverify_request(pda: str) -> dict[str, Any]:
    b = await load_bundle(pda.strip())
    if b is None:
        raise HTTPException(404, "request not found")
    report = await reexecute(b)
    attestations = b.get("attestations") or []
    if report.get("output_hash"):
        report["verifier_agreement"] = [
            {
                "verifier": a.get("verifier_pubkey"),
                "attested_output_hash": a.get("output_hash"),
                "agrees_with_server": a.get("output_hash") == report["output_hash"],
                "matches_receipt": a.get("matches"),
            }
            for a in attestations
        ]
    return report


async def refresh_request(pda: str) -> dict[str, Any] | None:
    """Helper for other routers: force a chain → DB sync, tolerating failures."""
    return await safe(indexer.sync_request(pda), what=f"sync_request {pda}")
