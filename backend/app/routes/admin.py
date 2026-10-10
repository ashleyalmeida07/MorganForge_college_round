"""Admin-only endpoints: chaos flags, storage tampering, chain bootstrap, sync, job triggers."""
from __future__ import annotations

import asyncio
import copy
import json
import logging
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Body, Depends, HTTPException

from app.audit import append_event
from app.auth import User, require_admin
from app.chain import indexer
from app.config import settings
from app.db import (
    BUCKET_INPUTS,
    BUCKET_OUTPUTS,
    CHAOS_FLAGS,
    download_blob,
    get_chaos_flags,
    public_url,
    set_chaos_flag,
    upload_blob,
)
from app.routes.common import call_any, chain_or_none, db_receipt, db_request, input_uri_for, output_uri_for, tx_link
from app.schemas import BootstrapIn, ChaosIn, TamperIn
from app.utils import canonical, sha256_hex

log = logging.getLogger("verity.routes.admin")
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

LAMPORTS_PER_SOL = 1_000_000_000


def _audit(event_type: str, payload: dict[str, Any], user: User, request_pda: str | None = None,
           tx_sig: str | None = None) -> None:
    try:
        append_event(event_type, payload, request_pda, user.email or user.id, tx_sig)
    except Exception as e:  # noqa: BLE001
        log.warning("audit append failed for %s: %s", event_type, e)


# ------------------------------------------------------------------ chaos

@router.get("/chaos")
async def get_chaos() -> dict[str, Any]:
    flags = await asyncio.to_thread(get_chaos_flags, 0.0)
    items = [{"name": f, "enabled": bool(flags.get(f, False))} for f in CHAOS_FLAGS]
    return {"flags": flags, "available": CHAOS_FLAGS, "items": items}


@router.post("/chaos")
async def set_chaos(body: ChaosIn, user: User = Depends(require_admin)) -> dict[str, Any]:
    flag = body.flag.strip().upper()
    if flag not in CHAOS_FLAGS:
        raise HTTPException(400, f"unknown chaos flag; expected one of {CHAOS_FLAGS}")
    await asyncio.to_thread(set_chaos_flag, flag, body.enabled)
    await asyncio.to_thread(_audit, "ChaosFlagChanged", {"flag": flag, "enabled": body.enabled, "by": user.id}, user)
    flags = await asyncio.to_thread(get_chaos_flags, 0.0)
    items = [{"name": f, "enabled": bool(flags.get(f, False))} for f in CHAOS_FLAGS]
    return {"flags": flags, "available": CHAOS_FLAGS, "items": items}


# ------------------------------------------------------------------ tamper

def _mutate(obj: Any, path: str = "$") -> tuple[Any, dict[str, Any]]:
    """Deterministically alter one value so the blob's hash changes but it still parses as JSON."""
    if isinstance(obj, bool):
        return (not obj), {"path": path, "before": obj, "after": not obj}
    if isinstance(obj, int):
        return obj + 100_000, {"path": path, "before": obj, "after": obj + 100_000}
    if isinstance(obj, float):
        return obj + 1000.5, {"path": path, "before": obj, "after": obj + 1000.5}
    if isinstance(obj, str):
        return obj + " (tampered)", {"path": path, "before": obj, "after": obj + " (tampered)"}
    if isinstance(obj, list):
        if not obj:
            return ["tampered"], {"path": path, "before": [], "after": ["tampered"]}
        new = list(obj)
        new[0], change = _mutate(new[0], f"{path}[0]")
        return new, change
    if isinstance(obj, dict):
        if not obj:
            return {"tampered": True}, {"path": path, "before": {}, "after": {"tampered": True}}
        keys = sorted(obj.keys())
        numeric = [k for k in keys if isinstance(obj[k], (int, float)) and not isinstance(obj[k], bool)]
        key = numeric[0] if numeric else keys[0]
        new = dict(obj)
        new[key], change = _mutate(obj[key], f"{path}.{key}")
        return new, change
    if obj is None:
        return {"tampered": True}, {"path": path, "before": None, "after": {"tampered": True}}
    return {"tampered": True, "original": str(obj)}, {"path": path, "before": str(obj), "after": "object"}


