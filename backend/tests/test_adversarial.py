"""Adversarial end-to-end scenarios 1-9 (Implementation_plan.md §10) against a live deployment.

The same scenarios run without a network in tests/test_adversarial_offline.py (always, in CI).

These tests drive a *running* Verity backend (workers enabled) and the Solana
devnet program. They are skipped unless VERITY_E2E=1.

Environment:
    VERITY_E2E=1                      enable the suite
    VERITY_API_URL                    e.g. https://verity-api.onrender.com (default http://localhost:8000)
    VERITY_ADMIN_TOKEN                Supabase access token (JWT) of an admin user, or the backend's DEV_ADMIN_TOKEN
    REQUESTER_KEYPAIR_JSON            funded devnet keypair that creates requests / opens disputes
    VERITY_PROGRAM_HASH               optional: rule set to use (default: first program with example_input)
    VERITY_TEST_INPUT_JSON            optional: input JSON for that program (default: its example_input)
    VERITY_TEST_BOUNTY_LAMPORTS       optional (default 10_000_000 = 0.01 SOL)
    VERITY_TEST_TIMEOUT               optional seconds per scenario wait (default 420)
    SOLANA_RPC_URL / PROGRAM_ID / SUPABASE_URL / PROVIDER_KEYPAIR_JSON come from backend/.env as usual
    (PROVIDER_KEYPAIR_JSON is only needed for the replay scenario).

Run:  VERITY_E2E=1 pytest -m devnet tests/test_adversarial.py -v -s
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import random
import time
from typing import Any, Callable, Iterable

import pytest

pytestmark = [
    pytest.mark.devnet,
    pytest.mark.skipif(os.environ.get("VERITY_E2E") != "1", reason="set VERITY_E2E=1 to run devnet E2E scenarios"),
]

API_URL = os.environ.get("VERITY_API_URL", "http://localhost:8000").rstrip("/")
ADMIN_TOKEN = os.environ.get("VERITY_ADMIN_TOKEN") or os.environ.get("DEV_ADMIN_TOKEN", "")
BOUNTY = int(os.environ.get("VERITY_TEST_BOUNTY_LAMPORTS", "10000000"))
TIMEOUT = int(os.environ.get("VERITY_TEST_TIMEOUT", "420"))
POLL_SECS = 3.0

CHAOS_FLAGS = [
    "PROVIDER_TAMPER_OUTPUT",
    "PROVIDER_SWAP_PROGRAM",
    "STORAGE_TAMPER_INPUT",
    "STORAGE_TAMPER_OUTPUT",
    "PROVIDER_BAD_SIG",
    "VERIFIER_LAZY",
    "ZK_CORRUPT_PROOF",
]

_STATE: dict[str, Any] = {}


# ====================================================================== helpers

def _as_list(data: Any, keys: Iterable[str] = ("items", "data", "programs", "requests", "results")) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            if isinstance(data.get(k), list):
                return data[k]
    return []


def _find_urls(obj: Any) -> Iterable[str]:
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _find_urls(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _find_urls(v)
    elif isinstance(obj, str) and obj.startswith(("http://", "https://")):
        yield obj


def _report_flags_failure(obj: Any) -> bool:
    """True if an integrity report contains a False under an ok/match/valid/pass-like key."""
    words = ("ok", "match", "valid", "pass", "intact", "verified")
    if isinstance(obj, dict):
        for k, v in obj.items():
            if v is False and any(w in str(k).lower() for w in words):
                return True
            if isinstance(v, str) and v.upper() in ("FAIL", "FAILED", "MISMATCH", "TAMPERED"):
                return True
            if _report_flags_failure(v):
                return True
    elif isinstance(obj, list):
        return any(_report_flags_failure(v) for v in obj)
    return False


def _perturb(example: Any) -> Any:
    """Make the input unique per test (storage URIs are content-addressed by input hash):
    bump the largest top-level integer field by a small random amount."""
    obj = copy.deepcopy(example)
    if isinstance(obj, dict):
        ints = [(k, v) for k, v in obj.items() if isinstance(v, int) and not isinstance(v, bool)]
        if ints:
            k, v = max(ints, key=lambda kv: kv[1])
            obj[k] = v + random.randint(1, 997)
    return obj


class E2E:
    def __init__(self, loop: asyncio.AbstractEventLoop, api, chain, requester, program: dict, base_input: Any):
        self.loop = loop
        self.api = api
        self.chain = chain
        self.requester = requester
        self.program = program
        self.base_input = base_input

    # ---------------------------------------------------------- plumbing
    def run(self, coro):
        return self.loop.run_until_complete(coro)

    def chaos(self, **enabled: bool) -> None:
        for flag in CHAOS_FLAGS:
            r = self.api.post("/admin/chaos", json={"flag": flag, "enabled": bool(enabled.get(flag, False))})
            assert r.status_code < 400, f"/admin/chaos {flag}: {r.status_code} {r.text}"

    def config(self) -> dict:
        cfg = self.run(self.chain.get_config())
        assert cfg, "on-chain config missing — run scripts/bootstrap_chain.py"
        return cfg

    # ---------------------------------------------------------- requests
    def prepare(self, inp: Any) -> dict:
        r = self.api.post("/requests/prepare", json={"program_hash": self.program["program_hash"], "input": inp})
        assert r.status_code == 200, f"/requests/prepare: {r.status_code} {r.text}"
        return r.json()

    def submit(self, title: str, inp: Any | None = None, deadline_secs: int = 600, confirm: bool = True) -> dict:
        import base58

        from app.chain.signer import input_commitment_message
        from app.utils import hex_to_bytes32

        inp = _perturb(self.base_input) if inp is None else inp
        prep = self.prepare(inp)
        hashes = [hex_to_bytes32(prep[k]) for k in ("program_hash", "input_hash", "input_uri_hash")]

        async def commit_input(pda: str) -> None:
            # Same requester-signed commitment the create-job page stores; the provider refuses jobs without it.
            sig = self.requester.sign_message(input_commitment_message(*hashes))
            r = await asyncio.to_thread(self.api.post, "/requests/commit-input", json={
                "request_pda": pda, "requester": str(self.requester.pubkey()),
                "program_hash": prep["program_hash"], "input_hash": prep["input_hash"],
                "input_uri_hash": prep["input_uri_hash"], "signature": base58.b58encode(bytes(sig)).decode(),
            })
            assert r.status_code < 400, f"/requests/commit-input: {r.status_code} {r.text}"

        sig, pda = self.run(self.chain.create_request(
            self.requester, *hashes, BOUNTY, int(time.time()) + deadline_secs, before_send=commit_input,
        ))
        if confirm:
            r = self.api.post("/requests/confirm", json={"request_pda": pda, "tx_sig": sig, "title": f"[e2e] {title}"})
            assert r.status_code < 400, f"/requests/confirm: {r.status_code} {r.text}"
        print(f"\n[{title}] request {pda} tx {sig}")
        return {"pda": pda, "tx": sig, "input": inp, "prep": prep}

    def request(self, pda: str) -> dict | None:
        return self.run(self.chain.get_request(pda))

    def wait(self, pda: str, until: Callable[[dict], bool] | set[str], timeout: float = TIMEOUT,
             label: str = "") -> dict:
        pred = (lambda r: r.get("status") in until) if isinstance(until, set) else until
        deadline = time.time() + timeout
        last: dict | None = None
        last_status = None
        while time.time() < deadline:
            last = self.request(pda)
            if last:
                if last.get("status") != last_status:
                    last_status = last.get("status")
                    print(f"  {pda[:8]}.. status -> {last_status}")
                if pred(last):
                    return last
            time.sleep(POLL_SECS)
        raise AssertionError(f"timeout waiting for {label or until} on {pda}; last state: {last}")

    def wait_dispute(self, pda: str, statuses: set[str], timeout: float = TIMEOUT) -> dict:
        deadline = time.time() + timeout
        d = None
        while time.time() < deadline:
            d = self.run(self.chain.get_dispute(pda))
            if d and d.get("status") in statuses:
                return d
            time.sleep(POLL_SECS)
        raise AssertionError(f"timeout waiting for dispute {statuses} on {pda}; last: {d}")

    # ---------------------------------------------------------- blobs
    def blob(self, uri: str, pda: str) -> bytes:
        import httpx

        from app.config import settings

        if settings.supabase_url:
            from app.db import public_url

            url = public_url(uri)
        else:
            r = self.api.get(f"/requests/{pda}/artifacts")
            assert r.status_code == 200, f"/artifacts: {r.status_code} {r.text}"
            url = next((u for u in _find_urls(r.json()) if u.split("?", 1)[0].endswith("/" + uri)), None)
            assert url, f"no public URL for {uri} in artifacts response"
        # cache-buster: storage CDNs may serve the pre-tamper object for a short while
        resp = httpx.get(url, params={"t": str(time.time())}, timeout=30, follow_redirects=True)
        assert resp.status_code == 200, f"GET {url}: {resp.status_code}"
        return resp.content


# ====================================================================== fixtures

@pytest.fixture(scope="session")
def loop():
    lp = asyncio.new_event_loop()
    yield lp
    lp.close()


@pytest.fixture(scope="session")
def api():
    import httpx

    if not ADMIN_TOKEN:
        pytest.skip("VERITY_ADMIN_TOKEN not set")
    client = httpx.Client(base_url=API_URL, headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}, timeout=90)
    r = client.get("/health")
    if r.status_code != 200:
        pytest.skip(f"API not healthy at {API_URL}: {r.status_code}")
    yield client
    client.close()


@pytest.fixture(scope="session")
def chain():
    from app.chain.client import get_chain

    return get_chain()


@pytest.fixture(scope="session")
def requester():
    from app.chain.keys import parse_keypair

    raw = os.environ.get("REQUESTER_KEYPAIR_JSON", "")
    if not raw:
        pytest.skip("REQUESTER_KEYPAIR_JSON not set")
    return parse_keypair(raw)


@pytest.fixture(scope="session")
def e2e(loop, api, chain, requester) -> E2E:
    r = api.get("/programs")
    assert r.status_code == 200, f"/programs: {r.status_code} {r.text}"
    programs = _as_list(r.json())
    wanted = os.environ.get("VERITY_PROGRAM_HASH")
    if wanted:
        program = next((p for p in programs if p.get("program_hash") == wanted), None)
        if program is None:
            pr = api.get(f"/programs/{wanted}")
            assert pr.status_code == 200, f"program {wanted} not found"
            program = pr.json().get("program", pr.json())
    else:
        program = next((p for p in programs if p.get("example_input") is not None), None)
    if program is None:
        pytest.skip("no rule set with example_input registered — run scripts/seed_rulesets.py")

    base_input = json.loads(os.environ["VERITY_TEST_INPUT_JSON"]) if os.environ.get("VERITY_TEST_INPUT_JSON") \
        else program.get("example_input")
    assert base_input is not None, "no test input available"

    bal = loop.run_until_complete(chain.get_balance(requester.pubkey()))
    if bal < BOUNTY * 3 + 100_000_000:
        pytest.skip(f"requester {requester.pubkey()} balance too low: {bal} lamports")
    print(f"\nprogram {program.get('name')} {program['program_hash']}  requester {requester.pubkey()}")
    return E2E(loop, api, chain, requester, program, base_input)


@pytest.fixture(autouse=True)
def reset_chaos(e2e: E2E):
    e2e.chaos()
    yield
    e2e.chaos()


# ====================================================================== scenarios

def test_00_happy_path_verified(e2e: E2E):
    from app.chain.signer import receipt_message, verify_receipt

    job = e2e.submit("happy path")
    req = e2e.wait(job["pda"], {"Verified", "Rejected", "Expired"}, label="terminal")
    assert req["status"] == "Verified", f"expected Verified, got {req['status']}"
    assert req["settled"] is True

    rc = e2e.run(e2e.chain.get_receipt(job["pda"]))
    assert rc is not None
    msg = receipt_message(job["pda"], bytes.fromhex(req["program_hash"]), bytes.fromhex(req["input_hash"]),
                          bytes.fromhex(rc["output_hash"]), bytes.fromhex(rc["trace_root"]), int(rc["fuel_used"]))
    assert verify_receipt(rc["provider"], msg, bytes.fromhex(rc["signature"])), "receipt signature invalid"

    quorum = int(e2e.config()["required_attestations"])
    atts = e2e.run(e2e.chain.list_attestations(job["pda"]))
    assert sum(1 for a in atts if a["counted"] and a["matches"]) >= quorum

    out = e2e.blob(f"outputs/{job['pda']}.json", job["pda"])
    assert hashlib.sha256(out).hexdigest() == rc["output_hash"], "stored output does not match receipt"
    inp = e2e.blob(f"inputs/{req['input_hash']}.json", job["pda"])
    assert hashlib.sha256(inp).hexdigest() == req["input_hash"], "stored input does not match chain"

    _STATE["verified"] = {"pda": job["pda"], "input": job["input"], "receipt": rc}


def test_01_malicious_provider_tampered_output_is_slashed(e2e: E2E):
    """Scenario 1: provider tampers the output -> verifier mismatch quorum -> dispute -> Rejected + slash."""
    before = {p["owner"]: int(p.get("slashed") or 0) for p in e2e.run(e2e.chain.list_providers())}
    e2e.chaos(PROVIDER_TAMPER_OUTPUT=True)
    job = e2e.submit("tampered output")
    req = e2e.wait(job["pda"], {"Rejected", "Verified", "Expired"}, label="terminal")
    assert req["status"] == "Rejected", f"tampered output was not rejected: {req['status']}"

    quorum = int(e2e.config()["required_attestations"])
    atts = e2e.run(e2e.chain.list_attestations(job["pda"]))
    assert sum(1 for a in atts if a["counted"] and not a["matches"]) >= quorum

    d = e2e.run(e2e.chain.get_dispute(job["pda"]))
    assert d is not None and d["status"] == "ChallengerWon", f"dispute: {d}"

    prov = e2e.run(e2e.chain.get_provider(req["provider"]))
    assert int(prov["slashed"]) >= before.get(req["provider"], 0) + 1, "provider was not slashed"


def test_02_swapped_program_never_verifies(e2e: E2E):
    """Scenario 2: provider runs a different WASM -> own hash check aborts, or verifiers mismatch."""
    e2e.chaos(PROVIDER_SWAP_PROGRAM=True)
    job = e2e.submit("swapped program", deadline_secs=120)
    req = e2e.wait(job["pda"], {"Rejected", "Expired", "Verified"}, timeout=120 + TIMEOUT, label="terminal")
    assert req["status"] != "Verified", "a swapped program must never be Verified"
    rc = e2e.run(e2e.chain.get_receipt(job["pda"]))
    if rc is not None:
        assert req["status"] == "Rejected"
        d = e2e.run(e2e.chain.get_dispute(job["pda"]))
        assert d is not None and d["status"] == "ChallengerWon"
    else:
        assert req["status"] == "Expired", "provider aborted; request should expire and refund"


def test_03_tampered_input_blob_is_detected(e2e: E2E):
    """Scenario 3: input blob edited after request creation -> executors refuse to run it."""
    e2e.chaos(STORAGE_TAMPER_INPUT=True)
    job = e2e.submit("tampered input", deadline_secs=120)
    try:
        r = e2e.api.post("/admin/tamper", json={"request_pda": job["pda"], "target": "input"})
        assert r.status_code < 400, f"/admin/tamper: {r.status_code} {r.text}"

        data = e2e.blob(job["prep"]["input_uri"], job["pda"])
        assert hashlib.sha256(data).hexdigest() != job["prep"]["input_hash"], "input blob was not tampered"

        req = e2e.wait(job["pda"], {"Expired", "Rejected", "Verified"}, timeout=120 + TIMEOUT, label="terminal")
        assert req["status"] != "Verified", "a request with a tampered input must never be Verified"
        rc = e2e.run(e2e.chain.get_receipt(job["pda"]))
        if rc is None:
            assert req["status"] == "Expired"

        rv = e2e.api.post(f"/requests/{job['pda']}/reverify")
        assert rv.status_code == 200, f"/reverify: {rv.status_code} {rv.text}"
        assert _report_flags_failure(rv.json()), f"reverify did not flag the tampered input: {rv.text[:500]}"
    finally:
        e2e.chaos()
        e2e.prepare(job["input"])  # re-upload the canonical input (restores the blob)


def test_04_tampered_output_blob_is_detected_chain_unaffected(e2e: E2E):
    """Scenario 4: output blob edited after receipt -> re-hash mismatch; on-chain record unchanged."""
    job = e2e.submit("tampered output blob")
    e2e.wait(job["pda"], {"AwaitingVerification", "Verified", "Disputed", "Rejected"}, label="receipt")
    rc_before = e2e.run(e2e.chain.get_receipt(job["pda"]))
    assert rc_before is not None

    r = e2e.api.post("/admin/tamper", json={"request_pda": job["pda"], "target": "output"})
    assert r.status_code < 400, f"/admin/tamper: {r.status_code} {r.text}"

    out = e2e.blob(f"outputs/{job['pda']}.json", job["pda"])
    assert hashlib.sha256(out).hexdigest() != rc_before["output_hash"], "tampered output still matches receipt"

    rc_after = e2e.run(e2e.chain.get_receipt(job["pda"]))
    assert rc_after["output_hash"] == rc_before["output_hash"], "on-chain receipt must be immutable"

    rv = e2e.api.post(f"/requests/{job['pda']}/reverify")
    assert rv.status_code == 200, f"/reverify: {rv.status_code} {rv.text}"
    assert _report_flags_failure(rv.json()), f"reverify did not flag the tampered output: {rv.text[:500]}"

    # tampering storage does not change settlement: honest result still verifies
    req = e2e.wait(job["pda"], {"Verified", "Rejected", "Expired"}, label="terminal")
    assert req["status"] == "Verified"


def test_05_forged_receipt_signature_rejected_on_chain(e2e: E2E):
    """Scenario 5: provider signs with the wrong key -> Ed25519 introspection rejects the tx."""
    e2e.chaos(PROVIDER_BAD_SIG=True)
    job = e2e.submit("bad signature", deadline_secs=90)
    e2e.wait(job["pda"], {"Claimed", "AwaitingVerification", "Expired"}, timeout=90, label="claimed")
    time.sleep(30)  # several provider ticks
    assert e2e.run(e2e.chain.get_receipt(job["pda"])) is None, "a receipt with a forged signature landed on chain"

    req = e2e.wait(job["pda"], {"Expired", "AwaitingVerification", "Verified"}, timeout=90 + TIMEOUT, label="terminal")
    assert req["status"] == "Expired", f"expected Expired after forged receipts, got {req['status']}"
    assert e2e.run(e2e.chain.get_receipt(job["pda"])) is None


def test_06_lazy_verifier_is_outvoted(e2e: E2E):
    """Scenario 6: tampered output + a lazy verifier copying the provider's hash."""
    e2e.chaos(PROVIDER_TAMPER_OUTPUT=True, VERIFIER_LAZY=True)
    job = e2e.submit("lazy verifier")
    req = e2e.wait(job["pda"], {"Rejected", "Verified", "Expired"}, label="terminal")
    assert req["status"] == "Rejected", f"lazy verifier was not outvoted: {req['status']}"

    quorum = int(e2e.config()["required_attestations"])
    atts = e2e.run(e2e.chain.list_attestations(job["pda"]))
    lazy = [a for a in atts if a["matches"]]
    honest = [a for a in atts if a["counted"] and not a["matches"]]
    assert lazy, "expected the lazy verifier's (wrong) matching attestation to be recorded on chain"
    assert len(honest) >= quorum
    d = e2e.run(e2e.chain.get_dispute(job["pda"]))
    assert d is not None and d["status"] == "ChallengerWon"
    lazy_keys = {a["verifier"] for a in lazy}
    assert lazy_keys.isdisjoint({a["verifier"] for a in honest})


