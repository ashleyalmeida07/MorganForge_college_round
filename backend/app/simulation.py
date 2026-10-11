"""One-click adversarial simulations for the admin demo.

Drives a *complete* request lifecycle on devnet — create -> claim -> execute ->
receipt -> independent re-execution -> attest -> dispute -> settle — with the
selected chaos flags armed, and records a detailed timestamped step log that the
admin UI streams into a terminal.

The heavy lifting is done by the same provider / verifier / finalizer workers
used in production (app.workers.*); this module only orchestrates them, briefly
shortens the on-chain challenge window for fast finalization, and narrates every
on-chain state transition and audit event.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import base58
from solders.keypair import Keypair

from app.chain import indexer, keys
from app.chain.client import get_chain
from app.chain.signer import input_commitment_message
from app.config import settings
from app.db import BUCKET_INPUTS, CHAOS_FLAGS, set_chaos_flag, table, upload_blob, upsert
from app.utils import canonical, explorer_addr, explorer_tx, sha256_hex, utcnow_iso

logger = logging.getLogger("verity.simulation")

TERMINAL = {"Verified", "Rejected", "Expired"}
DEFAULT_DEADLINE_SECS = 600
SHORT_DEADLINE_SECS = 55
FAST_WINDOW_SECS = 20
DEFAULT_BOUNTY = 10_000_000
MAX_SIM_SECONDS = 210
POLL_SECS = 2.0
FORCE_GAP = 18.0  # min seconds between forced worker ticks for a phase
MAX_SIMS = 25

# Each scenario: which chaos flags to arm, the acceptable terminal statuses, and
# how the attack is expected to be caught.
SCENARIOS: dict[str, dict[str, Any]] = {
    "honest": {
        "label": "Honest baseline",
        "desc": "No chaos. A provider executes correctly; verifiers agree; the request finalizes as Verified.",
        "flags": {},
        "expect": ["Verified"],
        "detected": False,
        "needs_window": True,
        "deadline": DEFAULT_DEADLINE_SECS,
        "severity": "info",
    },
    "malicious-provider": {
        "label": "Malicious provider",
        "desc": "Provider corrupts the output before signing. Verifiers recompute a different hash and a stake-slashing dispute opens.",
        "flags": {"PROVIDER_TAMPER_OUTPUT": True},
        "expect": ["Rejected"],
        "detected": True,
        "needs_window": False,
        "deadline": DEFAULT_DEADLINE_SECS,
        "dispute": "ChallengerWon",
        "severity": "critical",
    },
    "swapped-program": {
        "label": "Swapped rule set",
        "desc": "Provider runs an unauthorized WASM binary instead of the committed program hash.",
        "flags": {"PROVIDER_SWAP_PROGRAM": True},
        "expect": ["Rejected", "Expired"],
        "detected": True,
        "needs_window": False,
        "deadline": DEFAULT_DEADLINE_SECS,
        "severity": "high",
    },
    "bad-sig": {
        "label": "Forged receipt signature",
        "desc": "Provider signs the receipt with a rogue key. The on-chain Ed25519 check rejects the transaction.",
        "flags": {"PROVIDER_BAD_SIG": True},
        "expect": ["Expired"],
        "detected": True,
        "needs_window": False,
        "deadline": SHORT_DEADLINE_SECS,
        "severity": "critical",
    },
    "lazy-verifier": {
        "label": "Lazy verifier quorum",
        "desc": "A malicious provider plus one verifier that copies the receipt hash without executing. Honest quorum outvotes it.",
        "flags": {"PROVIDER_TAMPER_OUTPUT": True, "VERIFIER_LAZY": True},
        "expect": ["Rejected"],
        "detected": True,
        "needs_window": False,
        "deadline": DEFAULT_DEADLINE_SECS,
        "dispute": "ChallengerWon",
        "severity": "high",
    },
    "storage-input": {
        "label": "Tampered input blob",
        "desc": "The committed input blob is overwritten in storage. Executors re-hash it and refuse to run.",
        "flags": {"STORAGE_TAMPER_INPUT": True},
        "expect": ["Expired"],
        "detected": True,
        "needs_window": False,
        "deadline": SHORT_DEADLINE_SECS,
        "severity": "high",
    },
    "storage-output": {
        "label": "Tampered output blob",
        "desc": "The stored output JSON is corrupted after an honest receipt. Re-hashing flags OUTPUT TAMPERED; the chain record is untouched.",
        "flags": {"STORAGE_TAMPER_OUTPUT": True},
        "expect": ["Verified"],
        "detected": True,
        "needs_window": True,
        "deadline": DEFAULT_DEADLINE_SECS,
        "severity": "medium",
    },
    "frivolous-dispute": {
        "label": "Frivolous dispute",
        "desc": "An honest result is challenged with a made-up output hash. The verifier quorum sides with the provider and the challenger's stake is forfeited.",
        "flags": {},
        "expect": ["Verified"],
        "detected": True,
        "needs_window": True,
        "deadline": DEFAULT_DEADLINE_SECS,
        "action": "frivolous_dispute",
        "dispute": "ProviderWon",
        "severity": "medium",
    },
    "zk-corrupt-proof": {
        "label": "Corrupted zk proof",
        "desc": "An attacker submits a corrupted Groth16 proof for an honest payroll result. The on-chain verifier rejects the transaction (InvalidProof).",
        "flags": {"ZK_CORRUPT_PROOF": True},
        "expect": ["Verified"],
        "detected": True,
        "needs_window": True,
        "deadline": DEFAULT_DEADLINE_SECS,
        "action": "zk_corrupt_proof",
        "program": "payroll",
        "severity": "high",
    },
}

_EVENT_LEVEL = {
    "RequestCreated": "ok",
    "RequestConfirmed": "info",
    "RequestClaimed": "chain",
    "ExecutionCompleted": "ok",
    "ReceiptSubmitted": "ok",
    "Attested": "chain",
    "DisputeOpened": "warn",
    "DisputeResolved": "verdict",
    "Finalized": "ok",
    "Expired": "warn",
    "InputTampered": "error",
    "ProgramTampered": "error",
    "OutputTampered": "warn",
    "StorageTampered": "warn",
    "ReceiptRejected": "error",
    "LazyAttestation": "warn",
    "ExecutionFailed": "error",
    "WorkerError": "error",
    "ZkProofRejected": "verdict",
}

_SUMMARY_KEYS = (
    "mode", "matches", "counted", "challenger_won", "slashed", "output_hash", "trace_root",
    "fuel_used", "expected_hash", "actual_hash", "expected_output_hash", "stored_output_hash",
    "expected_input_hash", "actual_input_hash", "expected_program_hash", "actual_program_hash",
    "forged_signer", "executed_program_hash", "verifier_index", "reason", "action",
)


def scenario_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": key,
            "label": sc["label"],
            "desc": sc["desc"],
            "expect": sc["expect"],
            "detected": sc["detected"],
            "severity": sc["severity"],
            "flags": list(sc["flags"].keys()),
        }
        for key, sc in SCENARIOS.items()
    ]


def _short(value: Any, n: int = 12) -> str:
    s = str(value)
    return s if len(s) <= n else f"{s[:n]}…"


def _summarize(payload: dict[str, Any]) -> str:
    parts = [f"{k}={_short(payload[k])}" for k in _SUMMARY_KEYS if k in payload and not isinstance(payload[k], (dict, list))]
    return " ".join(parts[:6])


@dataclass
class Sim:
    id: str
    scenario: str
    status: str = "running"
    started_at: str = field(default_factory=utcnow_iso)
    finished_at: str | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    label: str = ""
    _t0: float = field(default_factory=time.time)

    def add(self, level: str, phase: str, msg: str, *, tx: str | None = None, data: Any = None) -> None:
        self.steps.append({
            "seq": len(self.steps) + 1,
            "t": round(time.time() - self._t0, 2),
            "ts": utcnow_iso(),
            "level": level,
            "phase": phase,
            "msg": msg,
            **({"tx": tx} if tx else {}),
            **({"data": data} if data is not None else {}),
        })

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "scenario": self.scenario,
            "label": self.label,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_s": round(time.time() - self._t0, 2),
            "steps": self.steps,
            "result": self.result,
            "error": self.error,
        }


_sims: dict[str, Sim] = {}
_order: list[str] = []
_tasks: set[asyncio.Task] = set()


class SimulationBusy(RuntimeError):
    """Another simulation or suite is running (chaos flags are global, so runs cannot overlap)."""


def busy() -> str | None:
    """Id of the running suite or simulation, if any."""
    for suite in _suites.values():
        if suite.status == "running":
            return suite.id
    for sim in _sims.values():
        if sim.status == "running":
            return sim.id
    return None


def _new_sim(scenario: str) -> Sim:
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario!r}; expected one of {sorted(SCENARIOS)}")
    sim = Sim(id=uuid.uuid4().hex[:12], scenario=scenario, label=SCENARIOS[scenario]["label"])
    _sims[sim.id] = sim
    _order.append(sim.id)
    while len(_order) > MAX_SIMS:
        _sims.pop(_order.pop(0), None)
    return sim


def _spawn(coro: Any) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def start_simulation(scenario: str, *, fast: bool = True, bounty: int = DEFAULT_BOUNTY) -> Sim:
    """Create a simulation and schedule its background task (call from the event loop)."""
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario!r}; expected one of {sorted(SCENARIOS)}")
    running = busy()
    if running:
        raise SimulationBusy(f"simulation {running} is still running; wait for it to finish")
    sim = _new_sim(scenario)
    _spawn(_run(sim, fast=fast, bounty=int(bounty)))
    return sim


# ------------------------------------------------------------------ suite ("run all")

@dataclass
class Suite:
    id: str
    scenarios: list[str]
    status: str = "running"
    started_at: str = field(default_factory=utcnow_iso)
    finished_at: str | None = None
    current: str | None = None
    runs: list[dict[str, Any]] = field(default_factory=list)
    _t0: float = field(default_factory=time.time)

    def snapshot(self) -> dict[str, Any]:
        done = [r for r in self.runs if r.get("status") in ("done", "error")]
        passed = sum(1 for r in done if r.get("passed"))
        return {
            "id": self.id,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_s": round(time.time() - self._t0, 2),
            "current": self.current,
            "total": len(self.scenarios),
            "completed": len(done),
            "passed": passed,
            "failed": len(done) - passed,
            "runs": self.runs,
        }


_suites: dict[str, Suite] = {}


def run_passed(scenario: str, result: dict[str, Any], error: str | None = None) -> bool:
    """A run passes when it settled as expected and the attack (if any) was detected."""
    if error or not result.get("matched_expectation"):
        return False
    return bool(result.get("detected")) == bool(SCENARIOS[scenario]["detected"])


def start_suite(scenarios: list[str] | None = None, *, fast: bool = True, bounty: int = DEFAULT_BOUNTY) -> Suite:
    """Run every scenario (or the given ones) back to back in one background task."""
    chosen = list(scenarios or SCENARIOS.keys())
    unknown = [s for s in chosen if s not in SCENARIOS]
    if unknown:
        raise ValueError(f"unknown scenario(s) {unknown}; expected some of {sorted(SCENARIOS)}")
    running = busy()
    if running:
        raise SimulationBusy(f"simulation {running} is still running; wait for it to finish")
    suite = Suite(id=uuid.uuid4().hex[:12], scenarios=chosen)
    suite.runs = [{"scenario": s, "label": SCENARIOS[s]["label"], "status": "pending"} for s in chosen]
    _suites[suite.id] = suite
    while len(_suites) > MAX_SIMS:
        _suites.pop(next(iter(_suites)))
    _spawn(_run_suite(suite, fast=fast, bounty=int(bounty)))
    return suite


async def _run_suite(suite: Suite, *, fast: bool, bounty: int) -> None:
    try:
        for i, scenario in enumerate(suite.scenarios):
            sim = _new_sim(scenario)
            suite.current = scenario
            suite.runs[i].update(status="running", sim_id=sim.id)
            await _run(sim, fast=fast, bounty=bounty)
            suite.runs[i].update(
                status=sim.status,
                passed=run_passed(scenario, sim.result, sim.error),
                detected=sim.result.get("detected"),
                final_status=sim.result.get("final_status"),
                expected=sim.result.get("expected"),
                request_pda=sim.result.get("request_pda"),
                error=sim.error,
                duration_s=sim.result.get("duration_s"),
            )
    except Exception as e:  # noqa: BLE001 - keep the suite record consistent
        logger.exception("suite %s failed", suite.id)
        for run in suite.runs:
            if run["status"] in ("pending", "running"):
                run.update(status="error", passed=False, error=f"{type(e).__name__}: {e}")
    finally:
        suite.current = None
        suite.finished_at = utcnow_iso()
        suite.status = "done"


def get_suite(suite_id: str) -> dict[str, Any] | None:
    suite = _suites.get(suite_id)
    return suite.snapshot() if suite else None


def list_suites(limit: int = 5) -> list[dict[str, Any]]:
    return [s.snapshot() for s in list(_suites.values())[-limit:][::-1]]


def get_simulation(sim_id: str) -> dict[str, Any] | None:
    sim = _sims.get(sim_id)
    return sim.snapshot() if sim else None


def list_simulations(limit: int = 10) -> list[dict[str, Any]]:
    out = []
    for sid in reversed(_order[-limit:]):
        sim = _sims.get(sid)
        if sim:
            out.append({
                "id": sim.id, "scenario": sim.scenario, "label": sim.label,
                "status": sim.status, "started_at": sim.started_at,
                "elapsed_s": round(time.time() - sim._t0, 2),
                "result": sim.result,
            })
    return out


# ------------------------------------------------------------------ runner

async def _run(sim: Sim, *, fast: bool, bounty: int) -> None:
    sc = SCENARIOS[sim.scenario]
    chain = get_chain()
    t0 = time.time()
    original_window: int | None = None
    admin = keys.admin_keypair()
    requester = keys.requester_keypair()
    provider_kp = keys.provider_keypair()
    provider_pub = str(provider_kp.pubkey()) if provider_kp else None
    pda: str | None = None
    create_sig: str | None = None
    seen_audit: set[int] = set()
    slashed_before = 0
    tampered_blob = False

    try:
        sim.add("info", "setup", f"Scenario “{sc['label']}” starting on Solana {settings.cluster}")
        if requester is None:
            raise RuntimeError("no requester keypair available (set REQUESTER_KEYPAIR_JSON or ADMIN_KEYPAIR_JSON)")

        # 1. clean baseline -------------------------------------------------
        for flag in CHAOS_FLAGS:
            await asyncio.to_thread(set_chaos_flag, flag, False)
        sim.add("info", "setup", "Cleared all chaos flags (baseline: honest network)")

        extra = int((await chain.get_config() or {}).get("min_dispute_stake") or 0) if sc.get("action") else 0
        await _ensure_funds(chain, sim, requester, bounty + extra + 20_000_000, "requester")

        cfg = await _retry(chain.get_config, what="get_config")
        if not cfg:
            raise RuntimeError("on-chain config not initialized — click “Bootstrap Chain” first")
        sim.result["required_attestations"] = int(cfg.get("required_attestations") or 0)

        # The provider must be registered and staked above the minimum or it
        # cannot claim the request, which would stall the demo.
        if provider_kp is not None:
            await _ensure_provider(chain, sim, provider_kp, cfg)
            slashed_before = 0

        # 2. optionally shorten the challenge window for a fast demo --------
        if fast and sc.get("needs_window") and admin is not None:
            original_window = int(cfg.get("challenge_window_secs") or 0)
            if original_window > FAST_WINDOW_SECS:
                sig = await _send_retry(
                    lambda: chain.update_config(
                        admin,
                        int(cfg["min_provider_stake"]),
                        int(cfg["min_dispute_stake"]),
                        FAST_WINDOW_SECS,
                        int(cfg["required_attestations"]),
                    ),
                    sim=sim,
                    what="update_config",
                )
                sim.add(
                    "chain", "setup",
                    f"Temporarily shortened challenge window {original_window}s → {FAST_WINDOW_SECS}s for a fast demo",
                    tx=sig,
                )
                cfg = await chain.get_config() or cfg
        sim.result["challenge_window_secs"] = int(cfg.get("challenge_window_secs") or 0)

        # 3. pick a rule set + commit the input -----------------------------
        if sc.get("program") == "payroll":
            program, example = await _pick_payroll_program()
        else:
            program = await asyncio.to_thread(_pick_program)
            if not program:
                raise RuntimeError("no rule set with example_input registered — run scripts/seed_rulesets.py")
            example = program.get("example_input")
        program_hash = str(program["program_hash"]).lower()
        sim.add("info", "prepare", f"Rule set: {program.get('name') or _short(program_hash)} ({_short(program_hash)})")

        canonical_bytes = canonical(example)
        input_hash = sha256_hex(canonical_bytes)
        await asyncio.to_thread(upload_blob, BUCKET_INPUTS, f"{input_hash}.json", canonical_bytes, "application/json")
        input_uri = f"inputs/{input_hash}.json"
        input_uri_hash = sha256_hex(input_uri.encode("utf-8"))
        sim.add("exec", "prepare", f"Canonical input committed (sha256 {_short(input_hash)}…, {len(canonical_bytes)} bytes)")

        if provider_pub:
            prov = await _retry(lambda: chain.get_provider(provider_pub), what="get_provider")
            slashed_before = int((prov or {}).get("slashed") or 0)
            sim.add("info", "prepare", f"Provider {_short(provider_pub)} staked {int((prov or {}).get('stake') or 0)} lamports")

        # 4. arm chaos BEFORE the provider sees the request -----------------
        for flag in sc["flags"]:
            await asyncio.to_thread(set_chaos_flag, flag, True)
        if sc["flags"]:
            sim.add("warn", "setup", "Armed chaos flags: " + ", ".join(sc["flags"]))
        else:
            sim.add("ok", "setup", "No chaos armed — running the honest baseline")

        # 5. create the request on-chain ------------------------------------
        deadline = int(time.time()) + int(sc.get("deadline", DEFAULT_DEADLINE_SECS))
        sim.add("chain", "create", f"Broadcasting create_request (bounty {bounty} lamports)")
        create_sig, pda = await _send_retry(
            lambda: chain.create_request(
                requester,
                bytes.fromhex(program_hash),
                bytes.fromhex(input_hash),
                bytes.fromhex(input_uri_hash),
                bounty,
                deadline,
                before_send=lambda pda: asyncio.to_thread(
                    _store_input_commitment, pda, requester, program_hash, input_hash, input_uri_hash
                ),
            ),
            sim=sim,
            what="create_request",
        )
        sim.result["request_pda"] = pda
        sim.result["request_explorer"] = explorer_addr(pda, settings.cluster)
        sim.add("chain", "create", f"Request PDA {pda}", tx=create_sig)
        try:
            await _retry(lambda: indexer.sync_request(pda, create_sig), what="sync_request")
            sim.add("ok", "create", "Request indexed into the database")
        except Exception as e:  # noqa: BLE001
            sim.add("warn", "create", f"Indexing deferred (RPC busy): {str(e)[:110]}")

        # 6. drive the lifecycle --------------------------------------------
        last_status: str | None = None
        hiccups = 0
        last_forced: dict[str, float] = {}
        timed_out = False
        action_result: dict[str, Any] | None = None
        while time.time() - t0 < MAX_SIM_SECONDS:
            try:
                req = await _retry(lambda: chain.get_request(pda), attempts=5, what="get_request")
            except Exception as e:  # noqa: BLE001 - devnet RPC is flaky; ride it out
                hiccups += 1
                sim.add("warn", "rpc", f"Transient RPC error reading the request ({hiccups}): {str(e)[:110]}")
                if hiccups >= 12:
                    raise
                await asyncio.sleep(POLL_SECS)
                continue
            hiccups = 0
            if req is None:
                raise RuntimeError("request account not found on chain")
            status = req["status"]
            if status != last_status:
                sim.add("chain", "state", f"On-chain status: {status}" if last_status is None else f"On-chain status: {last_status} → {status}")
                last_status = status
            if status in TERMINAL:
                break

            # Adversarial actions run once, right after the honest receipt lands.
            if sc.get("action") and action_result is None and status == "AwaitingVerification":
                action_result = await _run_action(sim, sc["action"], chain, requester, pda, example)

            # Re-assert the scenario flags: the provider reads them only at
            # execution time, and another operator may have reset them.
            await _arm(sim, sc)

            now = time.time()
            if status in ("Open", "Claimed") and now - last_forced.get("provider", 0.0) >= FORCE_GAP:
                last_forced["provider"] = now
                await _tick(sim, "provider")
            elif status in ("AwaitingVerification", "Disputed") and now - last_forced.get("verifier", 0.0) >= FORCE_GAP:
                last_forced["verifier"] = now
                await _tick(sim, "verifier")
            if status in ("AwaitingVerification", "Disputed") and now - last_forced.get("finalizer", 0.0) >= FORCE_GAP:
                last_forced["finalizer"] = now
                await _tick(sim, "finalizer")

            await _emit_audit(sim, pda, seen_audit)
            await asyncio.sleep(POLL_SECS)
        else:
            timed_out = True

        # 7. final evidence --------------------------------------------------
        terminal_reached = last_status in TERMINAL
        await _emit_audit(sim, pda, seen_audit)
        req = await _retry(lambda: chain.get_request(pda), what="get_request") or {}
        final_status = req.get("status", "Unknown")
        dispute = await _retry(lambda: chain.get_dispute(pda), what="get_dispute")
        receipt = await _retry(lambda: chain.get_receipt(pda), what="get_receipt")
        attestations = await _retry(lambda: chain.list_attestations(pda), what="list_attestations") or []
        mismatches = sum(1 for a in attestations if a.get("counted") and not a.get("matches"))
        matches = sum(1 for a in attestations if a.get("counted") and a.get("matches"))

        slashed_after = slashed_before
        if provider_pub:
            prov_after = await _retry(lambda: chain.get_provider(provider_pub), what="get_provider")
            slashed_after = int((prov_after or {}).get("slashed") or 0)

        if sim.scenario == "storage-output":
            tampered_blob = await _check_output_tampered(sim, pda)

        detected = _detected(sim.scenario, final_status, timed_out, tampered_blob, action_result, dispute)
        matched = terminal_reached and final_status in sc["expect"]

        sim.result.update(
            final_status=final_status,
            dispute_status=(dispute or {}).get("status"),
            receipt_output_hash=(receipt or {}).get("output_hash"),
            attestations_match=matches,
            attestations_mismatch=mismatches,
            provider_slashed_delta=slashed_after - slashed_before,
            provider_slashed_total=slashed_after,
            output_blob_tampered=tampered_blob,
            action=action_result,
            detected=detected,
            matched_expectation=matched,
            timed_out=timed_out,
            expected=sc["expect"],
            duration_s=round(time.time() - t0, 2),
        )

        if not terminal_reached:
            sim.add(
                "warn", "verdict",
                f"Did not settle within {MAX_SIM_SECONDS}s (last status {final_status}) — devnet RPC was slow. "
                "Re-run the scenario to see it to completion.",
            )
        elif detected:
            sim.add(
                "verdict", "verdict",
                f"ATTACK DETECTED — request {final_status}"
                + (f", dispute {sim.result['dispute_status']}" if sim.result.get("dispute_status") else "")
                + (f", provider slashed ×{sim.result['provider_slashed_delta']}" if sim.result.get("provider_slashed_delta") else ""),
            )
        elif sim.scenario == "honest":
            sim.add("verdict", "verdict", f"HONEST RESULT ACCEPTED — request {final_status}")
        else:
            sim.add("warn", "verdict", f"Scenario finished with status {final_status} (expected {', '.join(sc['expect'])})")

    except Exception as e:  # noqa: BLE001
        logger.exception("simulation %s failed", sim.id)
        sim.error = f"{type(e).__name__}: {e}"
        sim.add("error", "error", f"Simulation aborted: {sim.error}")
    finally:
        # restore global state we touched
        if original_window is not None and admin is not None:
            try:
                cfg = await chain.get_config()
                if cfg and int(cfg.get("challenge_window_secs") or 0) != original_window:
                    sig = await _send_retry(
                        lambda: chain.update_config(
                            admin,
                            int(cfg["min_provider_stake"]),
                            int(cfg["min_dispute_stake"]),
                            original_window,
                            int(cfg["required_attestations"]),
                        ),
                        sim=sim,
                        what="restore_config",
                    )
                    sim.add("chain", "cleanup", f"Restored challenge window to {original_window}s", tx=sig)
            except Exception as e:  # noqa: BLE001
                sim.add("warn", "cleanup", f"Could not restore challenge window: {str(e)[:120]}")
        try:
            for flag in CHAOS_FLAGS:
                await asyncio.to_thread(set_chaos_flag, flag, False)
            sim.add("info", "cleanup", "Disarmed all chaos flags (network back to honest)")
        except Exception:  # noqa: BLE001
            pass
        sim.finished_at = utcnow_iso()
        if sim.status == "running":
            sim.status = "error" if sim.error else "done"


# ------------------------------------------------------------------ helpers

async def _pick_payroll_program() -> tuple[dict[str, Any], dict[str, int]]:
    """The payroll rule set registered in the zk verifier, with an input in its exact on-chain format."""
    from app.chain.zk import PAYROLL_FIELDS, get_zk_config

    cfg = await _retry(get_zk_config, what="get_zk_config")
    if not cfg:
        raise RuntimeError("zk verifier not configured on this cluster (run programs/verity_core/scripts/setup-zk.mjs)")
    payroll_hash = str(cfg["payroll_program_hash"]).lower()
    program = await asyncio.to_thread(db_program_by_hash, payroll_hash)
    if not program:
        raise RuntimeError(f"payroll rule set {payroll_hash[:12]}… is not registered — run scripts/seed_rulesets.py")
    example = program.get("example_input") or {}
    try:
        payroll_input = {k: int(example[k]) for k in PAYROLL_FIELDS}
    except (KeyError, TypeError, ValueError) as e:
        raise RuntimeError(f"payroll example_input is missing {e}") from e
    return program, payroll_input


def _store_input_commitment(
    request_pda: str, requester: Keypair, program_hash: str, input_hash: str, input_uri_hash: str
) -> None:
    """Sign and store the requester's input commitment, as /requests/commit-input does for wallets.

    The provider refuses requests without one, so it must exist before `create_request` lands.
    """
    msg = input_commitment_message(bytes.fromhex(program_hash), bytes.fromhex(input_hash), bytes.fromhex(input_uri_hash))
    upsert(
        "input_commitments",
        {
            "request_pda": request_pda,
            "requester_pubkey": str(requester.pubkey()),
            "program_hash": program_hash,
            "input_hash": input_hash,
            "input_uri_hash": input_uri_hash,
            "signature": base58.b58encode(bytes(requester.sign_message(msg))).decode(),
        },
        "request_pda",
    )


def db_program_by_hash(program_hash: str) -> dict[str, Any] | None:
    rows = table("programs").select("*").eq("program_hash", program_hash).limit(1).execute().data or []
    return rows[0] if rows else None


async def _run_action(sim: Sim, action: str, chain: Any, requester: Any, pda: str, example: Any) -> dict[str, Any]:
    """Play the attacker for action scenarios; never raises (the outcome is the evidence)."""
    from app.chain.client import ChainError

    if action == "frivolous_dispute":
        import os

        claimed = os.urandom(32)
        sim.add("warn", "attack", f"Requester disputes the honest receipt, claiming output {claimed.hex()[:12]}…")
        try:
            sig = await _send_retry(lambda: chain.open_dispute(requester, pda, claimed), sim=sim, what="open_dispute", attempts=2)
        except ChainError as e:
            sim.add("error", "attack", f"open_dispute failed: {e.code or str(e)[:120]}")
            return {"opened": False, "error": e.code or str(e)[:200]}
        sim.add("chain", "attack", "Frivolous dispute opened — stake escrowed; verifier quorum will decide", tx=sig)
        return {"opened": True, "tx": sig}

    if action == "zk_corrupt_proof":
        from app.chain.zk import submit_corrupt_proof
        from app.db import chaos

        if not chaos("ZK_CORRUPT_PROOF"):
            sim.add("warn", "attack", "ZK_CORRUPT_PROOF is not armed; skipping the corrupt proof")
            return {"rejected": False, "skipped": True}
        sim.add("warn", "attack", "Submitting a corrupted Groth16 proof (proof A negated) to verity_zk_verifier")
        try:
            sig = await submit_corrupt_proof(requester, pda, example)
        except ChainError as e:
            rejected = e.code == "InvalidProof"
            sim.add(
                "verdict" if rejected else "error", "zk",
                f"verify_payroll rejected on-chain: {e.code or 'error'}" if rejected
                else f"verify_payroll failed for another reason: {e.code or str(e)[:120]}",
                tx=e.signature,
            )
            return {"rejected": rejected, "code": e.code, "tx": e.signature}
        except Exception as e:  # noqa: BLE001
            sim.add("error", "zk", f"Could not submit the corrupt proof: {str(e)[:140]}")
            return {"rejected": False, "error": str(e)[:200]}
        sim.add("error", "zk", "CORRUPT PROOF ACCEPTED — the zk verifier did not reject it", tx=sig)
        return {"rejected": False, "tx": sig}

    raise ValueError(f"unknown action {action!r}")


def _pick_program() -> dict[str, Any] | None:
    rows = table("programs").select("*").execute().data or []
    with_input = [r for r in rows if r.get("example_input") is not None]
    if with_input:
        return sorted(with_input, key=lambda r: r.get("created_at") or "")[0]
    return rows[0] if rows else None


async def _arm(sim: Sim, sc: dict[str, Any]) -> None:
    """Re-assert the scenario's chaos flags without redundant DB writes."""
    from app.db import chaos

    for flag in sc["flags"]:
        if not chaos(flag):
            await asyncio.to_thread(set_chaos_flag, flag, True)


