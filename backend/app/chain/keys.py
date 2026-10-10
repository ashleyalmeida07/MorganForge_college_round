"""Keypair loading from settings, tolerant of the common secret-key encodings.

Accepted formats for a single keypair string:
  * JSON array of 64 ints (solana-keygen file contents) or 32 ints (seed)
  * JSON object with a "secretKey"/"secret_key"/"secret" array or string
  * path to a solana-keygen JSON file
  * hex (128 chars = 64-byte secret key, 64 chars = 32-byte seed)
  * base64 of 64 bytes (or a 32-byte seed)
  * base58 secret key (Phantom export) or base58 32-byte seed
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import string
from functools import lru_cache
from typing import Any

from solders.keypair import Keypair

from app.config import settings

log = logging.getLogger(__name__)

# ------------------------------------------------------------------ base58

_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_B58_INDEX = {c: i for i, c in enumerate(_B58_ALPHABET)}


def b58encode(data: bytes) -> str:
    """Bitcoin-alphabet base58 encoding (used for memcmp filters, etc.)."""
    data = bytes(data)
    n = int.from_bytes(data, "big")
    out: list[str] = []
    while n > 0:
        n, rem = divmod(n, 58)
        out.append(_B58_ALPHABET[rem])
    pad = len(data) - len(data.lstrip(b"\0"))
    return "1" * pad + "".join(reversed(out))


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        idx = _B58_INDEX.get(ch)
        if idx is None:
            raise ValueError(f"invalid base58 character {ch!r}")
        n = n * 58 + idx
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\0" * pad + body


# ------------------------------------------------------------------ parsing

_HEX = set(string.hexdigits)


def _from_raw(raw: bytes) -> Keypair:
    if len(raw) == 64:
        derived = Keypair.from_seed(raw[:32])
        if bytes(derived.pubkey()) != raw[32:]:
            raise ValueError("secret key and public key halves do not match")
        return derived
    if len(raw) == 32:
        return Keypair.from_seed(raw)
    raise ValueError(f"expected 64-byte secret key or 32-byte seed, got {len(raw)} bytes")


def _from_int_list(values: Any) -> Keypair:
    if not isinstance(values, list) or not all(isinstance(v, int) and not isinstance(v, bool) for v in values):
        raise ValueError("keypair JSON array must contain only integers")
    try:
        raw = bytes(values)
    except ValueError as e:
        raise ValueError("keypair JSON array values must be in 0..255") from e
    return _from_raw(raw)


def _from_json(text: str) -> Keypair:
    obj = json.loads(text)
    if isinstance(obj, list):
        return _from_int_list(obj)
    if isinstance(obj, dict):
        for key in ("secretKey", "secret_key", "secret", "keypair", "privateKey", "private_key"):
            if key in obj:
                val = obj[key]
                if isinstance(val, list):
                    return _from_int_list(val)
                if isinstance(val, str):
                    return _parse_text(val)
        raise ValueError("keypair JSON object has no recognised secret key field")
    if isinstance(obj, str):
        return _parse_text(obj)
    raise ValueError("unsupported keypair JSON value")


def _parse_text(text: str) -> Keypair:
    text = text.strip().strip("\"'").strip()
    if not text:
        raise ValueError("empty keypair string")

    if text[0] in "[{":
        return _from_json(text)

    if len(text) < 4096 and os.path.isfile(text):
        with open(text, "r", encoding="utf-8") as fh:
            return _from_json(fh.read())

    body = text[2:] if text.lower().startswith("0x") else text
    if len(body) in (64, 128) and all(c in _HEX for c in body):
        return _from_raw(bytes.fromhex(body))

    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raw = b""
    if len(raw) in (32, 64):
        try:
            return _from_raw(raw)
        except ValueError:
            pass  # may still be valid base58

    raw = b58decode(text)
    return _from_raw(raw)


@lru_cache(maxsize=64)
def parse_keypair(s: str) -> Keypair:
    """Parse a keypair from any supported encoding. Raises ValueError if unparsable."""
    if s is None:
        raise ValueError("keypair string is None")
    try:
        return _parse_text(str(s))
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid keypair JSON: {e}") from e


# ------------------------------------------------------------------ settings-backed keys

def _load_optional(value: str, env_name: str) -> Keypair | None:
    if not value or not value.strip():
        return None
    try:
        return parse_keypair(value)
    except Exception as e:  # noqa: BLE001 - surface misconfiguration without crashing workers
        log.error("could not parse %s: %s", env_name, e)
        return None


@lru_cache(maxsize=1)
def provider_keypair() -> Keypair | None:
    return _load_optional(settings.provider_keypair_json, "PROVIDER_KEYPAIR_JSON")


@lru_cache(maxsize=1)
def _verifier_keypairs() -> tuple[Keypair, ...]:
    raw = (settings.verifier_keypairs_json or "").strip()
    if not raw:
        return ()

    elements: list[Any]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Not JSON: allow comma / whitespace / semicolon separated encoded strings.
        elements = [p for p in raw.replace(";", ",").replace("\n", ",").split(",") if p.strip()]
        if len(elements) == 1:
            elements = [p for p in raw.split() if p.strip()]
    else:
        if isinstance(parsed, list) and parsed and all(isinstance(v, int) for v in parsed):
            elements = [parsed]  # a single bare int-array keypair
        elif isinstance(parsed, list):
            elements = parsed
        else:
            elements = [parsed]

    out: list[Keypair] = []
    seen: set[str] = set()
    for i, el in enumerate(elements):
        try:
            if isinstance(el, list):
                kp = _from_int_list(el)
            elif isinstance(el, dict):
                kp = _from_json(json.dumps(el))
            elif isinstance(el, str):
                kp = parse_keypair(el)
            else:
                raise ValueError(f"unsupported element type {type(el).__name__}")
        except Exception as e:  # noqa: BLE001
            log.error("could not parse VERIFIER_KEYPAIRS_JSON[%d]: %s", i, e)
            continue
        key = str(kp.pubkey())
        if key in seen:
            continue
        seen.add(key)
        out.append(kp)
    return tuple(out)


def verifier_keypairs() -> list[Keypair]:
    return list(_verifier_keypairs())


@lru_cache(maxsize=1)
def _admin_keypair() -> Keypair | None:
    return _load_optional(settings.admin_keypair_json, "ADMIN_KEYPAIR_JSON")


def admin_keypair() -> Keypair | None:
    """Admin keypair; falls back to the provider keypair when ADMIN_KEYPAIR_JSON is empty."""
    return _admin_keypair() or provider_keypair()


def payer_keypair() -> Keypair | None:
    """Fee payer for permissionless txs: admin, else provider, else first verifier."""
    kp = admin_keypair() or provider_keypair()
    if kp is not None:
        return kp
    verifiers = verifier_keypairs()
    return verifiers[0] if verifiers else None


@lru_cache(maxsize=1)
def _requester_keypair() -> Keypair | None:
    return _load_optional(settings.requester_keypair_json, "REQUESTER_KEYPAIR_JSON")


def requester_keypair() -> Keypair | None:
    """Keypair used to create demo requests from the admin panel.

    Falls back to the fee payer so a dedicated requester is optional.
    """
    return _requester_keypair() or payer_keypair()
