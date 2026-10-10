"""Read-only client for the verity_zk_verifier program (Groth16 payroll proofs).

Accounts:
  ZkConfig       seeds ["zk_config"]
  ZkProofRecord  seeds ["zk", request_pda]   (created by verify_payroll)
Proofs are generated client-side (browser / zk/scripts/prove.mjs) and verified on-chain;
the backend only reads the resulting records.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from solders.compute_budget import set_compute_unit_limit
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey

from app.chain.client import SYSTEM_PROGRAM_ID as SYSTEM_PROGRAM, B32, BOOL, I64, PK, U8, U64, account_discriminator, decode_fields, get_chain, to_pubkey
from app.config import settings
from app.utils import explorer_addr

log = logging.getLogger("verity.chain.zk")

CIRCUIT_ID = "payroll_v1"

ZK_CONFIG_SCHEMA = [
    ("authority", PK),
    ("payroll_program_hash", B32),
    ("verified_count", U64),
    ("fraud_count", U64),
    ("bump", U8),
]
ZK_RECORD_SCHEMA = [
    ("request", PK),
    ("prover", PK),
    ("circuit", "b16"),
    ("program_hash", B32),
    ("input_hash", B32),
    ("receipt_output_hash", B32),
    ("proven_output_hash", B32),
    ("matches_receipt", BOOL),
    ("tax_cents", U64),
    ("net_cents", U64),
    ("verified_at", I64),
    ("slot", U64),
    ("bump", U8),
]


def zk_program_id() -> Pubkey:
    return to_pubkey(settings.zk_program_id)


def zk_config_pda() -> Pubkey:
    return Pubkey.find_program_address([b"zk_config"], zk_program_id())[0]


def zk_record_pda(request: str | Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"zk", bytes(to_pubkey(request))], zk_program_id())[0]


def _decode(data: bytes, name: str, schema: list) -> dict[str, Any] | None:
    if data[:8] != account_discriminator(name):
        return None
    if name == "ZkProofRecord":
        # decode_fields has no 16-byte type: split around the circuit id.
        head = decode_fields(data, schema[:2])
        circuit = data[8 + 64 : 8 + 64 + 16].rstrip(b"\0").decode("utf-8", "replace")
        tail = decode_fields(data, schema[3:], offset=8 + 64 + 16)
        return {**head, "circuit": circuit, **tail}
    return decode_fields(data, schema)


async def _fetch(pk: Pubkey) -> bytes | None:
    chain = get_chain()
    resp = await chain.rpc.get_account_info(pk, encoding="base64")
    acc = resp.value
    if acc is None or acc.owner != zk_program_id():
        return None
    return bytes(acc.data)


async def get_zk_config() -> dict[str, Any] | None:
    data = await _fetch(zk_config_pda())
    return _decode(data, "ZkConfig", ZK_CONFIG_SCHEMA) if data else None


async def get_zk_record(request: str) -> dict[str, Any] | None:
    pda = zk_record_pda(request)
    data = await _fetch(pda)
    if not data:
        return None
    rec = _decode(data, "ZkProofRecord", ZK_RECORD_SCHEMA)
    if rec is None:
        return None
    rec["pda"] = str(pda)
    rec["verified_at_iso"] = datetime.fromtimestamp(int(rec["verified_at"]), tz=timezone.utc).isoformat()
    rec["explorer"] = explorer_addr(str(pda), settings.cluster)
    return rec


# ------------------------------------------------------------------ adversarial: corrupt proof (scenario 9)
#
# The backend cannot prove (snarkjs runs in the browser / scripts), but it can play an
# attacker that submits a *corrupted* Groth16 proof. Starting point: the verifier's test
# fixture proof (programs/verity_zk_verifier/tests/fixture.json, valid for another request);
# corruption: proof A negated, which keeps every point on the curve so the on-chain
# pairing check (not point decoding) is what rejects it with InvalidProof.

BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583
FIXTURE_PROOF_A = bytes.fromhex(
    "1c618c5167c6e11b465a9e2dac3e5f0248eed7b6f75d02a127676613158b03c3"
    "124df2de70cfd9250733a4bd18aa624d02f7dd39f0dbefbb4dd97014e83fdd0d"
)
FIXTURE_PROOF_B = bytes.fromhex(
    "21b4fde33c3cab0b56aa9a5fbc3c85a50830ac373921b06a80d12cc918722821"
    "0189889659346602320ea02f09b61fec9cd97343e3d30dff12049f108d49cc8a"
    "0b81b42b9eb0d84312828ffad8fbd617fed6030b9705764579e59ba4c0f9b90c"
    "00fefcccabdea35291a88d2efb387c58a79b79520ad52d7a03e3124c7d31bd5e"
)
FIXTURE_PROOF_C = bytes.fromhex(
    "11f01e30a0aae1b802c2e07cf73097e05569c598d6600048d8256ba27bf00539"
    "117e863e3ee90ef343e3d50996edcc2dc3a5b5f4a90fb70b41d645eb72951483"
)
VERIFY_COMPUTE_UNITS = 600_000
PAYROLL_FIELDS = ("salary_cents", "tax_bps", "deductions_cents")


def negate_g1(point: bytes) -> bytes:
    """-P for a big-endian (x, y) BN254 G1 point: (x, p - y)."""
    if len(point) != 64:
        raise ValueError("G1 point must be 64 bytes")
    y = int.from_bytes(point[32:], "big")
    return point[:32] + ((BN254_P - y) % BN254_P).to_bytes(32, "big")


def corrupt_proof() -> tuple[bytes, bytes, bytes]:
    return negate_g1(FIXTURE_PROOF_A), FIXTURE_PROOF_B, FIXTURE_PROOF_C


def payroll_outputs(salary_cents: int, tax_bps: int, deductions_cents: int) -> tuple[int, int]:
    """(tax_cents, net_cents) exactly as rulesets/payroll and zk/payroll/payroll.circom compute them."""
    tax = salary_cents * tax_bps // 10_000
    return tax, salary_cents - tax - deductions_cents


def verify_payroll_ix(
    prover: Pubkey,
    request: str | Pubkey,
    proof: tuple[bytes, bytes, bytes],
    salary_cents: int,
    tax_bps: int,
    deductions_cents: int,
    tax_cents: int,
    net_cents: int,
) -> Instruction:
    from app.chain.client import ix_discriminator, receipt_pda

    a, b, c = proof
    if (len(a), len(b), len(c)) != (64, 128, 64):
        raise ValueError("proof must be (64, 128, 64) bytes")
    req = to_pubkey(request)
    data = ix_discriminator("verify_payroll") + a + b + c + b"".join(
        int(v).to_bytes(8, "little") for v in (salary_cents, tax_bps, deductions_cents, tax_cents, net_cents)
    )
    return Instruction(
        zk_program_id(),
        data,
        [
            AccountMeta(prover, True, True),
            AccountMeta(zk_config_pda(), False, True),
            AccountMeta(req, False, False),
            AccountMeta(receipt_pda(req), False, False),
            AccountMeta(zk_record_pda(req), False, True),
            AccountMeta(SYSTEM_PROGRAM, False, False),
        ],
    )


async def submit_corrupt_proof(prover_kp: Keypair, request: str, payroll_input: dict[str, Any]) -> str:
    """Submit a corrupted proof for a payroll request (honest public inputs). Expected to fail
    on-chain with InvalidProof; the tx skips preflight so the rejection is visible on the explorer.
    Returns the signature only if the chain (wrongly) accepted it."""
    vals = [int(payroll_input[k]) for k in PAYROLL_FIELDS]
    tax, net = payroll_outputs(*vals)
    ix = verify_payroll_ix(prover_kp.pubkey(), request, corrupt_proof(), *vals, tax, net)
    chain = get_chain()
    return await chain._send(  # noqa: SLF001 - shared signing/confirm path of the core client
        "verify_payroll(corrupt)", [set_compute_unit_limit(VERIFY_COMPUTE_UNITS), ix], prover_kp,
        skip_preflight=True,
    )


async def zk_status(request: str, program_hash: str | None) -> dict[str, Any]:
    """Everything the UI needs: eligibility, the on-chain proof record, program ids."""
    out: dict[str, Any] = {
        "circuit": CIRCUIT_ID,
        "zk_program_id": settings.zk_program_id,
        "config_pda": str(zk_config_pda()),
        "record_pda": str(zk_record_pda(request)),
        "eligible": False,
        "payroll_program_hash": None,
        "record": None,
        "error": None,
    }
    try:
        cfg = await get_zk_config()
        if cfg:
            out["payroll_program_hash"] = cfg["payroll_program_hash"]
            out["verified_count"] = cfg["verified_count"]
            out["fraud_count"] = cfg["fraud_count"]
            out["eligible"] = bool(program_hash) and cfg["payroll_program_hash"] == str(program_hash).lower()
        out["record"] = await get_zk_record(request)
    except Exception as e:  # noqa: BLE001 - zk is an optional layer; never break the request page
        log.warning("zk status for %s failed: %s", request, e)
        out["error"] = str(e)[:300]
    return out
