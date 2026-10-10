"""Provider reputation table + verifier set."""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Query

from app.db import table, upsert
from app.routes.common import addr_link, chain_read
from app.utils import utcnow_iso

log = logging.getLogger("verity.routes.providers")
router = APIRouter(tags=["providers"])

_REFRESH_EVERY = 20.0
_last_refresh = {"at": 0.0}
_refresh_lock = asyncio.Lock()


async def _refresh_providers_from_chain(force: bool = False) -> bool:
    if not force and time.time() - _last_refresh["at"] < _REFRESH_EVERY:
        return False
    async with _refresh_lock:
        if not force and time.time() - _last_refresh["at"] < _REFRESH_EVERY:
            return False
        _last_refresh["at"] = time.time()
        chain_providers = await chain_read("list_providers", default=None)
        if not chain_providers:
            return False

        def _write() -> None:
            now = utcnow_iso()
            for p in chain_providers:
                owner = p.get("owner")
                if not owner:
                    continue
                try:
                    upsert("providers", {
                        "pubkey": owner,
                        "stake_lamports": int(p.get("stake") or 0),
                        "completed": int(p.get("completed") or 0),
                        "slashed": int(p.get("slashed") or 0),
                        "active_jobs": int(p.get("active_jobs") or 0),
                        "active": bool(p.get("active", True)),
                        "updated_at": now,
                    }, "pubkey")
                except Exception as e:  # noqa: BLE001
                    log.warning("provider upsert failed for %s: %s", owner, e)

        await asyncio.to_thread(_write)
        return True


def _success_rate(completed: int, slashed: int) -> float | None:
    total = completed + slashed
    return round(completed / total, 4) if total else None


@router.get("/providers")
async def list_providers(refresh: bool = Query(default=False)) -> list[dict[str, Any]]:
    try:
        await _refresh_providers_from_chain(force=refresh)
    except Exception as e:  # noqa: BLE001
        log.warning("provider refresh failed: %s", e)

    rows, req_rows = await asyncio.gather(
        asyncio.to_thread(lambda: table("providers").select("*").execute().data or []),
        asyncio.to_thread(
            lambda: table("requests").select("provider_pubkey,status").not_.is_("provider_pubkey", "null")
            .limit(10000).execute().data or []
        ),
    )
    by_status: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in req_rows:
        by_status[r["provider_pubkey"]][r.get("status") or "unknown"] += 1

    out = []
    for p in rows:
        completed, slashed = int(p.get("completed") or 0), int(p.get("slashed") or 0)
        counts = by_status.get(p["pubkey"], {})
        out.append({
            **p,
            "success_rate": _success_rate(completed, slashed),
            "jobs_by_status": dict(counts),
            "jobs_total": sum(counts.values()),
            "explorer": addr_link(p.get("pubkey")),
        })
    out.sort(key=lambda x: (-(x.get("completed") or 0), x.get("slashed") or 0, x.get("pubkey")))
    return out


@router.get("/verifiers")
async def list_verifiers() -> list[dict[str, Any]]:
    service_keys: list[str] = []
    try:
        from app.chain import keys

        service_keys = [str(k.pubkey()) for k in keys.verifier_keypairs()]
    except Exception as e:  # noqa: BLE001
        log.warning("could not load verifier keypairs: %s", e)

    att_rows = await asyncio.to_thread(
        lambda: table("attestations").select("verifier_pubkey,matches,counted,attested_at").limit(10000)
        .execute().data or []
    )
    stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"attestations": 0, "matches": 0, "mismatches": 0, "counted": 0, "last_attested_at": None}
    )
    for a in att_rows:
        s = stats[a["verifier_pubkey"]]
        s["attestations"] += 1
        s["matches" if a.get("matches") else "mismatches"] += 1
        s["counted"] += 1 if a.get("counted") else 0
        at = a.get("attested_at")
        if at and (s["last_attested_at"] is None or str(at) > str(s["last_attested_at"])):
            s["last_attested_at"] = at

    pubkeys = list(dict.fromkeys(service_keys + list(stats.keys())))[:32]
    records = await asyncio.gather(*(chain_read("get_verifier_record", pk) for pk in pubkeys))

    out = []
    for pk, rec in zip(pubkeys, records):
        out.append({
            "pubkey": pk,
            "service_operated": pk in service_keys,
            "registered": rec is not None,
            "active": bool(rec.get("active")) if rec else False,
            "onchain_attestations": rec.get("attestations") if rec else None,
            "record_pda": rec.get("pda") if rec else None,
            **dict(stats.get(pk, {"attestations": 0, "matches": 0, "mismatches": 0, "counted": 0,
                                  "last_attested_at": None})),
            "explorer": addr_link(pk),
        })
    return out
