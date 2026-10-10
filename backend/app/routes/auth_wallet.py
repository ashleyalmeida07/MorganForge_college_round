"""Sign-In-With-Solana wallet linking + /me."""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import base58
from fastapi import APIRouter, Depends, HTTPException
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from app.audit import append_event
from app.auth import User, get_current_user
from app.db import first, table, upsert
from app.routes.common import addr_link, parse_iso
from app.schemas import WalletLinkIn, WalletNonceIn, WalletNonceOut

log = logging.getLogger("verity.routes.auth")
router = APIRouter(tags=["auth"])

NONCE_TTL = timedelta(minutes=10)


def _decode_pubkey(wallet: str) -> bytes:
    try:
        raw = base58.b58decode(wallet.strip())
    except (ValueError, binascii.Error) as e:
        raise HTTPException(400, "wallet is not valid base58") from e
    if len(raw) != 32:
        raise HTTPException(400, "wallet must be a 32-byte ed25519 public key")
    return raw


def _decode_signature(sig: str) -> bytes:
    sig = sig.strip()
    candidates: list[bytes] = []
    try:
        candidates.append(base58.b58decode(sig))
    except Exception:  # noqa: BLE001
        pass
    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            padded = sig + "=" * (-len(sig) % 4)
            candidates.append(decoder(padded))
        except Exception:  # noqa: BLE001
            pass
    try:
        candidates.append(bytes.fromhex(sig.removeprefix("0x")))
    except ValueError:
        pass
    for c in candidates:
        if len(c) == 64:
            return c
    raise HTTPException(400, "signature must be a 64-byte ed25519 signature (base58, base64 or hex)")


def build_message(wallet: str, nonce: str, issued_at: str) -> str:
    return (
        "Verity wants you to sign in with your Solana account:\n"
        f"{wallet}\n\n"
        "Link this wallet to your Verity account.\n\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}"
    )


def _user_wallets(user_id: str) -> list[dict[str, Any]]:
    rows = table("wallets").select("*").eq("user_id", user_id).order("verified_at").execute().data or []
    return [{**w, "explorer": addr_link(w.get("pubkey"))} for w in rows]


@router.post("/auth/wallet/nonce", response_model=WalletNonceOut)
async def wallet_nonce(body: WalletNonceIn, user: User = Depends(get_current_user)) -> WalletNonceOut:
    wallet = body.wallet.strip()
    _decode_pubkey(wallet)
    now = datetime.now(timezone.utc)
    nonce = secrets.token_urlsafe(18)
    issued_at = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    message = build_message(wallet, nonce, issued_at)
    expires_at = (now + NONCE_TTL).isoformat()
    await asyncio.to_thread(
        lambda: table("wallet_nonces").insert({
            "nonce": nonce,
            "user_id": user.id,
            "wallet": wallet,
            "message": message,
            "expires_at": expires_at,
            "used": False,
        }).execute()
    )
    return WalletNonceOut(nonce=nonce, message=message, expires_at=expires_at)


@router.post("/auth/wallet/link")
async def wallet_link(body: WalletLinkIn, user: User = Depends(get_current_user)) -> dict[str, Any]:
    wallet = body.wallet.strip()
    pubkey_bytes = _decode_pubkey(wallet)
    sig = _decode_signature(body.signature)

    row = await asyncio.to_thread(
        lambda: first(table("wallet_nonces").select("*").eq("nonce", body.nonce).limit(1).execute())
    )
    if not row:
        raise HTTPException(400, "unknown nonce")
    if row.get("used"):
        raise HTTPException(400, "nonce already used")
    if row.get("user_id") != user.id:
        raise HTTPException(403, "nonce was issued to a different user")
    if row.get("wallet") != wallet:
        raise HTTPException(400, "nonce was issued for a different wallet")
    expires = parse_iso(row.get("expires_at"))
    if expires is None or expires < datetime.now(timezone.utc):
        raise HTTPException(400, "nonce expired; request a new one")

    message: str = row["message"]
    try:
        VerifyKey(pubkey_bytes).verify(message.encode("utf-8"), sig)
    except BadSignatureError as e:
        raise HTTPException(401, "signature verification failed") from e

    # Atomically consume the nonce (only flips if still unused).
    consumed = await asyncio.to_thread(
        lambda: table("wallet_nonces").update({"used": True}).eq("nonce", body.nonce).eq("used", False).execute()
    )
    if not (getattr(consumed, "data", None) or []):
        raise HTTPException(400, "nonce already used")

    previous = await asyncio.to_thread(
        lambda: first(table("wallets").select("user_id").eq("pubkey", wallet).limit(1).execute())
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(
        upsert, "wallets", {"user_id": user.id, "pubkey": wallet, "verified_at": now_iso}, "pubkey"
    )

    try:
        await asyncio.to_thread(
            append_event,
            "WalletLinked",
            {
                "user_id": user.id,
                "wallet": wallet,
                "nonce": body.nonce,
                "signature": base58.b58encode(sig).decode(),
                "relinked_from": previous.get("user_id") if previous and previous.get("user_id") != user.id else None,
            },
            None,
            wallet,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("audit append failed for WalletLinked: %s", e)

    wallets = await asyncio.to_thread(_user_wallets, user.id)
    return {"ok": True, "wallet": wallet, "wallets": wallets}


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    profile, wallets = await asyncio.gather(
        asyncio.to_thread(lambda: first(table("profiles").select("*").eq("id", user.id).limit(1).execute())),
        asyncio.to_thread(_user_wallets, user.id),
    )
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "is_admin": user.is_admin,
        "profile": profile,
        "wallets": wallets,
    }
