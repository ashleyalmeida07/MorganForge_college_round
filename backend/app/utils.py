"""Canonical JSON + hashing helpers shared by every component."""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def canonical(obj: Any) -> bytes:
    """RFC 8785-style canonical JSON: sorted keys, no whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def hex_to_bytes32(h: str) -> bytes:
    h = h.lower().removeprefix("0x")
    b = bytes.fromhex(h)
    if len(b) != 32:
        raise ValueError("expected 32-byte hex string")
    return b


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ts_to_iso(ts: int | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


def explorer_tx(sig: str | None, cluster: str = "devnet") -> str | None:
    return f"https://explorer.solana.com/tx/{sig}?cluster={cluster}" if sig else None


def explorer_addr(addr: str | None, cluster: str = "devnet") -> str | None:
    return f"https://explorer.solana.com/address/{addr}?cluster={cluster}" if addr else None
