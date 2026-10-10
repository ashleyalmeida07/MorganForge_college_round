"""Pydantic request/response bodies for the Verity HTTP API."""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

_HEX64 = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")


def _norm_hex64(v: str) -> str:
    v = (v or "").strip()
    if not _HEX64.match(v):
        raise ValueError("expected a 32-byte hex string (64 hex chars)")
    return v.lower().removeprefix("0x")


# ------------------------------------------------------------------ auth / wallet

class WalletNonceIn(BaseModel):
    wallet: str = Field(..., min_length=32, max_length=44, description="base58 Solana pubkey")


class WalletNonceOut(BaseModel):
    nonce: str
    message: str
    expires_at: str


class WalletLinkIn(BaseModel):
    wallet: str = Field(..., min_length=32, max_length=44)
    signature: str = Field(..., min_length=40, description="ed25519 signature, base58 or base64")
    nonce: str = Field(..., min_length=8)


# ------------------------------------------------------------------ requests

class PrepareRequestIn(BaseModel):
    program_hash: str
    input: Any = Field(..., description="Arbitrary JSON input; canonicalized server-side")
    requester: str | None = Field(
        default=None, description="Optional requester wallet; enables predicting the request PDA"
    )
    pin_ipfs: bool = True

    @field_validator("program_hash")
    @classmethod
    def check_program_hash(cls, v: str) -> str:
        return _norm_hex64(v)


class PrepareRequestOut(BaseModel):
    program_hash: str
    input_hash: str
    input_uri: str
    input_uri_hash: str
    canonical_input: str
    input_url: str | None = None
    ipfs_cid: str | None = None
    ipfs_url: str | None = None
    program_hash_bytes32: list[int]
    input_hash_bytes32: list[int]
    input_uri_hash_bytes32: list[int]
    program_id: str
    cluster: str
    config_pda: str | None = None
    predicted_request_id: int | None = None
    predicted_request_pda: str | None = None


class ConfirmRequestIn(BaseModel):
    request_pda: str = Field(..., min_length=32, max_length=44)
    tx_sig: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=200)
    input_ipfs_cid: str | None = Field(default=None, max_length=120)


class InputCommitmentIn(BaseModel):
    """Requester-signed proof that this exact (program_hash, input_hash) pair was authorized (§4.4)."""

    request_pda: str = Field(..., min_length=32, max_length=44, description="Predicted request PDA")
    requester: str = Field(..., min_length=32, max_length=44, description="base58 Solana pubkey, the signer")
    program_hash: str
    input_hash: str
    input_uri_hash: str
    signature: str = Field(..., min_length=40, description="ed25519 signature, base58 or base64")

    @field_validator("program_hash", "input_hash", "input_uri_hash")
    @classmethod
    def _check_hex64(cls, v: str) -> str:
        return _norm_hex64(v)


# ------------------------------------------------------------------ disputes

class DisputePrepareIn(BaseModel):
    request_pda: str = Field(..., min_length=32, max_length=44)
    claimed_output_hash: str
    challenger: str | None = Field(default=None, description="Optional challenger wallet for pre-checks")

    @field_validator("claimed_output_hash")
    @classmethod
    def check_claimed_hash(cls, v: str) -> str:
        return _norm_hex64(v)


class DisputePrepareOut(BaseModel):
    program_id: str
    cluster: str
    request_pda: str
    receipt_pda: str
    dispute_pda: str
    config_pda: str
    min_dispute_stake: int | None = None
    claimed_output_hash: str
    claimed_output_hash_bytes32: list[int]
    receipt_output_hash: str | None = None
    request_status: str | None = None
    warnings: list[str] = []


# ------------------------------------------------------------------ admin

class ChaosIn(BaseModel):
    flag: str
    enabled: bool


class TamperIn(BaseModel):
    request_pda: str = Field(..., min_length=32, max_length=44)
    target: Literal["input", "output"]


class BootstrapIn(BaseModel):
    min_provider_stake: int = Field(default=100_000_000, ge=0)
    min_dispute_stake: int = Field(default=50_000_000, ge=0)
    challenge_window_secs: int = Field(default=60, ge=0)
    required_attestations: int = Field(default=2, ge=1, le=255)
    airdrop: bool = Field(default=False, description="Request a devnet airdrop for under-funded keys")


# ------------------------------------------------------------------ ai

class ExplainDisputeIn(BaseModel):
    request_pda: str = Field(..., min_length=32, max_length=44)
    force: bool = False


class TextOut(BaseModel):
    text: str
    cached: bool = False
