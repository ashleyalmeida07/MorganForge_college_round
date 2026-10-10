"""Provider worker: claim open requests, execute the committed program, sign and
submit an execution receipt, publish the output blob.

Chaos flags (app.db.chaos):
  PROVIDER_TAMPER_OUTPUT  corrupt output, re-hash, sign honestly -> verifiers mismatch
  PROVIDER_SWAP_PROGRAM   execute a different registered program (falls back to tamper)
  PROVIDER_BAD_SIG        sign with a random key -> on-chain Ed25519 check rejects tx
  STORAGE_TAMPER_INPUT    overwrite the input blob before execution -> InputTampered
  STORAGE_TAMPER_OUTPUT   upload a corrupted output blob after the receipt -> OutputTampered
"""
from __future__ import annotations

import logging
import time
from typing import Any

from solders.keypair import Keypair

from app.chain import keys
from app.chain.client import ChainError, get_chain
from app.chain.signer import receipt_message, sign_receipt
from app.config import settings
from app.db import BUCKET_OUTPUTS, CHAOS_FLAGS, chaos, trace_blob_path, upload_blob
from app.engine import runner
from app.engine import trace as tracing
from app.ipfs import pin_bytes
from app.utils import canonical, sha256, sha256_hex
from app.workers.common import (
    Backoff,
    chain_error_details,
    load_input,
    load_program_wasm,
    maybe_await,
    pick_other_program,
    record_error,
    run_in_thread,
    safe_append_event,
    safe_sync_request,
    set_receipt_output,
    tamper_output,
    tamper_stored_input,
)

logger = logging.getLogger("verity.workers.provider")

JOB = "provider"
MAX_JOBS_PER_TICK = 3
CLAIM_MARGIN_SECS = 20      # don't claim a job that can't realistically finish before its deadline
SUBMIT_MARGIN_SECS = 3      # submit_receipt requires now <= deadline on chain

# Requests we gave up on for this process lifetime (tampered input/program, rejected
# receipt, deterministic execution failure). Prevents spamming txs / audit rows.
_abandoned: dict[str, str] = {}
_backoff = Backoff(base=10.0, cap=300.0)
_last_unready_log = 0.0


def abandoned_requests() -> dict[str, str]:
    return dict(_abandoned)


def _abandon(pda: str, reason: str) -> None:
    _abandoned[pda] = reason
    if len(_abandoned) > 10_000:
        for k in list(_abandoned)[:2000]:
            _abandoned.pop(k, None)


def _active_flags() -> list[str]:
    return [f for f in CHAOS_FLAGS if chaos(f)]


async def _can_claim(chain: Any, owner: str) -> bool:
    """Provider account must exist, be active and meet the minimum stake."""
    global _last_unready_log
    try:
        prov = await chain.get_provider(owner)
        cfg = await chain.get_config()
    except Exception as e:
        record_error(JOB, e, "reading provider/config")
        return False
    reason = None
    if cfg is None:
        reason = "config account not initialized"
    elif prov is None:
        reason = "provider account not registered"
    elif not prov.get("active", True):
        reason = "provider account inactive"
    elif int(prov.get("stake") or 0) < int(cfg.get("min_provider_stake") or 0):
        reason = f"stake {prov.get('stake')} < min {cfg.get('min_provider_stake')}"
    if reason:
        if time.time() - _last_unready_log > 60:
            logger.warning("provider %s cannot claim jobs: %s", owner, reason)
            _last_unready_log = time.time()
        return False
    return True


async def provider_tick() -> dict[str, Any]:
    kp = keys.provider_keypair()
    if kp is None:
        return {"skipped": "no provider keypair configured"}
    chain = get_chain()
    me = str(kp.pubkey())
    now = time.time()

    open_reqs = await chain.list_requests("Open")
    claimed_reqs = [r for r in await chain.list_requests("Claimed") if r.get("provider") == me]

    candidates: list[tuple[bool, dict]] = []
    for r in claimed_reqs:  # resume jobs we claimed but never receipted
        pda = r["pda"]
        if pda in _abandoned or not _backoff.ready(pda):
            continue
        if int(r.get("deadline") or 0) <= now + SUBMIT_MARGIN_SECS:
            continue
        candidates.append((False, r))

    if open_reqs and await _can_claim(chain, me):
        for r in open_reqs:
            pda = r["pda"]
            if pda in _abandoned or not _backoff.ready(pda):
                continue
            if int(r.get("deadline") or 0) <= now + CLAIM_MARGIN_SECS:
                continue
            candidates.append((True, r))

    candidates.sort(key=lambda c: (int(c[1].get("deadline") or 0), c[0]))
    stats = {"open": len(open_reqs), "resumable": len(claimed_reqs), "processed": 0, "submitted": 0}
    for needs_claim, req in candidates[:MAX_JOBS_PER_TICK]:
        pda = req["pda"]
        try:
            ok = await _process(chain, kp, req, needs_claim)
            stats["processed"] += 1
            if ok:
                stats["submitted"] += 1
                _backoff.success(pda)
        except Exception as e:
            n = _backoff.failure(pda)
            logger.exception("provider failed on %s", pda)
            record_error(JOB, e, f"request {pda}")
            if n == 1:
                await safe_append_event(
                    "WorkerError",
                    {"worker": JOB, "error": f"{type(e).__name__}: {e}"[:500]},
                    request_pda=pda,
                    actor=me,
                )
    return stats