def test_07_replayed_receipt_rejected(e2e: E2E):
    """Scenario 7: resubmit an old (valid) receipt for a new request -> signature invalid for the new PDA."""
    from app.chain.client import ChainError
    from app.chain.keys import provider_keypair
    from app.chain.signer import receipt_message, verify_receipt

    prov = provider_keypair()
    if prov is None:
        pytest.skip("PROVIDER_KEYPAIR_JSON not available to the test process")
    old = _STATE.get("verified")
    if old is None:
        pytest.skip("needs test_00_happy_path_verified to have produced a verified request")
    rc = old["receipt"]
    if rc["provider"] != str(prov.pubkey()):
        pytest.skip("old receipt was produced by a different provider key")

    job = e2e.submit("replay", inp=old["input"], deadline_secs=60, confirm=False)
    try:
        e2e.run(e2e.chain.claim_request(prov, job["pda"]))
    except ChainError as exc:
        pytest.skip(f"provider worker claimed first, cannot stage replay: {exc.code}")

    new_req = e2e.request(job["pda"])
    msg = receipt_message(job["pda"], bytes.fromhex(new_req["program_hash"]), bytes.fromhex(new_req["input_hash"]),
                          bytes.fromhex(rc["output_hash"]), bytes.fromhex(rc["trace_root"]), int(rc["fuel_used"]))
    assert not verify_receipt(rc["provider"], msg, bytes.fromhex(rc["signature"])), \
        "old signature must not verify for a new request PDA"

    with pytest.raises(ChainError):
        e2e.run(e2e.chain.submit_receipt(
            prov, job["pda"], bytes.fromhex(rc["output_hash"]), bytes.fromhex(rc["trace_root"]),
            int(rc["fuel_used"]), bytes.fromhex(rc["signature"]),
        ))
    landed = e2e.run(e2e.chain.get_receipt(job["pda"]))
    assert landed is None or landed["signature"] != rc["signature"], "replayed receipt landed on chain"


