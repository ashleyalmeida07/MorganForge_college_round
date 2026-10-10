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

from solders.pubkey import Pubkey

from app.chain.client import B32, BOOL, I64, PK, U8, U64, account_discriminator, decode_fields, get_chain, to_pubkey
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
