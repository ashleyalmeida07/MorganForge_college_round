"""Global activity feed, audit-chain verification and platform stats."""
from __future__ import annotations

import asyncio
from collections import Counter
from typing import Any

from fastapi import APIRouter, Query

from app.audit import verify_chain
from app.db import first, table
from app.routes.common import chain_read, decorate_audit_row, tx_link

router = APIRouter(tags=["activity"])


@router.get("/activity")
async def activity(
    limit: int = Query(default=50, ge=1, le=500),
    before_seq: int | None = Query(default=None, description="Pagination cursor: only rows with seq < this"),
    event_type: str | None = Query(default=None),
    request_pda: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    def _q() -> list[dict[str, Any]]:
        q = table("audit_log").select("*")
        if before_seq is not None:
            q = q.lt("seq", before_seq)
        if event_type:
            q = q.eq("event_type", event_type)
        if request_pda:
            q = q.eq("request_pda", request_pda)
        return q.order("seq", desc=True).limit(limit).execute().data or []

    rows = await asyncio.to_thread(_q)
    return [decorate_audit_row(r) for r in rows]


@router.get("/audit/verify")
async def audit_verify() -> dict[str, Any]:
    result, config = await asyncio.gather(asyncio.to_thread(verify_chain), chain_read("get_config"))

    onchain_root = (config or {}).get("latest_audit_root")
    zero_root = "0" * 64
    anchored_row = await asyncio.to_thread(
        lambda: first(
            table("audit_log").select("seq,row_hash,anchored_tx,created_at").not_.is_("anchored_tx", "null")
            .order("seq", desc=True).limit(1).execute()
        )
    )
    root_row = None
    if onchain_root and onchain_root != zero_root:
        root_row = await asyncio.to_thread(
            lambda: first(
                table("audit_log").select("seq,row_hash,anchored_tx,created_at").eq("row_hash", onchain_root)
                .limit(1).execute()
            )
        )

    if not onchain_root or onchain_root == zero_root:
        anchor_status = "not_anchored"
    elif root_row is None:
        anchor_status = "root_not_found_in_db"  # DB rewritten or truncated after anchoring
    else:
        anchor_status = "ok"

    return {
        **result,
        "onchain": {
            "latest_audit_root": onchain_root,
            "audit_root_count": (config or {}).get("audit_root_count"),
            "available": config is not None,
        },
        "anchored_row": (
            {**anchored_row, "explorer": tx_link(anchored_row.get("anchored_tx"))} if anchored_row else None
        ),
        "root_row": ({**root_row, "explorer": tx_link(root_row.get("anchored_tx"))} if root_row else None),
        "anchor_matches": (root_row is not None) if anchor_status != "not_anchored" else None,
        "anchor_status": anchor_status,
        "ok_overall": bool(result.get("ok")) and anchor_status in ("ok", "not_anchored"),
    }


def _count(name: str, col: str, **eq: Any) -> int:
    q = table(name).select(col, count="exact")
    for k, v in eq.items():
        q = q.eq(k, v)
    return getattr(q.limit(1).execute(), "count", None) or 0


@router.get("/stats")
async def stats() -> dict[str, Any]:
    # Exact counts (head-style count queries) so stats stay correct beyond PostgREST's row cap.
    request_statuses = ["Open", "Claimed", "AwaitingVerification", "Disputed", "Verified", "Rejected", "Expired"]
    dispute_statuses = ["Open", "ChallengerWon", "ProviderWon"]
    results = await asyncio.gather(
        asyncio.to_thread(_count, "requests", "request_pda"),
        *(asyncio.to_thread(_count, "requests", "request_pda", status=s) for s in request_statuses),
        asyncio.to_thread(_count, "disputes", "request_pda"),
        *(asyncio.to_thread(_count, "disputes", "request_pda", status=s) for s in dispute_statuses),
        asyncio.to_thread(_count, "programs", "program_hash"),
        asyncio.to_thread(_count, "providers", "pubkey"),
        asyncio.to_thread(_count, "attestations", "id"),
        asyncio.to_thread(_count, "audit_log", "seq"),
    )
    it = iter(results)
    total = next(it)
    counts = {s: next(it) for s in request_statuses}
    disputes_total = next(it)
    disputes_by_status = Counter({s: next(it) for s in dispute_statuses})
    programs, providers, attestations, audit_events = next(it), next(it), next(it), next(it)

    verified, rejected = counts["Verified"], counts["Rejected"]
    decided = verified + rejected
    return {
        "total_requests": total,
        "by_status": counts,
        "verified": verified,
        "verified_pct": round(100.0 * verified / decided, 2) if decided else None,
        "verified_pct_of_total": round(100.0 * verified / total, 2) if total else None,
        "in_flight": counts["Open"] + counts["Claimed"] + counts["AwaitingVerification"] + counts["Disputed"],
        "disputes_total": disputes_total,
        "disputes_by_status": dict(disputes_by_status),
        "disputes_caught": disputes_by_status.get("ChallengerWon", 0),
        "frivolous_disputes": disputes_by_status.get("ProviderWon", 0),
        "rejected": rejected,
        "programs": programs,
        "providers": providers,
        "attestations": attestations,
        "audit_events": audit_events,
    }
