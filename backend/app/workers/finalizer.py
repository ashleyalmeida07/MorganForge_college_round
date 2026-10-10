"""Finalizer worker: drives requests through the permissionless settlement steps.

Mirrors the on-chain conditions in programs/verity_core/src/lib.rs so we only
send transactions that should succeed:

  AwaitingVerification
    - attest_count_mismatch >= quorum and no dispute account yet -> open_dispute
      (claimed hash = most common counted mismatching output_hash that differs
      from the receipt's output_hash; challenger != provider)
    - attest_count_match >= quorum and now >= receipt_at + window -> finalize
  Disputed (dispute.status == "Open")
    - supporting attestations (counted, !matches, output_hash == claimed) >= quorum
      -> resolve_dispute (challenger wins immediately)
    - else once now >= opened_at + window -> resolve_dispute (provider wins)
  Open / Claimed with now > deadline -> expire_request
  Rejected and not settled -> expire_request (refund bounty to requester)
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from typing import Any

from app.chain import keys
from app.chain.client import ChainError, get_chain
from app.workers.common import (
    Backoff,
    chain_error_details,
    record_error,
    safe_append_event,
    safe_sync_provider,
    safe_sync_request,
)

logger = logging.getLogger("verity.workers.finalizer")

JOB = "finalizer"
CLOCK_SKEW_SECS = 3          # local wall clock vs. validator clock safety margin
MAX_ACTIONS_PER_TICK = 10

_backoff = Backoff(base=15.0, cap=300.0)
_background: set[asyncio.Task] = set()


async def finalizer_tick() -> dict[str, Any]:
    payer = keys.payer_keypair()
    if payer is None:
        return {"skipped": "no payer keypair configured"}
    chain = get_chain()
    cfg = await chain.get_config()
    if cfg is None:
        return {"skipped": "config account not initialized"}
    quorum = int(cfg.get("required_attestations") or 1)
    window = int(cfg.get("challenge_window_secs") or 0)

    stats: dict[str, Any] = {
        "disputes_opened": 0, "finalized": 0, "resolved": 0, "expired": 0, "refunded": 0,
    }
    budget = [MAX_ACTIONS_PER_TICK]

    for req in await chain.list_requests("AwaitingVerification"):
        if budget[0] <= 0:
            break
        await _guard(_handle_awaiting, chain, payer, req, quorum, window, stats, budget)

    for req in await chain.list_requests("Disputed"):
        if budget[0] <= 0:
            break
        await _guard(_handle_disputed, chain, payer, req, quorum, window, stats, budget)

    now = time.time()
    for status in ("Open", "Claimed"):
        for req in await chain.list_requests(status):
            if budget[0] <= 0:
                break
            if now > int(req.get("deadline") or 0) + CLOCK_SKEW_SECS and not req.get("settled"):
                await _guard(_expire, chain, payer, req, "expired", stats, budget)

    for req in await chain.list_requests("Rejected"):
        if budget[0] <= 0:
            break
        if not req.get("settled"):
            await _guard(_expire, chain, payer, req, "refunded", stats, budget)

    return stats


async def _guard(fn: Any, chain: Any, payer: Any, req: dict, *args: Any) -> None:
    pda = req["pda"]
    key = (fn.__name__, pda)
    if not _backoff.ready(key):
        return
    try:
        await fn(chain, payer, req, *args)
        _backoff.success(key)
    except ChainError as e:
        n = _backoff.failure(key)
        logger.warning("%s failed for %s: %s (code=%s)", fn.__name__, pda, e, getattr(e, "code", None))
        record_error(JOB, e, f"{fn.__name__.lstrip('_')} {pda}")
        if n == 1:
            await safe_append_event(
                "WorkerError",
                {"worker": JOB, "action": fn.__name__.lstrip("_"), **chain_error_details(e)},
                request_pda=pda,
            )
    except Exception as e:
        _backoff.failure(key)
        logger.exception("%s crashed for %s", fn.__name__, pda)
        record_error(JOB, e, f"{fn.__name__.lstrip('_')} {pda}")


# ---------------------------------------------------------------- AwaitingVerification


def _pick_challenger(provider: str | None, payer: Any) -> Any | None:
    candidates = []
    verifiers = keys.verifier_keypairs()
    if verifiers:
        candidates.append(verifiers[0])
    candidates.append(payer)
    candidates.extend(verifiers[1:])
    for kp in candidates:
        if kp is not None and str(kp.pubkey()) != provider:
            return kp
    return None


async def _handle_awaiting(
    chain: Any, payer: Any, req: dict, quorum: int, window: int, stats: dict, budget: list[int]
) -> None:
    pda = req["pda"]
    provider = req.get("provider")
    matches = int(req.get("attest_count_match") or 0)
    mismatches = int(req.get("attest_count_mismatch") or 0)

    if mismatches >= quorum and await chain.get_dispute(pda) is None:
        receipt = await chain.get_receipt(pda)
        if receipt is not None:
            receipt_hash = receipt["output_hash"].lower()
            atts = await chain.list_attestations(pda)
            counts = Counter(
                a["output_hash"].lower()
                for a in atts
                if a.get("counted") and not a.get("matches")
                and a.get("output_hash", "").lower() != receipt_hash
            )
            if counts:
                claimed_hex, support = counts.most_common(1)[0]
                challenger = _pick_challenger(provider, payer)
                if challenger is None:
                    logger.warning("no eligible challenger keypair for %s", pda)
                else:
                    budget[0] -= 1
                    sig = await chain.open_dispute(challenger, pda, bytes.fromhex(claimed_hex))
                    stats["disputes_opened"] += 1
                    logger.info("opened dispute on %s (claimed %s, support %d/%d, tx %s)",
                                pda, claimed_hex, support, quorum, sig)
                    try:
                        from app.db import upsert
                        from app.utils import utcnow_iso
                        await asyncio.to_thread(
                            upsert, "disputes", {
                                "request_pda": pda,
                                "challenger": str(challenger.pubkey()),
                                "claimed_output_hash": claimed_hex,
                                "status": "Open",
                                "open_tx": sig,
                                "opened_at": utcnow_iso(),
                            }, "request_pda"
                        )
                    except Exception as e:
                        logger.warning("failed to upsert dispute for %s: %s", pda, e)
                    await safe_sync_request(pda, sig)
                    return
            else:
                logger.info("%s has %d mismatches but none disagree on output_hash; "
                            "no disputable claim", pda, mismatches)

    receipt_at = int(req.get("receipt_at") or 0)
    if matches >= quorum and time.time() >= receipt_at + window + CLOCK_SKEW_SECS:
        budget[0] -= 1
        sig = await chain.finalize(payer, pda)
        stats["finalized"] += 1
        logger.info("finalized %s (tx %s)", pda, sig)
        await safe_sync_request(pda, sig)
        await safe_sync_provider(provider)


# ---------------------------------------------------------------- Disputed


async def _handle_disputed(
    chain: Any, payer: Any, req: dict, quorum: int, window: int, stats: dict, budget: list[int]
) -> None:
    pda = req["pda"]
    dispute = await chain.get_dispute(pda)
    if dispute is None or dispute.get("status") != "Open":
        return
    claimed = (dispute.get("claimed_output_hash") or "").lower()
    atts = await chain.list_attestations(pda)
    support = len({
        a["verifier"]
        for a in atts
        if a.get("counted") and not a.get("matches") and (a.get("output_hash") or "").lower() == claimed
    })
    opened_at = int(dispute.get("opened_at") or 0)
    window_over = time.time() >= opened_at + window + CLOCK_SKEW_SECS
    if support < quorum and not window_over:
        return

    budget[0] -= 1
    sig = await chain.resolve_dispute(payer, pda)
    stats["resolved"] += 1
    logger.info("resolved dispute on %s (support %d/%d, tx %s)", pda, support, quorum, sig)
    new_status = "ChallengerWon" if support >= quorum else "ProviderWon"
    try:
        from app.db import table
        from app.utils import utcnow_iso
        await asyncio.to_thread(
            lambda: table("disputes")
            .update({"status": new_status, "resolve_tx": sig, "resolved_at": utcnow_iso()})
            .eq("request_pda", pda)
            .execute()
        )
    except Exception as e:
        logger.warning("failed to update dispute row for %s: %s", pda, e)
    await safe_sync_request(pda, sig)
    await safe_sync_provider(req.get("provider"))
    _trigger_explanation(pda)



def _trigger_explanation(pda: str) -> None:
    try:
        from app.ai import explain_dispute
    except ImportError:
        return

    async def _run() -> None:
        try:
            await explain_dispute(pda)
        except Exception as e:
            logger.warning("AI dispute explanation failed for %s: %s", pda, e)

    task = asyncio.create_task(_run())
    _background.add(task)
    task.add_done_callback(_background.discard)


# ---------------------------------------------------------------- expiry / refund


async def _expire(chain: Any, payer: Any, req: dict, kind: str, stats: dict, budget: list[int]) -> None:
    pda = req["pda"]
    budget[0] -= 1
    sig = await chain.expire_request(payer, pda)
    stats[kind] += 1
    logger.info("expire_request %s (%s, tx %s)", pda, kind, sig)
    await safe_sync_request(pda, sig)
    if req.get("provider"):
        await safe_sync_provider(req.get("provider"))
