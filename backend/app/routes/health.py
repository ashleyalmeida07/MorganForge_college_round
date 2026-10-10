"""GET /health and GET /config."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter

from app.config import settings
from app.db import get_chaos_flags
from app.routes.common import addr_link, call_any, chain_read
from app.utils import utcnow_iso

log = logging.getLogger("verity.routes.health")
router = APIRouter(tags=["meta"])


async def _worker_status() -> dict[str, Any]:
    try:
        from app.workers.scheduler import worker_status
    except Exception as e:  # noqa: BLE001 - workers are optional for the API to boot
        return {"available": False, "error": f"scheduler unavailable: {e}"}
    try:
        status = await call_any(worker_status)
        return status if isinstance(status, dict) else {"status": status}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": str(e)}


@router.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "time": utcnow_iso(),
        "worker_status": await _worker_status(),
        "workers_enabled": settings.workers_enabled,
        "program_id": settings.program_id,
        "cluster": settings.cluster,
    }


@router.get("/config")
async def public_config() -> dict[str, Any]:
    provider_pubkey: str | None = None
    verifier_pubkeys: list[str] = []
    admin_pubkey: str | None = None
    config_pda: str | None = None
    try:
        from app.chain import keys

        kp = keys.provider_keypair()
        provider_pubkey = str(kp.pubkey()) if kp else None
        verifier_pubkeys = [str(k.pubkey()) for k in keys.verifier_keypairs()]
        ak = keys.admin_keypair()
        admin_pubkey = str(ak.pubkey()) if ak else None
    except Exception as e:  # noqa: BLE001
        log.warning("could not load service keypairs: %s", e)
    try:
        from app.chain.client import get_chain

        config_pda = str(get_chain().config_pda())
    except Exception as e:  # noqa: BLE001
        log.warning("could not derive config PDA: %s", e)

    chain_config = await chain_read("get_config")
    try:
        chaos = get_chaos_flags()
    except Exception:  # noqa: BLE001
        chaos = {}

    return {
        "program_id": settings.program_id,
        "program_explorer": addr_link(settings.program_id),
        "cluster": settings.cluster,
        "rpc_url": settings.solana_rpc_url,
        "config_pda": config_pda,
        "config": chain_config,
        "initialized": chain_config is not None,
        "provider_pubkey": provider_pubkey,
        "verifier_pubkeys": verifier_pubkeys,
        "admin_pubkey": admin_pubkey,
        "chaos": chaos,
        "supabase_url": settings.supabase_url,
        "ipfs_gateway": settings.pinata_gateway or None,
        "fuel_limit": settings.fuel_limit,
        "ai_enabled": bool(settings.anthropic_api_key or settings.groq_api_key),
    }