def test_08_frivolous_dispute_slashes_challenger(e2e: E2E):
    """Scenario 8: dispute an honest result -> quorum agrees with provider -> challenger loses stake."""
    from app.chain.client import ChainError

    job = e2e.submit("frivolous dispute")
    e2e.wait(job["pda"], {"AwaitingVerification", "Verified", "Rejected", "Expired"}, label="receipt")
    req = e2e.request(job["pda"])
    if req["status"] != "AwaitingVerification":
        pytest.skip(f"challenge window already closed ({req['status']})")

    stake = int(e2e.config()["min_dispute_stake"])
    bal_before = e2e.run(e2e.chain.get_balance(e2e.requester.pubkey()))
    try:
        sig = e2e.run(e2e.chain.open_dispute(e2e.requester, job["pda"], os.urandom(32)))
    except ChainError as exc:
        if exc.code in ("InvalidStatus",):
            pytest.skip("request finalized before the dispute could be opened")
        raise
    print(f"  dispute opened {sig}")

    window = int(e2e.config()["challenge_window_secs"])
    d = e2e.wait_dispute(job["pda"], {"ProviderWon", "ChallengerWon"}, timeout=window + TIMEOUT)
    assert d["status"] == "ProviderWon", f"frivolous dispute won: {d}"

    req = e2e.wait(job["pda"], {"Verified", "Rejected", "Expired"}, timeout=window + TIMEOUT, label="terminal")
    assert req["status"] == "Verified"
    bal_after = e2e.run(e2e.chain.get_balance(e2e.requester.pubkey()))
    assert bal_after <= bal_before - stake, "challenger stake was not forfeited"


