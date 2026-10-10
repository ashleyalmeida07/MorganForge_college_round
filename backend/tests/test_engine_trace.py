"""Offline tests: deterministic WASM rule sets, content-addressed commitments,
receipt signing and the TRACE_V2 execution-trace Merkle commitments.

Needs the built rule sets (cd rulesets && cargo build --release --target wasm32-unknown-unknown).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from solders.keypair import Keypair

from app.chain.signer import receipt_message, sign_receipt, verify_receipt
from app.engine import runner
from app.engine import trace as tracing
from app.utils import canonical, sha256
from app.workers.common import tamper_output

RULESETS = Path(__file__).resolve().parents[2] / "rulesets"
WASM_DIR = RULESETS / "target" / "wasm32-unknown-unknown" / "release"
NAMES = ["payroll", "loan_amortization", "tax_india", "stats_outliers", "credit_risk", "ml_inference"]

pytestmark = pytest.mark.skipif(not WASM_DIR.exists(), reason="rule sets not built")


def load(name: str) -> tuple[bytes, dict]:
    meta = json.loads((RULESETS / name / "meta.json").read_text(encoding="utf-8"))
    return (WASM_DIR / f"{name}.wasm").read_bytes(), meta


@pytest.mark.parametrize("name", NAMES)
def test_deterministic_and_committed(name):
    wasm, meta = load(name)
    inp = canonical(meta["example_input"])
    a = runner.run(wasm, inp, sha256(wasm), sha256(inp))
    b = runner.run(wasm, inp, sha256(wasm), sha256(inp))
    assert a.output_bytes == b.output_bytes and a.fuel_used == b.fuel_used and a.trace_root == b.trace_root
    assert a.output_hash == sha256(a.output_bytes)
    assert canonical(a.output) == a.output_bytes, "rule-set output must already be canonical JSON"
    assert "error" not in a.output
    assert len(a.checkpoints) >= 1
    assert a.trace_root == tracing.trace_root(inp, list(a.checkpoints), a.output_bytes)


def test_program_and_input_hash_enforced():
    wasm, meta = load("payroll")
    inp = canonical(meta["example_input"])
    with pytest.raises(runner.ProgramHashMismatch):
        runner.run(wasm, inp, sha256(wasm + b"x"), None)
    with pytest.raises(runner.InputHashMismatch):
        runner.run(wasm, inp, None, sha256(inp + b" "))


def test_payroll_matches_zk_circuit_encoding():
    wasm, _ = load("payroll")
    inp = b'{"deductions_cents":50000,"salary_cents":1000000,"tax_bps":2000}'
    res = runner.run(wasm, inp)
    # byte-identical to what verity_zk_verifier rebuilds on-chain
    assert res.output_bytes == b'{"deductions_cents":50000,"gross_cents":1000000,"net_cents":750000,"tax_cents":200000}'


def test_rule_errors_are_deterministic_outputs():
    wasm, _ = load("payroll")
    res = runner.run(wasm, b'{"deductions_cents":1,"salary_cents":1,"tax_bps":20000}')
    assert res.output == {"error": "tax_bps must be <= 10000"}
    res = runner.run(wasm, b'{"salary_cents":"lots"}')
    assert res.output["error"].startswith("invalid input")


def test_loan_schedule_balances_to_zero_and_trace_per_month():
    wasm, meta = load("loan_amortization")
    res = runner.run(wasm, canonical(meta["example_input"]))
    sched = res.output["schedule"]
    assert len(sched) == 36 and sched[-1]["balance_cents"] == 0
    assert sum(r["principal_cents"] for r in sched) == meta["example_input"]["principal_cents"]
    assert len(res.checkpoints) == 1 + 36  # emi + one per month


def test_merkle_proofs_and_first_divergence():
    wasm, meta = load("loan_amortization")
    inp = canonical(meta["example_input"])
    res = runner.run(wasm, inp)
    leaves = res.trace_leaves
    for i in (0, 1, 17, len(leaves) - 1):
        proof = tracing.merkle_proof(leaves, i)
        assert tracing.verify_proof(leaves[i], proof, len(leaves), res.trace_root)
        assert not tracing.verify_proof(sha256(b"evil"), proof, len(leaves), res.trace_root)

    # A provider that corrupts month 20's state diverges exactly at that step.
    cps = list(res.checkpoints)
    cps[20] = cps[20].replace(b'"balance_cents":', b'"balance_cents":9')
    bad = tracing.leaves_of(tracing.steps_of(inp, cps, res.output_bytes))
    assert tracing.first_divergence(bad, leaves) == 21  # +1 for the input leaf
    assert tracing.first_divergence(leaves, leaves) is None


def test_trace_document_roundtrip_and_tamper_detection():
    wasm, meta = load("stats_outliers")
    res = runner.run(wasm, canonical(meta["example_input"]))
    doc = res.trace_document("PDA", sha256(wasm).hex())
    assert doc["trace_root"] == res.trace_root.hex()
    assert tracing.check_document(doc) == {"ok": True, "trace_root": res.trace_root.hex(), "errors": []}
    doc["steps"][2]["data"] = doc["steps"][2]["data"].replace("1", "2", 1)
    assert not tracing.check_document(doc)["ok"]


def test_tampered_output_diverges_only_at_output_step():
    """What the PROVIDER_TAMPER_OUTPUT chaos path commits to."""
    wasm, meta = load("credit_risk")
    inp = canonical(meta["example_input"])
    res = runner.run(wasm, inp)
    bad_out = canonical(tamper_output(res.output))
    bad_root = runner.compute_trace_root(inp, bad_out, res.checkpoints)
    assert bad_root != res.trace_root
    bad_leaves = tracing.leaves_of(tracing.steps_of(inp, list(res.checkpoints), bad_out))
    assert tracing.first_divergence(bad_leaves, res.trace_leaves) == len(res.trace_leaves) - 1


def test_signed_receipt_binds_request_and_trace():
    wasm, meta = load("payroll")
    inp = canonical(meta["example_input"])
    res = runner.run(wasm, inp)
    kp = Keypair()
    pda = str(Keypair().pubkey())
    msg = receipt_message(pda, sha256(wasm), sha256(inp), res.output_hash, res.trace_root, res.fuel_used)
    sig = sign_receipt(kp, msg)
    assert verify_receipt(str(kp.pubkey()), msg, sig)
    other = receipt_message(str(Keypair().pubkey()), sha256(wasm), sha256(inp), res.output_hash,
                            res.trace_root, res.fuel_used)
    assert not verify_receipt(str(kp.pubkey()), other, sig)  # replay onto another request fails
