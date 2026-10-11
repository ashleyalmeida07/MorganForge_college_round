"""Async Solana client for the `verity_core` Anchor program.

There is no IDL, so encoding is manual:
  * instruction data  = sha256("global:<snake_name>")[:8] || borsh(args)
  * account data      = sha256("account:<StructName>")[:8] || borsh(fields)
  * event payloads    = sha256("event:<EventName>")[:8] || borsh(fields), emitted as
                        "Program data: <base64>" log lines.

Account order / flags of every instruction mirror the `#[derive(Accounts)]` structs
in programs/verity_core/programs/verity_core/src/lib.rs exactly.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import logging
import re
import struct
import time
from typing import Any, Awaitable, Callable, Iterable, Sequence

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import MemcmpOpts, TxOpts
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction
from solders.transaction_status import TransactionConfirmationStatus

from app.chain.keys import b58encode
from app.chain.signer import receipt_message
from app.config import settings

log = logging.getLogger(__name__)

# ------------------------------------------------------------------ constants

SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_INSTRUCTIONS_ID = Pubkey.from_string("Sysvar1nstructions1111111111111111111111111")
ED25519_PROGRAM_ID = Pubkey.from_string("Ed25519SigVerify111111111111111111111111111")

PROGRAM_ID = Pubkey.from_string(settings.program_id)

CONFIG_SEED = b"config"
PROVIDER_SEED = b"provider"
VERIFIER_SEED = b"verifier"
REQUEST_SEED = b"request"
RECEIPT_SEED = b"receipt"
ATTESTATION_SEED = b"attestation"
DISPUTE_SEED = b"dispute"

REQUEST_STATUSES = (
    "Open",
    "Claimed",
    "AwaitingVerification",
    "Disputed",
    "Verified",
    "Rejected",
    "Expired",
)
DISPUTE_STATUSES = ("Open", "ChallengerWon", "ProviderWon")

# Request layout: disc(8) id(8) requester(32) program_hash(32) input_hash(32)
# input_uri_hash(32) bounty(8) deadline(8) -> status byte at 160.
REQUEST_STATUS_OFFSET = 8 + 8 + 32 + 32 + 32 + 32 + 8 + 8
# Attestation layout: disc(8) request(32) ...
ATTESTATION_REQUEST_OFFSET = 8

# errors.rs, in declaration order (Anchor custom codes start at 6000).
VERITY_ERRORS = (
    "InvalidParams",
    "MathOverflow",
    "InvalidStatus",
    "DeadlineInPast",
    "DeadlinePassed",
    "DeadlineNotReached",
    "ZeroBounty",
    "ZeroAmount",
    "InsufficientStake",
    "ProviderInactive",
    "ProviderHasActiveJobs",
    "NotAssignedProvider",
    "AccountMismatch",
    "InvalidSignatureInstruction",
    "SignatureMismatch",
    "ProviderCannotAttest",
    "ProviderCannotDispute",
    "ClaimMatchesReceipt",
    "ChallengeWindowOpen",
    "QuorumNotReached",
    "InvalidEvidence",
    "DuplicateVerifier",
    "ProviderAccountRequired",
)
ANCHOR_ERROR_BASE = 6000

SEND_ATTEMPTS = 2
CONFIRM_TIMEOUT_SECS = 90.0
CONFIRM_POLL_SECS = 0.5
MAX_DISPUTE_EVIDENCE_PAIRS = 12

ZERO32 = b"\0" * 32

# ------------------------------------------------------------------ discriminators


def _discriminator(namespace: str, name: str) -> bytes:
    return hashlib.sha256(f"{namespace}:{name}".encode()).digest()[:8]


def ix_discriminator(snake_name: str) -> bytes:
    return _discriminator("global", snake_name)


def account_discriminator(struct_name: str) -> bytes:
    return _discriminator("account", struct_name)


def event_discriminator(event_name: str) -> bytes:
    return _discriminator("event", event_name)


# ------------------------------------------------------------------ borsh schemas

PK = "pubkey"
PK_OPT = "pubkey_opt"  # Pubkey::default() -> None
U8 = "u8"
U32 = "u32"
U64 = "u64"
I64 = "i64"
BOOL = "bool"
B32 = "bytes32"
B64 = "bytes64"
REQUEST_STATUS = ("enum", REQUEST_STATUSES)
DISPUTE_STATUS = ("enum", DISPUTE_STATUSES)

Schema = Sequence[tuple[str, Any]]

ACCOUNT_SCHEMAS: dict[str, Schema] = {
    "Config": [
        ("authority", PK),
        ("min_provider_stake", U64),
        ("min_dispute_stake", U64),
        ("challenge_window_secs", I64),
        ("required_attestations", U8),
        ("request_count", U64),
        ("verifier_count", U32),
        ("latest_audit_root", B32),
        ("audit_root_count", U64),
        ("bump", U8),
    ],
    "Provider": [
        ("owner", PK),
        ("stake", U64),
        ("completed", U32),
        ("slashed", U32),
        ("active_jobs", U32),
        ("active", BOOL),
        ("bump", U8),
    ],
    "VerifierRecord": [
        ("verifier", PK),
        ("active", BOOL),
        ("attestations", U32),
        ("bump", U8),
    ],
    "Request": [
        ("id", U64),
        ("requester", PK),
        ("program_hash", B32),
        ("input_hash", B32),
        ("input_uri_hash", B32),
        ("bounty", U64),
        ("deadline", I64),
        ("status", REQUEST_STATUS),
        ("provider", PK_OPT),
        ("created_at", I64),
        ("receipt_at", I64),
        ("attest_count_match", U8),
        ("attest_count_mismatch", U8),
        ("attest_count_total", U8),
        ("settled", BOOL),
        ("bump", U8),
    ],
    "Receipt": [
        ("request", PK),
        ("provider", PK),
        ("output_hash", B32),
        ("trace_root", B32),
        ("fuel_used", U64),
        ("signature", B64),
        ("submitted_at", I64),
        ("bump", U8),
    ],
    "Attestation": [
        ("request", PK),
        ("verifier", PK),
        ("output_hash", B32),
        ("trace_root", B32),
        ("fuel_used", U64),
        ("matches", BOOL),
        ("counted", BOOL),
        ("attested_at", I64),
        ("bump", U8),
    ],
    "Dispute": [
        ("request", PK),
        ("challenger", PK),
        ("stake", U64),
        ("claimed_output_hash", B32),
        ("status", DISPUTE_STATUS),
        ("opened_at", I64),
        ("resolved_at", I64),
        ("bump", U8),
    ],
}

EVENT_SCHEMAS: dict[str, Schema] = {
    "Initialized": [
        ("authority", PK),
        ("min_provider_stake", U64),
        ("min_dispute_stake", U64),
        ("challenge_window_secs", I64),
        ("required_attestations", U8),
    ],
    "ConfigUpdated": [
        ("min_provider_stake", U64),
        ("min_dispute_stake", U64),
        ("challenge_window_secs", I64),
        ("required_attestations", U8),
    ],
    "VerifierRegistered": [("verifier", PK)],
    "VerifierStatusChanged": [("verifier", PK), ("active", BOOL)],
    "ProviderRegistered": [("provider", PK)],
    "ProviderStaked": [("provider", PK), ("amount", U64), ("total_stake", U64)],
    "ProviderUnstaked": [("provider", PK), ("amount", U64), ("total_stake", U64)],
    "RequestCreated": [
        ("request", PK),
        ("id", U64),
        ("requester", PK),
        ("program_hash", B32),
        ("input_hash", B32),
        ("bounty", U64),
        ("deadline", I64),
    ],
    "RequestClaimed": [("request", PK), ("provider", PK)],
    "ReceiptSubmitted": [
        ("request", PK),
        ("provider", PK),
        ("output_hash", B32),
        ("trace_root", B32),
        ("fuel_used", U64),
    ],
    "Attested": [("request", PK), ("verifier", PK), ("matches", BOOL), ("counted", BOOL)],
    "DisputeOpened": [
        ("request", PK),
        ("challenger", PK),
        ("stake", U64),
        ("claimed_output_hash", B32),
    ],
    "DisputeResolved": [
        ("request", PK),
        ("challenger_won", BOOL),
        ("winner", PK),
        ("slashed", U64),
    ],
    "Finalized": [("request", PK), ("provider", PK), ("bounty", U64)],
    "Expired": [("request", PK), ("refunded", U64)],
    "AuditRootAnchored": [("root", B32), ("index", U64), ("timestamp", I64)],
}

ACCOUNT_DISCRIMINATORS = {name: account_discriminator(name) for name in ACCOUNT_SCHEMAS}
EVENT_BY_DISCRIMINATOR = {event_discriminator(name): name for name in EVENT_SCHEMAS}

_FIXED_INTS = {U8: ("<B", 1), U32: ("<I", 4), U64: ("<Q", 8), I64: ("<q", 8)}


def _take(data: bytes, pos: int, n: int) -> bytes:
    chunk = data[pos : pos + n]
    if len(chunk) != n:
        raise ValueError(f"data too short: need {n} bytes at offset {pos}, have {len(data)}")
    return chunk


def decode_fields(data: bytes, schema: Schema, offset: int = 8) -> dict[str, Any]:
    """Borsh-decode `schema` from `data` starting at `offset` (after the discriminator)."""
    out: dict[str, Any] = {}
    pos = offset
    for name, typ in schema:
        if isinstance(typ, tuple):
            variants = typ[1]
            idx = _take(data, pos, 1)[0]
            pos += 1
            if idx >= len(variants):
                raise ValueError(f"invalid enum index {idx} for field {name}")
            out[name] = variants[idx]
        elif typ in (PK, PK_OPT):
            raw = _take(data, pos, 32)
            pos += 32
            out[name] = None if (typ == PK_OPT and raw == ZERO32) else str(Pubkey.from_bytes(raw))
        elif typ == BOOL:
            out[name] = _take(data, pos, 1)[0] != 0
            pos += 1
        elif typ == B32:
            out[name] = _take(data, pos, 32).hex()
            pos += 32
        elif typ == B64:
            out[name] = _take(data, pos, 64).hex()
            pos += 64
        else:
            fmt, size = _FIXED_INTS[typ]
            (out[name],) = struct.unpack(fmt, _take(data, pos, size))
            pos += size
    return out


def decode_account(struct_name: str, data: bytes, pda: str | Pubkey) -> dict[str, Any]:
    """Decode an Anchor account; raises ValueError on discriminator / layout mismatch."""
    data = bytes(data)
    if data[:8] != ACCOUNT_DISCRIMINATORS[struct_name]:
        raise ValueError(f"account {pda} is not a {struct_name}")
    out = decode_fields(data, ACCOUNT_SCHEMAS[struct_name])
    out["pda"] = str(pda)
    return out


def decode_event(data: bytes) -> tuple[str, dict[str, Any]] | None:
    """Decode an Anchor event payload; returns None if the discriminator is unknown."""
    name = EVENT_BY_DISCRIMINATOR.get(bytes(data[:8]))
    if name is None:
        return None
    return name, decode_fields(bytes(data), EVENT_SCHEMAS[name])


_INVOKE_RE = re.compile(r"^Program (\w+) invoke \[\d+\]")
_EXIT_RE = re.compile(r"^Program (\w+) (success|failed)")
_DATA_PREFIX = "Program data: "


def parse_events_from_logs(logs: Iterable[str], program_id: str) -> list[tuple[str, dict[str, Any]]]:
    """Extract our program's events from transaction logs, tracking the invoke stack."""
    stack: list[str] = []
    events: list[tuple[str, dict[str, Any]]] = []
    for line in logs or []:
        m = _INVOKE_RE.match(line)
        if m:
            stack.append(m.group(1))
            continue
        if _EXIT_RE.match(line):
            if stack:
                stack.pop()
            continue
        if not line.startswith(_DATA_PREFIX):
            continue
        # An empty stack means logs were truncated; rely on the discriminator alone.
        if stack and stack[-1] != program_id:
            continue
        try:
            raw = base64.b64decode(line[len(_DATA_PREFIX) :].strip())
        except (binascii.Error, ValueError):
            continue
        try:
            decoded = decode_event(raw)
        except ValueError as e:
            log.warning("malformed event payload in logs: %s", e)
            continue
        if decoded is not None:
            events.append(decoded)
    return events