async def _process(chain: Any, kp: Keypair, req: dict, needs_claim: bool) -> bool:
    pda: str = req["pda"]
    me = str(kp.pubkey())
    program_hash_hex: str = req["program_hash"].lower()
    input_hash_hex: str = req["input_hash"].lower()

    # ---------------------------------------------------------- claim
    if needs_claim:
        try:
            claim_sig = await chain.claim_request(kp, pda)
        except ChainError as e:
            _backoff.failure(pda)
            record_error(JOB, e, f"claim {pda}")
            return False
        logger.info("claimed request %s (tx %s)", pda, claim_sig)
        await safe_sync_request(pda, claim_sig)

    flags = _active_flags()
    swap = "PROVIDER_SWAP_PROGRAM" in flags
    tamper = "PROVIDER_TAMPER_OUTPUT" in flags
    bad_sig = "PROVIDER_BAD_SIG" in flags

    # ---------------------------------------------------------- simulated storage attack
    if "STORAGE_TAMPER_INPUT" in flags:
        try:
            new_hash = await run_in_thread(tamper_stored_input, input_hash_hex)
            logger.warning("chaos STORAGE_TAMPER_INPUT: overwrote input blob for %s", pda)
            await safe_append_event(
                "StorageTampered",
                {"target": "input", "uri": f"inputs/{input_hash_hex}.json",
                 "expected_hash": input_hash_hex, "stored_hash": new_hash, "chaos": True},
                request_pda=pda,
                actor="chaos",
            )
        except Exception as e:
            record_error(JOB, e, f"chaos input tamper {pda}")

    # ---------------------------------------------------------- integrity: input
    input_bytes = await run_in_thread(load_input, input_hash_hex)
    actual_input_hash = sha256_hex(input_bytes)
    if actual_input_hash != input_hash_hex:
        logger.error("input hash mismatch for %s: chain %s storage %s",
                     pda, input_hash_hex, actual_input_hash)
        await safe_append_event(
            "InputTampered",
            {"expected_input_hash": input_hash_hex, "actual_input_hash": actual_input_hash,
             "detected_by": "provider", "action": "aborted; no receipt submitted"},
            request_pda=pda,
            actor=me,
        )
        _abandon(pda, "input tampered")
        return False

    # ---------------------------------------------------------- execute
    result: runner.ExecResult | None = None
    mode = "honest"
    executed_program = program_hash_hex

    if swap:
        other = await run_in_thread(pick_other_program, program_hash_hex)
        if other:
            try:
                other_wasm = await run_in_thread(load_program_wasm, other)
                result = await run_in_thread(
                    runner.run, other_wasm, input_bytes, None, sha256(input_bytes), settings.fuel_limit
                )
                mode = "swapped_program"
                executed_program = other
                logger.warning("chaos PROVIDER_SWAP_PROGRAM: ran %s instead of %s for %s",
                               other, program_hash_hex, pda)
            except Exception as e:
                logger.warning("swapped program %s failed on %s (%s); falling back to tamper",
                               other, pda, e)
                result = None
                tamper = True
        else:
            logger.warning("PROVIDER_SWAP_PROGRAM: no other program registered; tampering output")
            tamper = True

    if result is None:
        wasm = await run_in_thread(load_program_wasm, program_hash_hex)
        actual_program_hash = sha256_hex(wasm)
        if actual_program_hash != program_hash_hex:
            logger.error("program hash mismatch for %s: chain %s storage %s",
                         pda, program_hash_hex, actual_program_hash)
            await safe_append_event(
                "ProgramTampered",
                {"expected_program_hash": program_hash_hex,
                 "actual_program_hash": actual_program_hash,
                 "detected_by": "provider", "action": "aborted; no receipt submitted"},
                request_pda=pda,
                actor=me,
            )
            _abandon(pda, "program tampered")
            return False
        try:
            result = await run_in_thread(
                runner.run, wasm, input_bytes,
                bytes.fromhex(program_hash_hex), bytes.fromhex(input_hash_hex), settings.fuel_limit,
            )
        except runner.ExecutionError as e:
            logger.error("execution failed for %s: %s", pda, e)
            await safe_append_event(
                "ExecutionFailed",
                {"program_hash": program_hash_hex, "input_hash": input_hash_hex,
                 "error": str(e)[:500], "detected_by": "provider"},
                request_pda=pda,
                actor=me,
            )
            _abandon(pda, f"execution failed: {e}")
            return False

    fuel_used = result.fuel_used
    output_obj = result.output
    output_bytes = result.output_bytes
    output_hash = result.output_hash
    trace_root = result.trace_root

    if tamper:
        output_obj = tamper_output(result.output)
        output_bytes = canonical(output_obj)
        output_hash = sha256(output_bytes)
        trace_root = runner.compute_trace_root(input_bytes, output_bytes, result.checkpoints)
        mode = "tampered_output" if mode == "honest" else f"{mode}+tampered_output"
        logger.warning("chaos PROVIDER_TAMPER_OUTPUT: corrupted output for %s", pda)

    # ---------------------------------------------------------- sign + submit
    msg = receipt_message(
        pda,
        bytes.fromhex(program_hash_hex),
        bytes.fromhex(input_hash_hex),
        output_hash,
        trace_root,
        fuel_used,
    )
    signer = Keypair() if bad_sig else kp
    signature = sign_receipt(signer, msg)
    if bad_sig:
        logger.warning("chaos PROVIDER_BAD_SIG: signing %s with random key %s", pda, signer.pubkey())

    try:
        tx_sig = await chain.submit_receipt(kp, pda, output_hash, trace_root, fuel_used, signature)
    except ChainError as e:
        details = chain_error_details(e)
        if bad_sig:
            logger.warning("receipt for %s rejected on-chain (expected, bad sig): %s", pda, e)
            await safe_append_event(
                "ReceiptRejected",
                {**details, "reason": "invalid provider signature (chaos PROVIDER_BAD_SIG)",
                 "forged_signer": str(signer.pubkey()), "output_hash": output_hash.hex()},
                request_pda=pda,
                actor=me,
            )
            _abandon(pda, "receipt rejected (bad signature)")
            return False
        n = _backoff.failure(pda)
        record_error(JOB, e, f"submit_receipt {pda}")
        if n == 1:
            await safe_append_event(
                "ReceiptRejected", {**details, "reason": "submit_receipt failed"},
                request_pda=pda, actor=me,
            )
        return False

    logger.info("receipt submitted for %s (mode=%s, tx %s)", pda, mode, tx_sig)

    # ---------------------------------------------------------- publish output
    out_path = f"{pda}.json"
    out_uri = f"{BUCKET_OUTPUTS}/{out_path}"
    stored_bytes = output_bytes
    if chaos("STORAGE_TAMPER_OUTPUT"):
        stored_bytes = canonical(tamper_output(output_obj))
        logger.warning("chaos STORAGE_TAMPER_OUTPUT: uploading corrupted output blob for %s", pda)
    try:
        out_uri = await run_in_thread(upload_blob, BUCKET_OUTPUTS, out_path, stored_bytes, "application/json")
    except Exception as e:
        record_error(JOB, e, f"upload output {pda}")

    if stored_bytes is not output_bytes:
        await safe_append_event(
            "OutputTampered",
            {"uri": out_uri, "receipt_output_hash": output_hash.hex(),
             "stored_output_hash": sha256_hex(stored_bytes), "chaos": True},
            request_pda=pda,
            actor="chaos",
        )

    # Publish the execution trace (TRACE_V2) the receipt's trace_root commits to, so any
    # challenger can locate the first divergent step against their own re-execution.
    trace_uri = None
    try:
        trace_doc = tracing.trace_document(
            input_bytes, list(result.checkpoints), output_bytes,
            request_pda=pda, program_hash=executed_program,
        )
        trace_doc["fuel_used"] = fuel_used
        trace_uri = await run_in_thread(
            upload_blob, BUCKET_OUTPUTS, trace_blob_path(pda), canonical(trace_doc), "application/json"
        )
    except Exception as e:
        record_error(JOB, e, f"upload trace {pda}")

    ipfs_cid = None
    try:
        ipfs_cid = await maybe_await(
            await run_in_thread(pin_bytes, output_bytes, f"verity-output-{pda}.json")
        )
    except Exception as e:
        logger.warning("IPFS pin failed for %s: %s", pda, e)

    await safe_sync_request(pda, tx_sig)
    try:
        await run_in_thread(set_receipt_output, pda, out_uri, ipfs_cid)
    except Exception as e:
        record_error(JOB, e, f"update receipt row {pda}")

    await safe_append_event(
        "ExecutionCompleted",
        {
            "output_hash": output_hash.hex(),
            "trace_root": trace_root.hex(),
            "trace_steps": len(result.checkpoints) + 2,
            "trace_uri": trace_uri,
            "fuel_used": fuel_used,
            "ipfs_cid": ipfs_cid,
            "program_hash": program_hash_hex,
            "executed_program_hash": executed_program,
            "input_hash": input_hash_hex,
            "output_uri": out_uri,
            "mode": mode,
            "chaos": flags,
        },
        request_pda=pda,
        actor=me,
        tx_sig=tx_sig,
    )
    return True