async def _safe_balance(chain: Any, pubkey: Any) -> int | None:
    try:
        return await chain.get_balance(pubkey)
    except Exception:  # noqa: BLE001
        return None


async def _send_retry(coro_fn: Any, *, sim: Sim | None = None, attempts: int = 5, what: str = "tx") -> Any:
    """Retry a transaction submission.

    The public devnet RPC frequently returns transient 429/5xx before a tx is
    even broadcast (e.g. getLatestBlockhash), so retrying is safe in the common
    case and keeps the demo from dying on a rate limit.
    """
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if sim is not None and i < attempts - 1:
                sim.add("warn", "rpc", f"{what} attempt {i + 1} failed ({str(e)[:90]}); retrying")
            if i < attempts - 1:
                await asyncio.sleep(1.5 * (i + 1))
    assert last is not None
    raise last


async def _retry(coro_fn: Any, *, attempts: int = 6, base: float = 1.2, what: str = "rpc") -> Any:
    """Retry a chain read a few times — the public devnet RPC is rate-limited."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < attempts - 1:
                await asyncio.sleep(base * (i + 1))
    assert last is not None
    raise last


async def _ensure_funds(chain: Any, sim: Sim, kp: Any, needed: int, label: str) -> None:
    if kp is None or settings.cluster == "mainnet-beta":
        return
    bal = await _safe_balance(chain, kp.pubkey())
    if bal is None or bal >= needed:
        return
    try:
        sig = await _send_retry(lambda: chain.airdrop(kp.pubkey(), 1_000_000_000), sim=sim, what=f"airdrop:{label}")
        sim.add("chain", "setup", f"Airdropped 1 SOL to {label} (balance was {bal} lamports)", tx=sig)
    except Exception as e:  # noqa: BLE001
        sim.add("warn", "setup", f"Airdrop to {label} failed ({str(e)[:100]}); continuing")


async def _ensure_provider(chain: Any, sim: Sim, provider_kp: Any, cfg: dict[str, Any]) -> None:
    """Register + top up the provider so the request can actually be claimed.

    A prior slashing drains the provider's stake; without restaking, no job is
    ever claimed and the demo stalls.
    """
    owner = provider_kp.pubkey()
    min_stake = int(cfg.get("min_provider_stake") or 0)
    prov = await _retry(lambda: chain.get_provider(owner), what="get_provider")
    if prov is None:
        sig = await _send_retry(lambda: chain.register_provider(provider_kp), sim=sim, what="register_provider")
        sim.add("chain", "setup", f"Registered provider {_short(owner)}", tx=sig)
        prov = await _retry(lambda: chain.get_provider(owner), what="get_provider")
    stake = int((prov or {}).get("stake") or 0)
    if min_stake and stake < min_stake:
        await _ensure_funds(chain, sim, provider_kp, min_stake - stake + 20_000_000, "provider")
        sig = await _send_retry(lambda: chain.stake_provider(provider_kp, min_stake - stake), sim=sim, what="stake_provider")
        sim.add("chain", "setup", f"Staked provider to the minimum ({stake} → {min_stake} lamports)", tx=sig)
    elif stake == 0:
        sim.add("warn", "setup", "Provider stake is 0 and no minimum is configured — claiming may fail")


async def _tick(sim: Sim, job: str) -> None:
    try:
        from app.workers.scheduler import run_job_now

        out = await run_job_now(job)
    except Exception as e:  # noqa: BLE001
        sim.add("error", "worker", f"{job} tick failed: {str(e)[:160]}")
        return
    result = out.get("result")
    if not isinstance(result, dict):
        return
    if job == "provider":
        if result.get("processed") or result.get("submitted"):
            sim.add("chain", "execute", f"provider tick · processed={result.get('processed')} submitted={result.get('submitted')}")
    elif job == "verifier":
        if result.get("attested"):
            sim.add(
                "chain", "verify",
                f"verifier tick · attested={result.get('attested')} mismatches={result.get('mismatches', 0)} lazy={result.get('lazy', 0)}",
            )
    elif job == "finalizer":
        acted = {k: v for k, v in result.items() if isinstance(v, int) and v}
        if acted:
            sim.add("chain", "settle", "finalizer tick · " + ", ".join(f"{k}={v}" for k, v in acted.items()))


def _audit_rows(pda: str) -> list[dict[str, Any]]:
    return table("audit_log").select("*").eq("request_pda", pda).order("seq").execute().data or []


async def _emit_audit(sim: Sim, pda: str, seen: set[int]) -> None:
    rows = await asyncio.to_thread(_audit_rows, pda)
    for r in rows:
        seq = r.get("seq")
        if seq is None or seq in seen:
            continue
        seen.add(seq)
        et = r.get("event_type") or "Event"
        summary = _summarize(r.get("payload") or {})
        sim.add(_EVENT_LEVEL.get(et, "info"), "audit", f"{et}{' · ' + summary if summary else ''}", tx=r.get("tx_sig"))


async def _check_output_tampered(sim: Sim, pda: str) -> bool:
    try:
        from app.routes.common import compute_integrity, load_bundle

        bundle = await load_bundle(pda, sync_if_missing=False, live=False)
        if not bundle:
            return False
        integrity = await compute_integrity(bundle)
        output = integrity.get("output") or {}
        if output.get("status") == "tampered":
            sim.add(
                "warn", "verify",
                f"Output blob re-hash mismatch · stored {_short(output.get('actual'))} ≠ chain {_short(output.get('expected'))}",
            )
            return True
        sim.add("info", "verify", f"Output blob integrity: {output.get('status')}")
    except Exception as e:  # noqa: BLE001
        sim.add("warn", "verify", f"Integrity check failed: {str(e)[:140]}")
    return False


def _detected(
    scenario: str,
    final_status: str,
    timed_out: bool,
    tampered_blob: bool,
    action_result: dict[str, Any] | None = None,
    dispute: dict[str, Any] | None = None,
) -> bool:
    if scenario == "honest":
        return False
    if scenario == "storage-output":
        return tampered_blob
    if scenario == "zk-corrupt-proof":
        return bool(action_result and action_result.get("rejected"))
    if scenario == "frivolous-dispute":
        return bool(action_result and action_result.get("opened")) and (dispute or {}).get("status") == "ProviderWon"
    if timed_out:
        return False
    return final_status != "Verified"