# ------------------------------------------------------------------ errors

_ERR_CODE_RE = re.compile(r"Error Code: (\w+)")
_CUSTOM_HEX_RE = re.compile(r"custom program error: 0x([0-9a-fA-F]+)")
_CUSTOM_DEC_RE = re.compile(r"Custom\((\d+)\)")


def _error_name(code: int) -> str | None:
    idx = code - ANCHOR_ERROR_BASE
    if 0 <= idx < len(VERITY_ERRORS):
        return VERITY_ERRORS[idx]
    return None


def parse_error_code(logs: Iterable[str] | None, text: str = "") -> str | None:
    """Best-effort Anchor error name from program logs / error text."""
    lines = [str(line) for line in (logs or [])]
    for line in lines:
        m = _ERR_CODE_RE.search(line)
        if m:
            return m.group(1)
    hay = "\n".join(lines + [text or ""])
    m = _ERR_CODE_RE.search(hay)
    if m:
        return m.group(1)
    for regex, base in ((_CUSTOM_HEX_RE, 16), (_CUSTOM_DEC_RE, 10)):
        for m in regex.finditer(hay):
            name = _error_name(int(m.group(1), base))
            if name:
                return name
    return None


class ChainError(Exception):
    """Failure talking to / executing on chain. `.logs` = program logs, `.code` = Anchor error name."""

    def __init__(
        self,
        message: str,
        logs: Iterable[str] | None = None,
        code: str | None = None,
        signature: str | None = None,
    ) -> None:
        self.message = message
        self.logs: list[str] = [str(line) for line in (logs or [])]
        self.code: str | None = code or parse_error_code(self.logs, message)
        self.signature = signature
        super().__init__(f"{message} [{self.code}]" if self.code else message)


