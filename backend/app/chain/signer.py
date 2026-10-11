"""Canonical execution-receipt bytes and Ed25519 signing / verification.

Receipt message (must match `receipt_message` in programs/verity_core/src/lib.rs):
    b"VERITY_RECEIPT_V1" || request_pda(32) || program_hash(32) || input_hash(32)
    || output_hash(32) || trace_root(32) || fuel_used(u64 LE)

Input commitment message (requester-signed, off-chain only — see §4.4), UTF-8 text so wallets
(Phantom) don't reject it as a disguised transaction:
    "VERITY_INPUT_V2\nprogram_hash: <hex>\ninput_hash: <hex>\ninput_uri_hash: <hex>"
"""
from __future__ import annotations

import logging

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from solders.keypair import Keypair
from solders.pubkey import Pubkey

log = logging.getLogger(__name__)

RECEIPT_DOMAIN = b"VERITY_RECEIPT_V1"
RECEIPT_MESSAGE_LEN = len(RECEIPT_DOMAIN) + 32 * 5 + 8

INPUT_DOMAIN = "VERITY_INPUT_V2"


def _pubkey_bytes(value: str | bytes | Pubkey) -> bytes:
    if isinstance(value, Pubkey):
        return bytes(value)
    if isinstance(value, (bytes, bytearray)):
        if len(value) != 32:
            raise ValueError(f"pubkey must be 32 bytes, got {len(value)}")
        return bytes(value)
    if isinstance(value, str):
        return bytes(Pubkey.from_string(value.strip()))
    raise TypeError(f"unsupported pubkey type {type(value).__name__}")


def _hash32(value: bytes, name: str) -> bytes:
    if isinstance(value, str):
        value = bytes.fromhex(value.lower().removeprefix("0x"))
    if not isinstance(value, (bytes, bytearray)) or len(value) != 32:
        raise ValueError(f"{name} must be 32 bytes")
    return bytes(value)


def receipt_message(
    request_pda: str | bytes | Pubkey,
    program_hash: bytes,
    input_hash: bytes,
    output_hash: bytes,
    trace_root: bytes,
    fuel_used: int,
) -> bytes:
    fuel = int(fuel_used)
    if fuel < 0 or fuel >= 1 << 64:
        raise ValueError("fuel_used must fit in u64")
    return b"".join(
        (
            RECEIPT_DOMAIN,
            _pubkey_bytes(request_pda),
            _hash32(program_hash, "program_hash"),
            _hash32(input_hash, "input_hash"),
            _hash32(output_hash, "output_hash"),
            _hash32(trace_root, "trace_root"),
            fuel.to_bytes(8, "little"),
        )
    )


def input_commitment_message(program_hash: bytes, input_hash: bytes, input_uri_hash: bytes) -> bytes:
    """Message a Requester's wallet signs to commit to an (program, input) pair before on-chain creation."""
    return (
        f"{INPUT_DOMAIN}\n"
        f"program_hash: {_hash32(program_hash, 'program_hash').hex()}\n"
        f"input_hash: {_hash32(input_hash, 'input_hash').hex()}\n"
        f"input_uri_hash: {_hash32(input_uri_hash, 'input_uri_hash').hex()}"
    ).encode()


def sign_receipt(kp: Keypair, msg: bytes) -> bytes:
    """Ed25519-sign `msg` with `kp`; returns the 64-byte signature."""
    sig = bytes(kp.sign_message(bytes(msg)))
    if len(sig) != 64:
        raise ValueError("unexpected signature length")
    return sig


def verify_receipt(pubkey: str | bytes | Pubkey, msg: bytes, sig: bytes) -> bool:
    """Verify an Ed25519 signature over `msg` by `pubkey` (base58). Never raises."""
    try:
        if isinstance(sig, str):
            sig = bytes.fromhex(sig.lower().removeprefix("0x"))
        sig = bytes(sig)
        if len(sig) != 64:
            return False
        VerifyKey(_pubkey_bytes(pubkey)).verify(bytes(msg), sig)
        return True
    except BadSignatureError:
        return False
    except Exception as e:  # noqa: BLE001 - malformed key / input means "not verified"
        log.debug("verify_receipt: invalid input: %s", e)
        return False