def test_09_corrupt_zk_proof_rejected_on_chain(e2e: E2E):
    """Scenario 9: a corrupted Groth16 proof for a payroll request -> verify_payroll fails (InvalidProof)."""
    from app.chain.client import ChainError
    from app.chain.zk import PAYROLL_FIELDS, get_zk_config, get_zk_record, submit_corrupt_proof

    cfg = e2e.run(get_zk_config())
    if not cfg:
        pytest.skip("verity_zk_verifier not configured on this cluster")
    if e2e.program["program_hash"].lower() != cfg["payroll_program_hash"]:
        pytest.skip("VERITY_PROGRAM_HASH is not the zk payroll rule set")
    e2e.chaos(ZK_CORRUPT_PROOF=True)
    inp = {k: int(e2e.base_input[k]) for k in PAYROLL_FIELDS}
    inp["salary_cents"] += random.randint(1, 997) * 100
    job = e2e.submit("corrupt zk proof", inp=inp)
    e2e.wait(job["pda"], {"AwaitingVerification", "Verified", "Disputed", "Rejected"}, label="receipt")

    with pytest.raises(ChainError) as exc:
        e2e.run(submit_corrupt_proof(e2e.requester, job["pda"], inp))
    assert exc.value.code == "InvalidProof", f"expected InvalidProof, got {exc.value.code}: {exc.value}"
    print(f"  rejected tx {exc.value.signature}")
    assert e2e.run(get_zk_record(job["pda"])) is None, "no proof record may exist for a corrupt proof"


def test_99_audit_log_chain_intact(e2e: E2E):
    r = e2e.api.get("/audit/verify")
    assert r.status_code == 200, f"/audit/verify: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True, f"audit hash chain broken: {body}"
    assert int(body.get("checked") or 0) > 0
