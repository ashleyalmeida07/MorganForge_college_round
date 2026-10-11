"""Adversarial scenarios (Implementation_plan.md §10) without a network: always runs in CI.

The real provider / verifier / finalizer worker code, the real wasmtime engine and real
Ed25519 receipts run against an in-memory chain + blob store. FakeChain mirrors the
on-chain rules the workers depend on (signature check in submit_receipt, registered-
verifier quorum, dispute resolution); the program itself is tested on a local validator
by programs/verity_core/tests/verity_core.test.mjs, and against devnet by
tests/test_adversarial.py (VERITY_E2E=1).
"""
from __future__ import annotations

import asyncio
import time
import json
import os
from pathlib import Path
from typing import Any

import base58
import pytest
from solders.keypair import Keypair

from app.chain.client import ChainError
from app.chain.signer import input_commitment_message, receipt_message, sign_receipt, verify_receipt
from app.utils import canonical, sha256, sha256_hex

REPO = Path(__file__).resolve().parents[2]
PAYROLL_WASM = REPO / "rulesets" / "payroll" / "payroll.wasm"
CREDIT_WASM = REPO / "rulesets" / "credit_risk" / "credit_risk.wasm"
PAYROLL_INPUT = {"salary_cents": 1_000_000, "tax_bps": 2000, "deductions_cents": 50_000}
QUORUM = 2

pytestmark = pytest.mark.skipif(not PAYROLL_WASM.exists(), reason="rulesets/payroll/payroll.wasm not built")


# ====================================================================== fakes

class FakeChain:
    """Just enough of verity_core's rules for the workers' decisions to be meaningful."""

    def __init__(self, provider: Keypair, verifiers: list[Keypair]):
        self.provider = str(provider.pubkey())
        self.registered = {str(v.pubkey()) for v in verifiers}
        self.requests: dict[str, dict[str, Any]] = {}
        self.receipts: dict[str, dict[str, Any]] = {}
        self.attestations: dict[str, list[dict[str, Any]]] = {}
        self.disputes: dict[str, dict[str, Any]] = {}
        self.txs = 0

    def _sig(self) -> str:
        self.txs += 1
        return f"tx{self.txs}"

    def add_request(self, program_hash: str, input_hash: str) -> dict[str, Any]:
        pda = str(Keypair().pubkey())
        req = {"pda": pda, "program_hash": program_hash, "input_hash": input_hash, "status": "Open",
               "provider": None, "attest_count_match": 0, "attest_count_mismatch": 0, "receipt_at": 0,
               "input_uri_hash": sha256_hex(f"inputs/{input_hash}.json".encode())}
        self.requests[pda] = req
        return req

    async def claim_request(self, kp: Keypair, pda: str) -> str:
        req = self.requests[pda]
        if req["status"] != "Open":
            raise ChainError("claim_request", code="InvalidStatus")
        req.update(status="Claimed", provider=str(kp.pubkey()))
        return self._sig()

    async def submit_receipt(self, kp: Keypair, pda: str, output_hash: bytes, trace_root: bytes,
                             fuel_used: int, signature: bytes) -> str:
        req = self.requests[pda]
        if req["status"] != "Claimed" or req["provider"] != str(kp.pubkey()):
            raise ChainError("submit_receipt", code="InvalidStatus")
        msg = receipt_message(pda, bytes.fromhex(req["program_hash"]), bytes.fromhex(req["input_hash"]),
                              output_hash, trace_root, fuel_used)
        if not verify_receipt(kp.pubkey(), msg, signature):  # Ed25519 introspection on chain
            raise ChainError("submit_receipt: custom program error: 0x177e", code="SignatureMismatch")
        self.receipts[pda] = {"output_hash": output_hash.hex(), "trace_root": trace_root.hex(),
                              "fuel_used": fuel_used, "signature": signature.hex(), "provider": str(kp.pubkey())}
        req.update(status="AwaitingVerification", receipt_at=1)
        return self._sig()

    async def attest(self, kp: Keypair, pda: str, output_hash: bytes, trace_root: bytes, fuel_used: int) -> str:
        rc, req, who = self.receipts[pda], self.requests[pda], str(kp.pubkey())
        matches = (output_hash.hex() == rc["output_hash"] and trace_root.hex() == rc["trace_root"]
                   and fuel_used == rc["fuel_used"])
        counted = who in self.registered
        self.attestations.setdefault(pda, []).append(
            {"verifier": who, "output_hash": output_hash.hex(), "trace_root": trace_root.hex(),
             "fuel_used": fuel_used, "matches": matches, "counted": counted})
        if counted:
            req["attest_count_match" if matches else "attest_count_mismatch"] += 1
        return self._sig()

    async def get_receipt(self, pda: str) -> dict[str, Any] | None:
        return self.receipts.get(pda)

    async def get_dispute(self, pda: str) -> dict[str, Any] | None:
        return self.disputes.get(pda)

    async def list_attestations(self, pda: str) -> list[dict[str, Any]]:
        return list(self.attestations.get(pda, []))

    async def open_dispute(self, kp: Keypair, pda: str, claimed: bytes) -> str:
        if str(kp.pubkey()) == self.requests[pda]["provider"]:
            raise ChainError("open_dispute", code="ProviderCannotDispute")
        if claimed.hex() == self.receipts[pda]["output_hash"]:
            raise ChainError("open_dispute", code="ClaimMatchesReceipt")
        self.disputes[pda] = {"status": "Open", "claimed_output_hash": claimed.hex(),
                              "challenger": str(kp.pubkey()), "opened_at": int(time.time())}
        self.requests[pda]["status"] = "Disputed"
        return self._sig()

    async def resolve_dispute(self, kp: Keypair, pda: str) -> str:
        d, claimed = self.disputes[pda], self.disputes[pda]["claimed_output_hash"]
        support = {a["verifier"] for a in self.attestations.get(pda, [])
                   if a["counted"] and not a["matches"] and a["output_hash"] == claimed}
        challenger_won = len(support) >= QUORUM
        d["status"] = "ChallengerWon" if challenger_won else "ProviderWon"
        self.requests[pda]["status"] = "Rejected" if challenger_won else "AwaitingVerification"
        return self._sig()

    async def finalize(self, kp: Keypair, pda: str) -> str:
        req = self.requests[pda]
        if req["status"] != "AwaitingVerification" or req["attest_count_match"] < QUORUM:
            raise ChainError("finalize", code="QuorumNotReached")
        req["status"] = "Verified"
        return self._sig()


