"""Verifier worker: every configured verifier independently re-executes each
receipted request and attests (output_hash, trace_root, fuel_used) on chain.

Chaos flag VERIFIER_LAZY: verifier #0 copies the provider's receipt without
executing anything (so it is outvoted when the provider cheats).
"""
from __future__ import annotations

import logging
from typing import Any

from app.chain import keys
from app.chain.client import get_chain
from app.config import settings
from app.db import chaos
from app.engine import runner
from app.utils import sha256_hex
from app.workers.common import (
    Backoff,
    load_input,
    load_program_wasm,
    record_error,
    run_in_thread,
    safe_append_event,
    safe_sync_request,
)

logger = logging.getLogger("verity.workers.verifier")

JOB = "verifier"
MAX_ATTESTATIONS_PER_VERIFIER_PER_TICK = 5
ATTESTABLE_STATUSES = ("AwaitingVerification", "Disputed")  # attest() accepts both

# (request_pda, verifier_pubkey) pairs we gave up on (tampered blobs / failed execution)
_abandoned: dict[tuple[str, str], str] = {}
_backoff = Backoff(base=10.0, cap=300.0)


async def verifier_tick() -> dict[str, Any]:
    verifiers = keys.verifier_keypairs()
    if not verifiers:
        return {"skipped": "no verifier keypairs configured"}
    chain = get_chain()

    requests: list[dict] = []
    for status in ATTESTABLE_STATUSES:
        requests.extend(await chain.list_requests(status))
    if not requests:
        return {"requests": 0, "attested": 0}
    requests.sort(key=lambda r: int(r.get("receipt_at") or 0))

    lazy_mode = chaos("VERIFIER_LAZY")
    receipts: dict[str, dict | None] = {}  # chain data is shared; execution is not
    stats = {"requests": len(requests), "attested": 0, "lazy": 0, "mismatches": 0}

    for idx, vkp in enumerate(verifiers):
        vpub = str(vkp.pubkey())
        done = 0
        for req in requests:
            if done >= MAX_ATTESTATIONS_PER_VERIFIER_PER_TICK:
                break
            pda = req["pda"]
            key = (pda, vpub)
            if req.get("provider") == vpub or key in _abandoned or not _backoff.ready(key):
                continue
            try:
                if await chain.get_attestation(pda, vpub) is not None:
                    continue
                if pda not in receipts:
                    receipts[pda] = await chain.get_receipt(pda)
                receipt = receipts[pda]
                if receipt is None:
                    continue
                outcome = await _attest_one(chain, vkp, idx, req, receipt, lazy_mode and idx == 0)
                if outcome is None:
                    continue
                done += 1
                stats["attested"] += 1
                if outcome == "lazy":
                    stats["lazy"] += 1
                elif outcome == "mismatch":
                    stats["mismatches"] += 1
                _backoff.success(key)
            except Exception as e:
                n = _backoff.failure(key)
                logger.exception("verifier %s failed on %s", vpub, pda)
                record_error(JOB, e, f"verifier {vpub[:8]} request {pda}")
                if n == 1:
                    await safe_append_event(
                        "WorkerError",
                        {"worker": JOB, "verifier_index": idx,
                         "error": f"{type(e).__name__}: {e}"[:500]},
                        request_pda=pda,
                        actor=vpub,
                    )
    return stats


async def _attest_one(
    chain: Any, vkp: Any, idx: int, req: dict, receipt: dict, lazy: bool
) -> str | None:
    """Returns "lazy" | "match" | "mismatch", or None if no attestation was sent."""
    pda: str = req["pda"]
    vpub = str(vkp.pubkey())

    if lazy:
        output_hash = bytes.fromhex(receipt["output_hash"])
        trace_root = bytes.fromhex(receipt["trace_root"])
        fuel_used = int(receipt["fuel_used"])
        outcome = "lazy"
        logger.warning("chaos VERIFIER_LAZY: verifier %s copying receipt for %s", vpub, pda)
    else:
        program_hash_hex = req["program_hash"].lower()
        input_hash_hex = req["input_hash"].lower()

        wasm = await run_in_thread(load_program_wasm, program_hash_hex)
        actual_ph = sha256_hex(wasm)
        if actual_ph != program_hash_hex:
            await safe_append_event(
                "ProgramTampered",
                {"expected_program_hash": program_hash_hex, "actual_program_hash": actual_ph,
                 "detected_by": "verifier", "verifier_index": idx,
                 "action": "aborted; no attestation"},
                request_pda=pda,
                actor=vpub,
            )
            _abandoned[(pda, vpub)] = "program tampered"
            return None

        input_bytes = await run_in_thread(load_input, input_hash_hex)
        actual_ih = sha256_hex(input_bytes)
        if actual_ih != input_hash_hex:
            await safe_append_event(
                "InputTampered",
                {"expected_input_hash": input_hash_hex, "actual_input_hash": actual_ih,
                 "detected_by": "verifier", "verifier_index": idx,
                 "action": "aborted; no attestation"},
                request_pda=pda,
                actor=vpub,
            )
            _abandoned[(pda, vpub)] = "input tampered"
            return None

        try:
            result = await run_in_thread(
                runner.run, wasm, input_bytes,
                bytes.fromhex(program_hash_hex), bytes.fromhex(input_hash_hex), settings.fuel_limit,
            )
        except runner.ExecutionError as e:
            await safe_append_event(
                "ExecutionFailed",
                {"program_hash": program_hash_hex, "input_hash": input_hash_hex,
                 "error": str(e)[:500], "detected_by": "verifier", "verifier_index": idx},
                request_pda=pda,
                actor=vpub,
            )
            _abandoned[(pda, vpub)] = f"execution failed: {e}"
            return None

        output_hash, trace_root, fuel_used = result.output_hash, result.trace_root, result.fuel_used
        matches = (
            output_hash.hex() == receipt["output_hash"].lower()
            and trace_root.hex() == receipt["trace_root"].lower()
            and fuel_used == int(receipt["fuel_used"])
        )
        outcome = "match" if matches else "mismatch"
        if matches:
            logger.info("verifier %s: %s matches receipt", vpub, pda)
        else:
            logger.warning(
                "verifier %s: %s MISMATCH (receipt %s / ours %s)",
                vpub, pda, receipt["output_hash"], output_hash.hex(),
            )

    # ChainError propagates to verifier_tick(), which records it and backs off.
    tx_sig = await chain.attest(vkp, pda, output_hash, trace_root, fuel_used)

    if lazy:
        await safe_append_event(
            "LazyAttestation",
            {"verifier_index": idx, "copied_output_hash": output_hash.hex(),
             "copied_trace_root": trace_root.hex(), "copied_fuel_used": fuel_used,
             "executed": False, "chaos": True},
            request_pda=pda,
            actor=vpub,
            tx_sig=tx_sig,
        )
    await safe_sync_request(pda, tx_sig)
    return outcome