class _BlockhashExpired(Exception):
    def __init__(self, message: str, logs: list[str] | None = None) -> None:
        super().__init__(message)
        self.logs = logs or []


def _error_from_exception(e: BaseException, label: str) -> ChainError:
    if isinstance(e, ChainError):
        return e
    obj = e.args[0] if getattr(e, "args", None) else None
    message: str | None = None
    logs: list[str] = []
    if obj is not None and not isinstance(obj, str):
        message = getattr(obj, "message", None)
        data = getattr(obj, "data", None)
        if data is not None:
            raw_logs = getattr(data, "logs", None)
            if raw_logs:
                logs = [str(line) for line in raw_logs]
            err = getattr(data, "err", None)
            if err is not None:
                message = f"{message or 'transaction simulation failed'}: {err}"
    if not message:
        message = str(e) or e.__class__.__name__
    return ChainError(f"{label}: {message}", logs=logs)


def _is_blockhash_error(text: str) -> bool:
    t = text.lower()
    return any(
        needle in t
        for needle in ("blockhash not found", "blockhashnotfound", "block height exceeded", "transaction expired")
    )


# ------------------------------------------------------------------ conversions


def to_pubkey(value: str | bytes | Pubkey | Keypair) -> Pubkey:
    if isinstance(value, Pubkey):
        return value
    if isinstance(value, Keypair):
        return value.pubkey()
    if isinstance(value, (bytes, bytearray)):
        if len(value) != 32:
            raise ValueError(f"pubkey must be 32 bytes, got {len(value)}")
        return Pubkey.from_bytes(bytes(value))
    if isinstance(value, str):
        return Pubkey.from_string(value.strip())
    raise TypeError(f"unsupported pubkey type {type(value).__name__}")


def _fixed_bytes(value: bytes | str, size: int, name: str) -> bytes:
    if isinstance(value, Signature):
        value = bytes(value)
    if isinstance(value, str):
        value = bytes.fromhex(value.strip().lower().removeprefix("0x"))
    if not isinstance(value, (bytes, bytearray)) or len(value) != size:
        raise ValueError(f"{name} must be {size} bytes")
    return bytes(value)


def _u64(value: int, name: str) -> bytes:
    v = int(value)
    if v < 0 or v >= 1 << 64:
        raise ValueError(f"{name} must fit in u64")
    return struct.pack("<Q", v)


def _i64(value: int, name: str) -> bytes:
    v = int(value)
    if v < -(1 << 63) or v >= 1 << 63:
        raise ValueError(f"{name} must fit in i64")
    return struct.pack("<q", v)