@router.post("/tamper")
async def tamper(body: TamperIn, user: User = Depends(require_admin)) -> dict[str, Any]:
    pda = body.request_pda.strip()
    row = await asyncio.to_thread(db_request, pda)
    if not row:
        raise HTTPException(404, "request not found in database (sync it first)")

    if body.target == "input":
        uri = row.get("input_uri") or input_uri_for(row["input_hash"])
        expected = row.get("input_hash")
    else:
        receipt = await asyncio.to_thread(db_receipt, pda)
        uri = (receipt or {}).get("output_uri") or output_uri_for(pda)
        expected = (receipt or {}).get("output_hash")

    try:
        original = bytes(await asyncio.to_thread(download_blob, uri))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(404, f"{body.target} blob not found at {uri}: {e}") from e

    try:
        parsed = json.loads(original.decode("utf-8"))
        mutated, change = _mutate(copy.deepcopy(parsed))
        tampered = canonical(mutated)
    except (UnicodeDecodeError, json.JSONDecodeError):
        tampered = original + b" "
        change = {"path": "$", "before": "raw bytes", "after": "raw bytes + trailing space"}
    if tampered == original:
        tampered = original + b"\n"

    bucket, _, path = uri.partition("/")
    if bucket not in (BUCKET_INPUTS, BUCKET_OUTPUTS):
        raise HTTPException(400, f"refusing to tamper with unexpected bucket {bucket!r}")
    await asyncio.to_thread(upload_blob, bucket, path, tampered, "application/json")

    payload = {
        "target": body.target,
        "uri": uri,
        "original_hash": sha256_hex(original),
        "tampered_hash": sha256_hex(tampered),
        "committed_hash": expected,
        "change": change,
        "by": user.id,
    }
    await asyncio.to_thread(_audit, "StorageTampered", payload, user, pda)
    return {**payload, "url": public_url(uri), "request_pda": pda}


# ------------------------------------------------------------------ bootstrap

def _chain_err(e: Exception) -> dict[str, Any]:
    return {
        "error": str(e)[:500],
        "code": getattr(e, "code", None),
        "logs": (getattr(e, "logs", None) or [])[-15:],
    }