class World:
    """Blob store + chaos flags + captured audit events, patched into the workers."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch):
        from app.chain import keys
        from app.workers import common, finalizer, provider, verifier

        self.provider_kp = Keypair()
        self.verifiers = [Keypair() for _ in range(3)]
        self.requester = Keypair()
        self.chain = FakeChain(self.provider_kp, self.verifiers)
        self.blobs: dict[str, bytes] = {}
        self.flags: set[str] = set()
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.commitments: dict[str, dict[str, Any]] = {}

        self.payroll = PAYROLL_WASM.read_bytes()
        self.payroll_hash = sha256_hex(self.payroll)
        self.blobs[f"programs/{self.payroll_hash}.wasm"] = self.payroll
        self.other_hash: str | None = None
        if CREDIT_WASM.exists():
            other = CREDIT_WASM.read_bytes()
            self.other_hash = sha256_hex(other)
            self.blobs[f"programs/{self.other_hash}.wasm"] = other

        def load_program_wasm(h: str) -> bytes:
            return self.blobs[f"programs/{h.lower()}.wasm"]

        def load_input(h: str) -> bytes:
            return self.blobs[f"inputs/{h.lower()}.json"]

        def upload_blob(bucket: str, path: str, data: bytes, content_type: str = "") -> str:
            self.blobs[f"{bucket}/{path}"] = bytes(data)
            return f"{bucket}/{path}"

        async def append_event(event_type: str, payload: dict, request_pda: str | None = None,
                               actor: str | None = None, tx_sig: str | None = None) -> None:
            self.events.append((event_type, payload))

        async def noop(*_a: Any, **_k: Any) -> None:
            return None

        def no_db(*_a: Any, **_k: Any) -> Any:
            raise RuntimeError("database disabled in offline tests")

        for mod in (provider, verifier, common):
            for name, fn in (("load_program_wasm", load_program_wasm), ("load_input", load_input),
                             ("upload_blob", upload_blob)):
                if hasattr(mod, name):
                    monkeypatch.setattr(mod, name, fn)
        for mod in (provider, verifier, finalizer):
            monkeypatch.setattr(mod, "safe_append_event", append_event)
            monkeypatch.setattr(mod, "safe_sync_request", noop)
        monkeypatch.setattr(finalizer, "safe_sync_provider", noop)
        monkeypatch.setattr(finalizer, "_trigger_explanation", lambda pda: None)
        monkeypatch.setattr(provider, "chaos", lambda name: name in self.flags)
        monkeypatch.setattr(provider, "pin_bytes", lambda *a, **k: None)
        monkeypatch.setattr(provider, "set_receipt_output", lambda *a, **k: None)
        monkeypatch.setattr(provider, "pick_other_program", lambda exclude: self.other_hash)
        monkeypatch.setattr(provider, "db_input_commitment", lambda pda: self.commitments.get(pda))
        monkeypatch.setattr(keys, "verifier_keypairs", lambda: list(self.verifiers))
        import app.db as db

        monkeypatch.setattr(db, "table", no_db)
        monkeypatch.setattr(db, "upsert", no_db)
        provider._abandoned.clear()
        verifier._abandoned.clear()

    # ---------------------------------------------------------- lifecycle steps
    def new_request(self, inp: dict[str, Any] | None = None) -> dict[str, Any]:
        data = canonical(inp or PAYROLL_INPUT)
        ih = sha256_hex(data)
        self.blobs[f"inputs/{ih}.json"] = data
        req = self.chain.add_request(self.payroll_hash, ih)
        msg = input_commitment_message(bytes.fromhex(self.payroll_hash), bytes.fromhex(ih),
                                       bytes.fromhex(req["input_uri_hash"]))
        self.commitments[req["pda"]] = {
            "program_hash": self.payroll_hash, "input_hash": ih, "input_uri_hash": req["input_uri_hash"],
            "requester_pubkey": str(self.requester.pubkey()),
            "signature": base58.b58encode(bytes(self.requester.sign_message(msg))).decode(),
        }
        return req

    def provide(self, req: dict[str, Any]) -> bool:
        from app.workers.provider import _process

        return asyncio.run(_process(self.chain, self.provider_kp, req, needs_claim=True))

    def verify_all(self, req: dict[str, Any], lazy_first: bool = False) -> list[str | None]:
        from app.workers.verifier import _attest_one

        rc = self.chain.receipts[req["pda"]]
        return [asyncio.run(_attest_one(self.chain, v, i, req, rc, lazy_first and i == 0))
                for i, v in enumerate(self.verifiers)]

    def finalizer_awaiting(self, req: dict[str, Any]) -> dict[str, int]:
        from app.workers.finalizer import _handle_awaiting

        stats = {"disputes_opened": 0, "finalized": 0}
        asyncio.run(_handle_awaiting(self.chain, self.requester, req, QUORUM, 0, stats, [10]))
        return stats

    def finalizer_disputed(self, req: dict[str, Any], window: int) -> dict[str, int]:
        from app.workers.finalizer import _handle_disputed

        stats = {"resolved": 0}
        asyncio.run(_handle_disputed(self.chain, self.requester, req, QUORUM, window, stats, [10]))
        return stats

    def honest_output(self, inp: dict[str, Any] | None = None) -> bytes:
        from app.engine import runner

        return runner.run(self.payroll, canonical(inp or PAYROLL_INPUT)).output_bytes

    def event_types(self) -> list[str]:
        return [e for e, _ in self.events]


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    return World(monkeypatch)


# ====================================================================== scenarios

def test_00_honest_run_verifies(world: World):
    req = world.new_request()
    assert world.provide(req)
    rc = world.chain.receipts[req["pda"]]
    assert rc["output_hash"] == sha256_hex(world.honest_output())
    assert world.verify_all(req) == ["match", "match", "match"]
    stats = world.finalizer_awaiting(req)
    assert stats["finalized"] == 1 and req["status"] == "Verified"
    assert world.blobs[f"outputs/{req['pda']}.json"] == world.honest_output()


def test_01_malicious_provider_is_outvoted_and_disputed(world: World):
    world.flags.add("PROVIDER_TAMPER_OUTPUT")
    req = world.new_request()
    assert world.provide(req)
    honest = sha256_hex(world.honest_output())
    assert world.chain.receipts[req["pda"]]["output_hash"] != honest
    assert world.verify_all(req) == ["mismatch", "mismatch", "mismatch"]

    assert world.finalizer_awaiting(req)["disputes_opened"] == 1
    d = world.chain.disputes[req["pda"]]
    assert d["claimed_output_hash"] == honest, "the dispute must claim the verifiers' (honest) hash"
    assert d["challenger"] != world.chain.provider
    assert world.finalizer_disputed(req, window=10**9)["resolved"] == 1, "quorum support resolves immediately"
    assert d["status"] == "ChallengerWon" and req["status"] == "Rejected"


def test_02_swapped_program_never_matches(world: World):
    if world.other_hash is None:
        pytest.skip("rulesets/credit_risk/credit_risk.wasm not built")
    world.flags.add("PROVIDER_SWAP_PROGRAM")
    req = world.new_request()
    assert world.provide(req)
    assert world.chain.receipts[req["pda"]]["output_hash"] != sha256_hex(world.honest_output())
    assert world.verify_all(req) == ["mismatch", "mismatch", "mismatch"]


def test_02b_swapped_program_blob_is_refused_by_hash_check(world: World):
    if world.other_hash is None:
        pytest.skip("rulesets/credit_risk/credit_risk.wasm not built")
    req = world.new_request()
    # storage now serves a different binary under the committed program hash
    world.blobs[f"programs/{world.payroll_hash}.wasm"] = world.blobs[f"programs/{world.other_hash}.wasm"]
    assert not world.provide(req)
    assert "ProgramTampered" in world.event_types()
    assert req["pda"] not in world.chain.receipts, "no receipt for a swapped program"


def test_03_tampered_input_blob_aborts_execution(world: World):
    world.flags.add("STORAGE_TAMPER_INPUT")
    req = world.new_request()
    assert not world.provide(req)
    assert "StorageTampered" in world.event_types() and "InputTampered" in world.event_types()
    assert req["pda"] not in world.chain.receipts
    assert sha256_hex(world.blobs[f"inputs/{req['input_hash']}.json"]) != req["input_hash"]


def test_03b_verifier_refuses_tampered_input(world: World):
    req = world.new_request()
    assert world.provide(req)
    world.blobs[f"inputs/{req['input_hash']}.json"] = canonical({**PAYROLL_INPUT, "salary_cents": 1})
    assert world.verify_all(req) == [None, None, None], "verifiers must not attest over a tampered input"
    assert world.event_types().count("InputTampered") == 3


def test_04_tampered_output_blob_detected_chain_unaffected(world: World):
    world.flags.add("STORAGE_TAMPER_OUTPUT")
    req = world.new_request()
    assert world.provide(req)
    rc = world.chain.receipts[req["pda"]]
    stored = world.blobs[f"outputs/{req['pda']}.json"]
    assert sha256_hex(stored) != rc["output_hash"], "re-hashing the stored blob must reveal the tamper"
    assert rc["output_hash"] == sha256_hex(world.honest_output()), "the on-chain commitment stays honest"
    assert "OutputTampered" in world.event_types()
    assert world.verify_all(req) == ["match", "match", "match"]


def test_05_forged_receipt_signature_rejected(world: World):
    world.flags.add("PROVIDER_BAD_SIG")
    req = world.new_request()
    assert not world.provide(req)
    assert req["pda"] not in world.chain.receipts
    rejected = [p for e, p in world.events if e == "ReceiptRejected"]
    assert rejected and rejected[0]["code"] == "SignatureMismatch"


def test_06_lazy_verifier_is_outvoted(world: World):
    world.flags.add("PROVIDER_TAMPER_OUTPUT")
    req = world.new_request()
    assert world.provide(req)
    outcomes = world.verify_all(req, lazy_first=True)
    assert outcomes == ["lazy", "mismatch", "mismatch"]
    atts = world.chain.attestations[req["pda"]]
    assert atts[0]["matches"] is True, "the lazy copy is recorded on chain as a (wrong) match"
    assert req["attest_count_mismatch"] >= QUORUM > req["attest_count_match"]
    world.finalizer_awaiting(req)
    world.finalizer_disputed(req, window=10**9)
    assert world.chain.disputes[req["pda"]]["status"] == "ChallengerWon"


def test_07_replayed_receipt_rejected(world: World):
    old = world.new_request()
    assert world.provide(old)
    rc = world.chain.receipts[old["pda"]]

    new = world.new_request()
    asyncio.run(world.chain.claim_request(world.provider_kp, new["pda"]))
    msg = receipt_message(new["pda"], bytes.fromhex(new["program_hash"]), bytes.fromhex(new["input_hash"]),
                          bytes.fromhex(rc["output_hash"]), bytes.fromhex(rc["trace_root"]), rc["fuel_used"])
    assert not verify_receipt(world.provider_kp.pubkey(), msg, bytes.fromhex(rc["signature"]))
    with pytest.raises(ChainError) as exc:
        asyncio.run(world.chain.submit_receipt(
            world.provider_kp, new["pda"], bytes.fromhex(rc["output_hash"]), bytes.fromhex(rc["trace_root"]),
            rc["fuel_used"], bytes.fromhex(rc["signature"])))
    assert exc.value.code == "SignatureMismatch"


def test_08_frivolous_dispute_loses(world: World):
    req = world.new_request()
    assert world.provide(req)
    assert world.verify_all(req) == ["match", "match", "match"]
    asyncio.run(world.chain.open_dispute(world.requester, req["pda"], os.urandom(32)))
    req["status"] = "Disputed"
    assert world.finalizer_disputed(req, window=10**9)["resolved"] == 0, "no support: wait for the window"
    assert world.finalizer_disputed(req, window=-60)["resolved"] == 1
    assert world.chain.disputes[req["pda"]]["status"] == "ProviderWon"
    assert world.finalizer_awaiting(world.chain.requests[req["pda"]])["finalized"] == 1
    assert req["status"] == "Verified"


def test_09_corrupt_zk_proof_is_not_the_fixture_and_targets_the_request():
    """On-chain rejection is covered by scripts/zk-smoke.mjs (local validator); here: the attack
    payload is well-formed (on-curve points, IDL layout) so the pairing check is what rejects it."""
    from app.chain import zk
    from app.chain.client import ix_discriminator, receipt_pda

    a, b, c = zk.corrupt_proof()
    assert a != zk.FIXTURE_PROOF_A and (b, c) == (zk.FIXTURE_PROOF_B, zk.FIXTURE_PROOF_C)

    def on_curve(pt: bytes) -> bool:
        x, y = int.from_bytes(pt[:32], "big"), int.from_bytes(pt[32:], "big")
        return (y * y - x * x * x - 3) % zk.BN254_P == 0

    assert on_curve(a) and on_curve(zk.FIXTURE_PROOF_A) and on_curve(c)
    assert zk.negate_g1(a) == zk.FIXTURE_PROOF_A

    idl = json.loads((REPO / "docs" / "blockchain" / "idl" / "verity_zk_verifier.json").read_text(encoding="utf-8"))
    spec = next(i for i in idl["instructions"] if i["name"] == "verify_payroll")
    request = str(Keypair().pubkey())
    prover = Keypair().pubkey()
    tax, net = zk.payroll_outputs(**PAYROLL_INPUT)
    assert (tax, net) == (200_000, 750_000)
    ix = zk.verify_payroll_ix(prover, request, (a, b, c), PAYROLL_INPUT["salary_cents"], PAYROLL_INPUT["tax_bps"],
                              PAYROLL_INPUT["deductions_cents"], tax, net)
    assert bytes(ix.data)[:8] == bytes(spec["discriminator"]) == ix_discriminator("verify_payroll")
    assert len(bytes(ix.data)) == 8 + 64 + 128 + 64 + 5 * 8
    assert [str(m.pubkey) for m in ix.accounts][:4] == [
        str(prover), str(zk.zk_config_pda()), request, str(receipt_pda(request))]
    assert [m.is_signer for m in ix.accounts] == [True, False, False, False, False, False]


def test_receipt_signing_roundtrip_is_bound_to_every_field():
    kp, pda = Keypair(), str(Keypair().pubkey())
    parts = [os.urandom(32) for _ in range(4)]
    msg = receipt_message(pda, *parts, 1234)
    sig = sign_receipt(kp, msg)
    assert verify_receipt(kp.pubkey(), msg, sig)
    for i in range(4):
        changed = list(parts)
        changed[i] = sha256(changed[i])
        assert not verify_receipt(kp.pubkey(), receipt_message(pda, *changed, 1234), sig)
    assert not verify_receipt(kp.pubkey(), receipt_message(pda, *parts, 1235), sig)