def _u8(value: int, name: str) -> bytes:
    v = int(value)
    if v < 0 or v > 255:
        raise ValueError(f"{name} must fit in u8")
    return struct.pack("<B", v)


def _config_params(
    min_provider_stake: int, min_dispute_stake: int, challenge_window_secs: int, required_attestations: int
) -> bytes:
    return (
        _u64(min_provider_stake, "min_provider_stake")
        + _u64(min_dispute_stake, "min_dispute_stake")
        + _i64(challenge_window_secs, "challenge_window_secs")
        + _u8(required_attestations, "required_attestations")
    )


def _ro(pk: Pubkey) -> AccountMeta:
    return AccountMeta(pubkey=pk, is_signer=False, is_writable=False)


def _rw(pk: Pubkey) -> AccountMeta:
    return AccountMeta(pubkey=pk, is_signer=False, is_writable=True)


def _signer(pk: Pubkey) -> AccountMeta:
    return AccountMeta(pubkey=pk, is_signer=True, is_writable=False)


def _signer_rw(pk: Pubkey) -> AccountMeta:
    return AccountMeta(pubkey=pk, is_signer=True, is_writable=True)


def build_ed25519_instruction(pubkey: bytes, signature: bytes, message: bytes) -> Instruction:
    """Ed25519SigVerify precompile ix with all data inline (instruction index 0xFFFF = self).

    Layout: num_signatures=1, padding=0, then u16 LE offsets
    [sig_offset, sig_ix, pk_offset, pk_ix, msg_offset, msg_size, msg_ix] (16-byte header),
    followed by pubkey(32) || signature(64) || message.
    """
    pubkey = _fixed_bytes(pubkey, 32, "pubkey")
    signature = _fixed_bytes(signature, 64, "signature")
    header_len = 16
    pk_offset = header_len
    sig_offset = pk_offset + 32
    msg_offset = sig_offset + 64
    if msg_offset + len(message) > 0xFFFF:
        raise ValueError("message too long for Ed25519 instruction")
    header = struct.pack(
        "<BB7H", 1, 0, sig_offset, 0xFFFF, pk_offset, 0xFFFF, msg_offset, len(message), 0xFFFF
    )
    return Instruction(ED25519_PROGRAM_ID, header + pubkey + signature + bytes(message), [])


# ------------------------------------------------------------------ PDAs


def _find(seeds: Sequence[bytes]) -> Pubkey:
    return Pubkey.find_program_address(list(seeds), PROGRAM_ID)[0]


def config_pda() -> Pubkey:
    return _find([CONFIG_SEED])


def provider_pda(owner: str | Pubkey) -> Pubkey:
    return _find([PROVIDER_SEED, bytes(to_pubkey(owner))])


def verifier_pda(verifier: str | Pubkey) -> Pubkey:
    return _find([VERIFIER_SEED, bytes(to_pubkey(verifier))])


def request_pda(requester: str | Pubkey, id: int) -> Pubkey:  # noqa: A002 - contract name
    return _find([REQUEST_SEED, bytes(to_pubkey(requester)), _u64(id, "id")])


def receipt_pda(request: str | Pubkey) -> Pubkey:
    return _find([RECEIPT_SEED, bytes(to_pubkey(request))])


def attestation_pda(request: str | Pubkey, verifier: str | Pubkey) -> Pubkey:
    return _find([ATTESTATION_SEED, bytes(to_pubkey(request)), bytes(to_pubkey(verifier))])


def dispute_pda(request: str | Pubkey) -> Pubkey:
    return _find([DISPUTE_SEED, bytes(to_pubkey(request))])


# ------------------------------------------------------------------ client