@router.post("/bootstrap")
async def bootstrap(body: BootstrapIn | None = Body(default=None), user: User = Depends(require_admin)) -> dict[str, Any]:
    params = body or BootstrapIn()
    chain = chain_or_none()
    if chain is None:
        raise HTTPException(503, "chain client unavailable")
    from app.chain import keys

    steps: list[dict[str, Any]] = []

    async def step(name: str, fn: Callable[[], Awaitable[Any]]) -> Any:
        try:
            result = await fn()
            entry: dict[str, Any] = {"step": name, "ok": True}
            if isinstance(result, str):
                entry.update(tx_sig=result, explorer=tx_link(result))
            elif isinstance(result, dict):
                entry.update(result)
            steps.append(entry)
            return result
        except Exception as e:  # noqa: BLE001
            log.warning("bootstrap step %s failed: %s", name, e)
            steps.append({"step": name, "ok": False, **_chain_err(e)})
            return None

    def skipped(name: str, reason: str) -> None:
        steps.append({"step": name, "ok": True, "skipped": True, "reason": reason})

    try:
        admin = keys.admin_keypair()
        provider = keys.provider_keypair()
        verifiers = keys.verifier_keypairs()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"could not load service keypairs: {e}") from e

    # Optional devnet airdrops for under-funded service keys.
    if params.airdrop and settings.cluster != "mainnet-beta":
        seen: set[str] = set()
        for label, kp in [("admin", admin), ("provider", provider)] + [(f"verifier{i}", v) for i, v in enumerate(verifiers)]:
            if kp is None or str(kp.pubkey()) in seen:
                continue
            seen.add(str(kp.pubkey()))
            bal = await _safe_read(chain.get_balance(kp.pubkey()))
            if bal is None:
                steps.append({"step": f"airdrop:{label}", "ok": False, "error": "could not read balance"})
            elif bal < LAMPORTS_PER_SOL // 2:
                await step(f"airdrop:{label}", lambda kp=kp: chain.airdrop(kp.pubkey(), LAMPORTS_PER_SOL))
            else:
                skipped(f"airdrop:{label}", f"balance {bal} lamports is sufficient")

    # 1. Config
    try:
        config = await chain.get_config()
        config_readable = True
    except Exception as e:  # noqa: BLE001
        config, config_readable = None, False
        steps.append({"step": "read_config", "ok": False, **_chain_err(e)})
    if not config_readable:
        steps.append({"step": "initialize", "ok": False, "error": "skipped: config account could not be read"})
    elif config is None:
        if admin is None:
            steps.append({"step": "initialize", "ok": False, "error": "ADMIN_KEYPAIR_JSON / provider key not set"})
        else:
            await step("initialize", lambda: chain.initialize(
                admin,
                params.min_provider_stake,
                params.min_dispute_stake,
                params.challenge_window_secs,
                params.required_attestations,
            ))
            config = await _safe_read(chain.get_config())
    else:
        skipped("initialize", "config account already exists")

    min_stake = int((config or {}).get("min_provider_stake") or params.min_provider_stake)

    # 2. Provider registration + stake
    if provider is None:
        steps.append({"step": "register_provider", "ok": False, "error": "PROVIDER_KEYPAIR_JSON not set"})
    else:
        owner = provider.pubkey()
        prov = await _safe_read(chain.get_provider(owner))
        if prov is None:
            await step("register_provider", lambda: chain.register_provider(provider))
            prov = await _safe_read(chain.get_provider(owner))
        else:
            skipped("register_provider", "provider account already exists")
        current = int((prov or {}).get("stake") or 0)
        if prov is None:
            steps.append({"step": "stake_provider", "ok": False, "error": "provider account not readable"})
        elif current < min_stake:
            await step(f"stake_provider:{min_stake - current}", lambda: chain.stake_provider(provider, min_stake - current))
        else:
            skipped("stake_provider", f"stake {current} >= minimum {min_stake}")
        try:
            await indexer.sync_provider(str(owner))
        except Exception as e:  # noqa: BLE001
            log.warning("sync_provider failed: %s", e)

    # 3. Verifiers
    if not verifiers:
        steps.append({"step": "register_verifiers", "ok": False, "error": "VERIFIER_KEYPAIRS_JSON not set"})
    elif admin is None:
        steps.append({"step": "register_verifiers", "ok": False, "error": "admin keypair missing"})
    else:
        for i, v in enumerate(verifiers):
            vpk = v.pubkey()
            rec = await _safe_read(chain.get_verifier_record(vpk))
            if rec is None:
                await step(f"register_verifier:{i}:{vpk}", lambda vpk=vpk: chain.register_verifier(admin, vpk))
            elif not rec.get("active"):
                await step(f"activate_verifier:{i}:{vpk}", lambda vpk=vpk: chain.set_verifier_active(admin, vpk, True))
            else:
                skipped(f"register_verifier:{i}:{vpk}", "already registered and active")

    final_config = await _safe_read(chain.get_config())
    ok = all(s.get("ok") for s in steps)
    summary = {
        "ok": ok,
        "steps": [{k: s.get(k) for k in ("step", "ok", "tx_sig", "skipped", "error")} for s in steps],
        "by": user.id,
    }
    await asyncio.to_thread(_audit, "AdminBootstrap", summary, user)
    return {
        "ok": ok,
        "steps": steps,
        "config": final_config,
        "provider_pubkey": str(provider.pubkey()) if provider else None,
        "verifier_pubkeys": [str(v.pubkey()) for v in verifiers],
        "admin_pubkey": str(admin.pubkey()) if admin else None,
    }


async def _safe_read(aw: Awaitable[Any]) -> Any:
    try:
        return await aw
    except Exception as e:  # noqa: BLE001
        log.warning("chain read failed during bootstrap: %s", e)
        return None


# ------------------------------------------------------------------ sync / jobs / workers

@router.post("/sync/{pda}")
async def admin_sync(pda: str, user: User = Depends(require_admin)) -> dict[str, Any]:
    try:
        synced = await indexer.sync_request(pda.strip())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"sync failed: {e}") from e
    if not synced:
        raise HTTPException(404, "request account not found on chain")
    return {"ok": True, "request": synced}


@router.post("/run/{job}")
async def admin_run_job(job: str, user: User = Depends(require_admin)) -> dict[str, Any]:
    try:
        from app.workers.scheduler import run_job_now
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"workers unavailable: {e}") from e
    try:
        result = await call_any(run_job_now, job)
    except (KeyError, ValueError) as e:
        raise HTTPException(
            400, f"unknown job {job!r} (expected provider, verifier, finalizer, indexer or anchor): {e}"
        ) from e
    await asyncio.to_thread(_audit, "AdminJobTriggered", {"job": job, "by": user.id}, user)
    return {"ok": True, "job": job, "result": result}


@router.get("/workers")
async def admin_workers() -> dict[str, Any]:
    try:
        from app.workers.scheduler import worker_status
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": str(e)}
    status = await call_any(worker_status)
    return status if isinstance(status, dict) else {"status": status}
