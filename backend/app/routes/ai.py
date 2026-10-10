"""AI explainer endpoint (cosmetic; never used for verification)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.ai import explain_dispute
from app.routes.common import db_dispute
from app.schemas import ExplainDisputeIn, TextOut

router = APIRouter(tags=["ai"])


@router.post("/ai/explain-dispute", response_model=TextOut)
async def explain_dispute_route(body: ExplainDisputeIn) -> TextOut:
    pda = body.request_pda.strip()
    if not body.force:
        try:
            existing = await asyncio.to_thread(db_dispute, pda)
        except Exception:  # noqa: BLE001
            existing = None
        if existing and existing.get("ai_explanation"):
            return TextOut(text=existing["ai_explanation"], cached=True)
    text = await explain_dispute(pda)
    return TextOut(text=text, cached=False)