class ChainClient:
    def __init__(self, rpc_url: str, program_id: str | Pubkey) -> None:
        self.rpc_url = rpc_url
        self.program_id = to_pubkey(program_id)
        self._rpc: AsyncClient | None = None

    # PDA helpers (also available as module-level functions)
    config_pda = staticmethod(config_pda)
    provider_pda = staticmethod(provider_pda)
    verifier_pda = staticmethod(verifier_pda)
    request_pda = staticmethod(request_pda)
    receipt_pda = staticmethod(receipt_pda)
    attestation_pda = staticmethod(attestation_pda)
    dispute_pda = staticmethod(dispute_pda)

    @property
    def rpc(self) -> AsyncClient:
        if self._rpc is None:
            self._rpc = AsyncClient(self.rpc_url, commitment=Confirmed, timeout=30)
        return self._rpc

    async def close(self) -> None:
        if self._rpc is not None:
            try:
                await self._rpc.close()
            finally:
                self._rpc = None

    async def _call(self, what: str, coro: Any) -> Any:
        try:
            return await coro
        except ChainError:
            raise
        except Exception as e:  # noqa: BLE001
            raise _error_from_exception(e, what) from e

    # ------------------------------------------------------------ raw reads

    async def _fetch(self, pk: Pubkey) -> bytes | None:
        resp = await self._call(
            "get_account_info", self.rpc.get_account_info(pk, commitment=Confirmed, encoding="base64")
        )
        acc = resp.value
        if acc is None or acc.owner != self.program_id:
            return None
        return bytes(acc.data)

    async def _get_account(self, struct_name: str, pk: Pubkey) -> dict[str, Any] | None:
        data = await self._fetch(pk)
        if data is None:
            return None
        try:
            return decode_account(struct_name, data, pk)
        except ValueError as e:
            log.warning("could not decode %s at %s: %s", struct_name, pk, e)
            return None

    async def _program_accounts(
        self, struct_name: str, extra_filters: Sequence[MemcmpOpts] = ()
    ) -> list[dict[str, Any]]:
        filters: list[Any] = [MemcmpOpts(offset=0, bytes=b58encode(ACCOUNT_DISCRIMINATORS[struct_name]))]
        filters.extend(extra_filters)
        resp = await self._call(
            "get_program_accounts",
            self.rpc.get_program_accounts(
                self.program_id, commitment=Confirmed, encoding="base64", filters=filters
            ),
        )
        out: list[dict[str, Any]] = []
        for keyed in resp.value or []:
            try:
                out.append(decode_account(struct_name, bytes(keyed.account.data), keyed.pubkey))
            except ValueError as e:
                log.warning("skipping malformed %s account %s: %s", struct_name, keyed.pubkey, e)
        return out

    # ------------------------------------------------------------ typed reads

    async def get_config(self) -> dict[str, Any] | None:
        return await self._get_account("Config", config_pda())

    async def get_provider(self, owner: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("Provider", provider_pda(owner))

    async def get_verifier_record(self, verifier: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("VerifierRecord", verifier_pda(verifier))

    async def get_request(self, request_pda: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("Request", to_pubkey(request_pda))

    async def get_receipt(self, request_pda: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("Receipt", receipt_pda(request_pda))

    async def get_attestation(self, request_pda: str | Pubkey, verifier: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("Attestation", attestation_pda(request_pda, verifier))

    async def get_dispute(self, request_pda: str | Pubkey) -> dict[str, Any] | None:
        return await self._get_account("Dispute", dispute_pda(request_pda))

    async def list_attestations(self, request_pda: str | Pubkey) -> list[dict[str, Any]]:
        req = to_pubkey(request_pda)
        rows = await self._program_accounts(
            "Attestation", [MemcmpOpts(offset=ATTESTATION_REQUEST_OFFSET, bytes=str(req))]
        )
        rows.sort(key=lambda a: (a["attested_at"], a["verifier"]))
        return rows

    async def list_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        extra: list[MemcmpOpts] = []
        if status is not None:
            if status not in REQUEST_STATUSES:
                raise ValueError(f"unknown request status {status!r}")
            idx = REQUEST_STATUSES.index(status)
            extra.append(MemcmpOpts(offset=REQUEST_STATUS_OFFSET, bytes=b58encode(bytes([idx]))))
        rows = await self._program_accounts("Request", extra)
        rows.sort(key=lambda r: (r["created_at"], r["id"]))
        return rows

    async def list_providers(self) -> list[dict[str, Any]]:
        rows = await self._program_accounts("Provider")
        rows.sort(key=lambda p: p["owner"])
        return rows

    async def list_verifiers(self) -> list[dict[str, Any]]:
        rows = await self._program_accounts("VerifierRecord")
        rows.sort(key=lambda v: v["verifier"])
        return rows

    async def get_balance(self, pubkey: str | Pubkey) -> int:
        resp = await self._call("get_balance", self.rpc.get_balance(to_pubkey(pubkey), commitment=Confirmed))
        return int(resp.value)

    async def airdrop(self, pubkey: str | Pubkey, lamports: int) -> str:
        bh = await self._call("get_latest_blockhash", self.rpc.get_latest_blockhash(Confirmed))
        resp = await self._call(
            "request_airdrop",
            self.rpc.request_airdrop(to_pubkey(pubkey), int(lamports), commitment=Confirmed),
        )
        sig = getattr(resp, "value", None)
        if not isinstance(sig, Signature):
            raise ChainError(f"request_airdrop: unexpected response: {resp}")
        try:
            await self._confirm(sig, bh.value.last_valid_block_height, "airdrop")
        except _BlockhashExpired as e:
            raise ChainError(str(e), signature=str(sig)) from e
        return str(sig)

    # ------------------------------------------------------------ events / history

    async def get_signatures_for_program(
        self, until: str | None = None, limit: int = 100, before: str | None = None
    ) -> list[dict[str, Any]]:
        """One page of program signatures, newest-first. `before` enables pagination."""
        resp = await self._call(
            "get_signatures_for_address",
            self.rpc.get_signatures_for_address(
                self.program_id,
                before=Signature.from_string(before) if before else None,
                until=Signature.from_string(until) if until else None,
                limit=max(1, min(int(limit), 1000)),
                commitment=Confirmed,
            ),
        )
        return [
            {
                "signature": str(s.signature),
                "slot": int(s.slot),
                "block_time": s.block_time,
                "err": None if s.err is None else str(s.err),
            }
            for s in (resp.value or [])
        ]

    async def _get_transaction(self, sig: Signature) -> Any:
        resp = await self._call(
            "get_transaction",
            self.rpc.get_transaction(
                sig, encoding="json", commitment=Confirmed, max_supported_transaction_version=0
            ),
        )
        return resp.value

    async def get_transaction_events(self, sig: str, require: bool = False) -> list[dict[str, Any]]:
        """Decoded events our program emitted in `sig`. With require=True a missing tx raises ChainError."""
        tx = await self._get_transaction(Signature.from_string(sig))
        if tx is None:
            if require:
                raise ChainError(f"transaction {sig} not found", signature=sig)
            return []
        meta = tx.transaction.meta
        logs = list(meta.log_messages or []) if meta is not None else []
        return [
            {"name": name, "data": data, "slot": int(tx.slot), "block_time": tx.block_time}
            for name, data in parse_events_from_logs(logs, str(self.program_id))
        ]

    async def _transaction_logs(self, sig: Signature) -> list[str]:
        try:
            tx = await self._get_transaction(sig)
        except ChainError as e:
            log.debug("could not fetch logs for %s: %s", sig, e)
            return []
        if tx is None or tx.transaction.meta is None:
            return []
        return list(tx.transaction.meta.log_messages or [])

    # ------------------------------------------------------------ sending

    def _ix(self, name: str, accounts: list[AccountMeta], args: bytes = b"") -> Instruction:
        return Instruction(self.program_id, ix_discriminator(name) + args, accounts)

    @staticmethod
    def _signers_for(msg: Message, keypairs: Iterable[Keypair], label: str) -> list[Keypair]:
        by_key: dict[Pubkey, Keypair] = {}
        for kp in keypairs:
            by_key.setdefault(kp.pubkey(), kp)
        required = list(msg.account_keys[: msg.header.num_required_signatures])
        missing = [str(k) for k in required if k not in by_key]
        if missing:
            raise ChainError(f"{label}: missing signer(s): {', '.join(missing)}")
        return [by_key[k] for k in required]

    async def _signature_status(self, sig: Signature) -> Any:
        try:
            resp = await self.rpc.get_signature_statuses([sig])
        except Exception as e:  # noqa: BLE001 - transient; keep polling
            log.debug("get_signature_statuses(%s) failed: %s", sig, e)
            return None
        values = resp.value or []
        return values[0] if values else None

    @staticmethod
    def _is_confirmed(status: Any) -> bool:
        cs = status.confirmation_status
        if cs is None:
            return status.confirmations is None
        return cs in (TransactionConfirmationStatus.Confirmed, TransactionConfirmationStatus.Finalized)

    async def _check_status(self, sig: Signature, label: str) -> bool:
        status = await self._signature_status(sig)
        if status is None:
            return False
        if status.err is not None:
            logs = await self._transaction_logs(sig)
            raise ChainError(f"{label}: transaction failed: {status.err}", logs=logs, signature=str(sig))
        return self._is_confirmed(status)

    async def _confirm(self, sig: Signature, last_valid_block_height: int, label: str) -> None:
        deadline = time.monotonic() + CONFIRM_TIMEOUT_SECS
        polls = 0
        while True:
            if await self._check_status(sig, label):
                return
            polls += 1
            if polls % 4 == 0:
                try:
                    height = (await self.rpc.get_block_height(Confirmed)).value
                except Exception as e:  # noqa: BLE001
                    log.debug("get_block_height failed: %s", e)
                    height = None
                if height is not None and height > last_valid_block_height:
                    if await self._check_status(sig, label):
                        return
                    raise _BlockhashExpired(f"{label}: blockhash expired before confirmation ({sig})")
            if time.monotonic() > deadline:
                raise ChainError(f"{label}: confirmation timed out", signature=str(sig))
            await asyncio.sleep(CONFIRM_POLL_SECS)

    async def _send_once(
        self,
        label: str,
        ixs: list[Instruction],
        payer: Keypair,
        signers: Sequence[Keypair],
        skip_preflight: bool = False,
    ) -> str:
        bh_resp = await self._call(f"{label}: get_latest_blockhash", self.rpc.get_latest_blockhash(Confirmed))
        blockhash = bh_resp.value.blockhash
        last_valid = bh_resp.value.last_valid_block_height
        msg = Message.new_with_blockhash(ixs, payer.pubkey(), blockhash)
        tx = Transaction(self._signers_for(msg, [payer, *signers], label), msg, blockhash)
        try:
            resp = await self.rpc.send_raw_transaction(
                bytes(tx),
                opts=TxOpts(skip_confirmation=True, skip_preflight=skip_preflight, preflight_commitment=Confirmed),
            )
        except Exception as e:  # noqa: BLE001
            err = _error_from_exception(e, label)
            if _is_blockhash_error(str(err) + "\n" + "\n".join(err.logs)):
                raise _BlockhashExpired(str(err), err.logs) from e
            log.warning("%s failed: %s", label, err)
            raise err from e
        sig = getattr(resp, "value", None)
        if not isinstance(sig, Signature):
            raise ChainError(f"{label}: unexpected send response: {resp}")
        await self._confirm(sig, last_valid, label)
        log.info("%s confirmed: %s", label, sig)
        return str(sig)

    async def _send(
        self,
        label: str,
        ixs: list[Instruction],
        payer: Keypair,
        signers: Sequence[Keypair] = (),
        skip_preflight: bool = False,
    ) -> str:
        """Send and confirm. With skip_preflight a failing tx still lands on chain, so the
        raised ChainError carries its signature (an explorer link to the rejection)."""
        last: _BlockhashExpired | None = None
        for attempt in range(1, SEND_ATTEMPTS + 1):
            try:
                return await self._send_once(label, ixs, payer, signers, skip_preflight)
            except _BlockhashExpired as e:
                last = e
                log.warning("%s: blockhash expired (attempt %d/%d)", label, attempt, SEND_ATTEMPTS)
        assert last is not None
        raise ChainError(str(last), logs=last.logs)

    async def _require_request(self, request: Pubkey, label: str) -> dict[str, Any]:
        req = await self.get_request(request)
        if req is None:
            raise ChainError(f"{label}: request {request} not found", code="AccountNotFound")
        return req

    # ------------------------------------------------------------ admin writes

    async def initialize(
        self,
        admin_kp: Keypair,
        min_provider_stake: int,
        min_dispute_stake: int,
        challenge_window_secs: int,
        required_attestations: int,
    ) -> str:
        args = _config_params(min_provider_stake, min_dispute_stake, challenge_window_secs, required_attestations)
        ix = self._ix(
            "initialize",
            [_rw(config_pda()), _signer_rw(admin_kp.pubkey()), _ro(SYSTEM_PROGRAM_ID)],
            args,
        )
        return await self._send("initialize", [ix], admin_kp)

    async def update_config(
        self,
        admin_kp: Keypair,
        min_provider_stake: int,
        min_dispute_stake: int,
        challenge_window_secs: int,
        required_attestations: int,
    ) -> str:
        args = _config_params(min_provider_stake, min_dispute_stake, challenge_window_secs, required_attestations)
        ix = self._ix("update_config", [_rw(config_pda()), _signer(admin_kp.pubkey())], args)
        return await self._send("update_config", [ix], admin_kp)

    async def register_verifier(self, admin_kp: Keypair, verifier: str | Pubkey) -> str:
        v = to_pubkey(verifier)
        ix = self._ix(
            "register_verifier",
            [
                _rw(config_pda()),
                _rw(verifier_pda(v)),
                _signer_rw(admin_kp.pubkey()),
                _ro(SYSTEM_PROGRAM_ID),
            ],
            bytes(v),
        )
        return await self._send("register_verifier", [ix], admin_kp)

    async def set_verifier_active(self, admin_kp: Keypair, verifier: str | Pubkey, active: bool) -> str:
        ix = self._ix(
            "set_verifier_active",
            [_ro(config_pda()), _rw(verifier_pda(verifier)), _signer(admin_kp.pubkey())],
            bytes([1 if active else 0]),
        )
        return await self._send("set_verifier_active", [ix], admin_kp)

    async def anchor_audit_root(self, admin_kp: Keypair, root: bytes) -> str:
        ix = self._ix(
            "anchor_audit_root",
            [_rw(config_pda()), _signer(admin_kp.pubkey())],
            _fixed_bytes(root, 32, "root"),
        )
        return await self._send("anchor_audit_root", [ix], admin_kp)

    # ------------------------------------------------------------ provider writes

    async def register_provider(self, owner_kp: Keypair) -> str:
        owner = owner_kp.pubkey()
        ix = self._ix(
            "register_provider",
            [_rw(provider_pda(owner)), _signer_rw(owner), _ro(SYSTEM_PROGRAM_ID)],
        )
        return await self._send("register_provider", [ix], owner_kp)

    async def stake_provider(self, owner_kp: Keypair, amount: int) -> str:
        owner = owner_kp.pubkey()
        ix = self._ix(
            "stake_provider",
            [_rw(provider_pda(owner)), _signer_rw(owner), _ro(SYSTEM_PROGRAM_ID)],
            _u64(amount, "amount"),
        )
        return await self._send("stake_provider", [ix], owner_kp)

    async def unstake_provider(self, owner_kp: Keypair, amount: int) -> str:
        owner = owner_kp.pubkey()
        ix = self._ix(
            "unstake_provider",
            [_rw(provider_pda(owner)), _signer_rw(owner)],
            _u64(amount, "amount"),
        )
        return await self._send("unstake_provider", [ix], owner_kp)

    # ------------------------------------------------------------ request lifecycle

    async def create_request(
        self,
        requester_kp: Keypair,
        program_hash: bytes,
        input_hash: bytes,
        input_uri_hash: bytes,
        bounty: int,
        deadline: int,
        before_send: Callable[[str], Awaitable[None]] | None = None,
    ) -> tuple[str, str]:
        """`before_send(request_pda)` runs right before the tx is sent (e.g. to store the input commitment)."""
        args = (
            _fixed_bytes(program_hash, 32, "program_hash")
            + _fixed_bytes(input_hash, 32, "input_hash")
            + _fixed_bytes(input_uri_hash, 32, "input_uri_hash")
            + _u64(bounty, "bounty")
            + _i64(deadline, "deadline")
        )
        requester = requester_kp.pubkey()
        for attempt in range(2):
            cfg = await self.get_config()
            if cfg is None:
                raise ChainError("create_request: config account not initialized", code="AccountNotInitialized")
            req = request_pda(requester, int(cfg["request_count"]))
            ix = self._ix(
                "create_request",
                [_rw(config_pda()), _rw(req), _signer_rw(requester), _ro(SYSTEM_PROGRAM_ID)],
                args,
            )
            if before_send is not None:
                await before_send(str(req))
            try:
                sig = await self._send("create_request", [ix], requester_kp)
                return sig, str(req)
            except ChainError as e:
                # Another request bumped config.request_count between read and send.
                if attempt == 0 and e.code == "ConstraintSeeds":
                    log.warning("create_request: request_count raced, retrying with fresh config")
                    continue
                raise
        raise ChainError("create_request: could not derive a fresh request PDA")

    async def claim_request(self, provider_kp: Keypair, request_pda: str | Pubkey) -> str:
        owner = provider_kp.pubkey()
        ix = self._ix(
            "claim_request",
            [_ro(config_pda()), _rw(to_pubkey(request_pda)), _rw(provider_pda(owner)), _signer(owner)],
        )
        return await self._send("claim_request", [ix], provider_kp)

    async def submit_receipt(
        self,
        provider_kp: Keypair,
        request_pda: str | Pubkey,
        output_hash: bytes,
        trace_root: bytes,
        fuel_used: int,
        signature: bytes,
    ) -> str:
        req_pk = to_pubkey(request_pda)
        out_h = _fixed_bytes(output_hash, 32, "output_hash")
        trace = _fixed_bytes(trace_root, 32, "trace_root")
        sig = _fixed_bytes(signature, 64, "signature")
        req = await self._require_request(req_pk, "submit_receipt")
        msg = receipt_message(
            req_pk,
            bytes.fromhex(req["program_hash"]),
            bytes.fromhex(req["input_hash"]),
            out_h,
            trace,
            int(fuel_used),
        )
        owner = provider_kp.pubkey()
        ed_ix = build_ed25519_instruction(bytes(owner), sig, msg)
        ix = self._ix(
            "submit_receipt",
            [
                _rw(req_pk),
                _rw(receipt_pda(req_pk)),
                _signer_rw(owner),
                _ro(SYSVAR_INSTRUCTIONS_ID),
                _ro(SYSTEM_PROGRAM_ID),
            ],
            out_h + trace + _u64(fuel_used, "fuel_used") + sig,
        )
        # The Ed25519 ix must sit immediately before submit_receipt.
        return await self._send("submit_receipt", [ed_ix, ix], provider_kp)

    async def attest(
        self,
        verifier_kp: Keypair,
        request_pda: str | Pubkey,
        output_hash: bytes,
        trace_root: bytes,
        fuel_used: int,
    ) -> str:
        req_pk = to_pubkey(request_pda)
        verifier = verifier_kp.pubkey()
        record = verifier_pda(verifier)
        # Optional account: pass the record only if it exists, else the program id (Anchor's None).
        record_meta = _rw(record) if await self._fetch(record) is not None else _ro(self.program_id)
        ix = self._ix(
            "attest",
            [
                _rw(req_pk),
                _ro(receipt_pda(req_pk)),
                _rw(attestation_pda(req_pk, verifier)),
                record_meta,
                _signer_rw(verifier),
                _ro(SYSTEM_PROGRAM_ID),
            ],
            _fixed_bytes(output_hash, 32, "output_hash")
            + _fixed_bytes(trace_root, 32, "trace_root")
            + _u64(fuel_used, "fuel_used"),
        )
        return await self._send("attest", [ix], verifier_kp)

    async def open_dispute(
        self, challenger_kp: Keypair, request_pda: str | Pubkey, claimed_output_hash: bytes
    ) -> str:
        req_pk = to_pubkey(request_pda)
        challenger = challenger_kp.pubkey()
        ix = self._ix(
            "open_dispute",
            [
                _ro(config_pda()),
                _rw(req_pk),
                _ro(receipt_pda(req_pk)),
                _rw(dispute_pda(req_pk)),
                _signer_rw(challenger),
                _ro(SYSTEM_PROGRAM_ID),
            ],
            _fixed_bytes(claimed_output_hash, 32, "claimed_output_hash"),
        )
        return await self._send("open_dispute", [ix], challenger_kp)

    async def resolve_dispute(self, payer_kp: Keypair, request_pda: str | Pubkey) -> str:
        """Permissionless. Supplies as evidence every counted mismatch attestation whose
        output hash equals the dispute's claimed output (remaining accounts:
        (attestation PDA, verifier wallet [writable]) pairs)."""
        req_pk = to_pubkey(request_pda)
        req = await self._require_request(req_pk, "resolve_dispute")
        dispute = await self.get_dispute(req_pk)
        if dispute is None:
            raise ChainError(f"resolve_dispute: no dispute for {req_pk}", code="AccountNotFound")
        if not req["provider"]:
            raise ChainError(f"resolve_dispute: request {req_pk} has no provider", code="AccountMismatch")
        provider_owner = to_pubkey(req["provider"])

        evidence: list[AccountMeta] = []
        seen: set[str] = set()
        for att in await self.list_attestations(req_pk):
            if not att["counted"] or att["matches"] or att["output_hash"] != dispute["claimed_output_hash"]:
                continue
            if att["verifier"] in seen:
                continue
            seen.add(att["verifier"])
            evidence.append(_ro(to_pubkey(att["pda"])))
            evidence.append(_rw(to_pubkey(att["verifier"])))
            if len(seen) >= MAX_DISPUTE_EVIDENCE_PAIRS:
                break

        ix = self._ix(
            "resolve_dispute",
            [
                _ro(config_pda()),
                _rw(req_pk),
                _rw(dispute_pda(req_pk)),
                _rw(provider_pda(provider_owner)),
                _rw(provider_owner),
                _rw(to_pubkey(dispute["challenger"])),
                *evidence,
            ],
        )
        return await self._send("resolve_dispute", [ix], payer_kp)

    async def finalize(self, payer_kp: Keypair, request_pda: str | Pubkey) -> str:
        req_pk = to_pubkey(request_pda)
        req = await self._require_request(req_pk, "finalize")
        if not req["provider"]:
            raise ChainError(f"finalize: request {req_pk} has no provider", code="AccountMismatch")
        provider_owner = to_pubkey(req["provider"])
        ix = self._ix(
            "finalize",
            [_ro(config_pda()), _rw(req_pk), _rw(provider_pda(provider_owner)), _rw(provider_owner)],
        )
        return await self._send("finalize", [ix], payer_kp)

    async def expire_request(self, payer_kp: Keypair, request_pda: str | Pubkey) -> str:
        req_pk = to_pubkey(request_pda)
        req = await self._require_request(req_pk, "expire_request")
        # Optional provider account: required only for Claimed requests; None = program id.
        if req["status"] == "Claimed" and req["provider"]:
            provider_meta = _rw(provider_pda(req["provider"]))
        else:
            provider_meta = _ro(self.program_id)
        ix = self._ix(
            "expire_request",
            [_rw(req_pk), _rw(to_pubkey(req["requester"])), provider_meta],
        )
        return await self._send("expire_request", [ix], payer_kp)


_chain: ChainClient | None = None


def get_chain() -> ChainClient:
    global _chain
    if _chain is None:
        _chain = ChainClient(settings.solana_rpc_url, settings.program_id)
    return _chain
