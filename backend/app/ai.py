"""AI dispute explainer (cosmetic only — never part of the verification path).

Order of preference: Anthropic Messages API -> Groq (OpenAI-compatible) -> deterministic template.
`explain_dispute` never raises.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.config import settings
from app.db import table

log = logging.getLogger("verity.ai")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-5-5"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
HTTP_TIMEOUT = httpx.Timeout(45.0, connect=10.0)
MAX_EVIDENCE_CHARS = 14_000

SYSTEM_PROMPT = (
    "You explain verifiable-computation disputes on the Verity platform to non-technical users. "
    "Verity works like this: a requester commits a WASM rule-set (program_hash) and input (input_hash) on Solana; "
    "a provider runs it and submits a signed receipt with output_hash; independent verifiers re-execute and "
    "attest whether their output hash matches; anyone can open a staked dispute; if a quorum of verifiers "
    "supports the challenger, the provider is slashed, otherwise the challenger loses the stake.\n\n"
    "Use ONLY the evidence JSON you are given. Do not invent numbers. Write a short headline sentence, then "
    "3-6 sentences in plain English explaining what happened and who appears to be right and why "
    "(cite concrete differing fields and values when present), then a 'Key facts' bullet list (max 6 bullets) "
    "with hashes shortened to their first 10 hex characters. Mention that the on-chain verdict, not this "
    "summary, is authoritative. Plain text or light Markdown only."
)


def _short(h: Any, n: int = 10) -> str:
    return f"{str(h)[:n]}…" if h else "n/a"


def _diff(provider_out: Any, honest_out: Any) -> list[dict[str, Any]]:
    if provider_out is None or honest_out is None:
        return []
    if isinstance(provider_out, dict) and isinstance(honest_out, dict):
        diffs = []
        for k in sorted(set(provider_out) | set(honest_out)):
            pv, hv = provider_out.get(k, "<missing>"), honest_out.get(k, "<missing>")
            if pv != hv:
                entry: dict[str, Any] = {"field": k, "provider": pv, "recomputed": hv}
                if isinstance(pv, (int, float)) and isinstance(hv, (int, float)) and not isinstance(pv, bool):
                    entry["delta"] = pv - hv
                diffs.append(entry)
        return diffs
    return [] if provider_out == honest_out else [{"field": "$", "provider": provider_out, "recomputed": honest_out}]


async def _gather_evidence(request_pda: str) -> dict[str, Any] | None:
    from app.routes.common import blob_uris, expected_hashes, fetch_blob, load_bundle, reexecute

    b = await load_bundle(request_pda)
    if b is None:
        return None
    exp, uris = expected_hashes(b), blob_uris(b)
    row, chain_req = b.get("row") or {}, b.get("chain") or {}
    dispute = b.get("chain_dispute") or b.get("dispute") or {}
    db_dispute = b.get("dispute") or {}

    provider_output: Any = None
    provider_blob_hash = None
    if uris.get("output"):
        data, _ = await fetch_blob(uris["output"])
        if data is not None:
            from app.utils import sha256_hex

            provider_blob_hash = sha256_hex(data)
            try:
                provider_output = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                provider_output = data[:500].decode("utf-8", "replace")

    rerun = await reexecute(b)
    honest_output = rerun.get("output")

    attestations = [
        {
            "verifier": _short(a.get("verifier_pubkey"), 8),
            "output_hash": _short(a.get("output_hash")),
            "matches_receipt": a.get("matches"),
            "counted": a.get("counted"),
            "agrees_with_recomputation": (a.get("output_hash") == rerun.get("output_hash"))
            if rerun.get("output_hash") else None,
            "fuel_used": a.get("fuel_used"),
        }
        for a in b.get("attestations") or []
    ]

    program = b.get("program") or {}
    return {
        "request": {
            "pda": request_pda,
            "title": row.get("title"),
            "status": chain_req.get("status") or row.get("status"),
            "program": program.get("name"),
            "program_hash": _short(exp.get("program_hash")),
            "input_hash": _short(exp.get("input_hash")),
            "attest_count_match": chain_req.get("attest_count_match", row.get("attest_count_match")),
            "attest_count_mismatch": chain_req.get("attest_count_mismatch", row.get("attest_count_mismatch")),
        },
        "receipt": {
            "provider": _short(exp.get("provider"), 8),
            "output_hash": _short(exp.get("output_hash")),
            "fuel_used": exp.get("fuel_used"),
            "stored_output_blob_hash": _short(provider_blob_hash),
            "stored_output_matches_receipt": (provider_blob_hash == exp.get("output_hash"))
            if provider_blob_hash and exp.get("output_hash") else None,
        },
        "attestations": attestations,
        "dispute": {
            "status": dispute.get("status"),
            "challenger": _short(dispute.get("challenger") or db_dispute.get("challenger_pubkey"), 8),
            "stake_lamports": dispute.get("stake") or db_dispute.get("stake_lamports"),
            "claimed_output_hash": _short(dispute.get("claimed_output_hash")
                                          or db_dispute.get("claimed_output_hash")),
        } if dispute else None,
        "independent_recomputation": {
            "program_matches_commitment": rerun.get("program_ok"),
            "input_matches_commitment": rerun.get("input_ok"),
            "output_hash": _short(rerun.get("output_hash")),
            "matches_receipt": rerun.get("matches"),
            "fuel_used": rerun.get("fuel_used"),
            "error": rerun.get("error"),
        },
        "provider_output": provider_output,
        "recomputed_output": honest_output,
        "field_differences": _diff(provider_output, honest_output),
    }


def _template(ev: dict[str, Any]) -> str:
    req, rc, rerun = ev["request"], ev["receipt"], ev["independent_recomputation"]
    dispute = ev.get("dispute")
    atts = ev.get("attestations") or []
    n_match = sum(1 for a in atts if a.get("matches_receipt"))
    n_mismatch = sum(1 for a in atts if a.get("matches_receipt") is False)
    diffs = ev.get("field_differences") or []

    if rerun.get("error"):
        headline = "Verity could not independently re-run this computation."
    elif rerun.get("program_matches_commitment") is False:
        headline = "The stored program no longer matches the committed program hash."
    elif rerun.get("input_matches_commitment") is False:
        headline = "The stored input no longer matches the committed input hash."
    elif rerun.get("matches_receipt") is False:
        headline = "The provider's claimed result does not match an independent re-execution."
    elif rerun.get("matches_receipt"):
        headline = "An independent re-execution reproduces the provider's result exactly."
    else:
        headline = "The verification evidence for this request is incomplete."

    lines = [f"**{headline}**", ""]
    body = [
        f"Request {_short(req['pda'], 8)} ({req.get('program') or 'rule set'}) is currently **{req.get('status')}**.",
        f"The provider {rc.get('provider')} submitted a signed receipt claiming output hash {rc.get('output_hash')}.",
        f"{len(atts)} verifier(s) re-executed it: {n_match} agreed with the receipt and {n_mismatch} disagreed.",
    ]
    if diffs:
        parts = []
        for d in diffs[:4]:
            parts.append(f"`{d['field']}` (provider: {json.dumps(d['provider'])}, "
                         f"recomputed: {json.dumps(d['recomputed'])})")
        body.append("The outputs differ at " + "; ".join(parts) + ".")
    if rc.get("stored_output_matches_receipt") is False:
        body.append("The output file in storage has also been modified after the receipt was signed, "
                    "which the on-chain hash exposes.")
    if dispute:
        body.append(
            f"A dispute was opened by {dispute.get('challenger')} staking {dispute.get('stake_lamports')} lamports "
            f"and claiming output {dispute.get('claimed_output_hash')}; its status is {dispute.get('status')}."
        )
        if dispute.get("status") == "ChallengerWon":
            body.append("The verifier quorum sided with the challenger, so the provider was slashed.")
        elif dispute.get("status") == "ProviderWon":
            body.append("The verifier quorum did not support the challenge, so the challenger's stake went to the "
                        "provider.")
    lines.append(" ".join(body))
    lines += [
        "",
        "Key facts:",
        f"- Program hash {req.get('program_hash')}, input hash {req.get('input_hash')}",
        f"- Receipt output hash {rc.get('output_hash')}; server recomputation {rerun.get('output_hash')}",
        f"- Attestations: {n_match} match / {n_mismatch} mismatch",
        "",
        "_This summary was generated from the evidence; the on-chain verdict is authoritative._",
    ]
    return "\n".join(lines)


def _evidence_text(ev: dict[str, Any]) -> str:
    text = json.dumps(ev, indent=1, default=str, ensure_ascii=False)
    if len(text) > MAX_EVIDENCE_CHARS:
        slim = dict(ev)
        slim["provider_output"] = "(omitted: too large; see field_differences)"
        slim["recomputed_output"] = "(omitted: too large; see field_differences)"
        text = json.dumps(slim, indent=1, default=str, ensure_ascii=False)
    return text


async def _ask_anthropic(evidence: str) -> str | None:
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4000,
        "system": SYSTEM_PROMPT,
        "output_config": {"effort": "low"},
        "messages": [{"role": "user", "content": f"Dispute evidence (JSON):\n\n{evidence}"}],
    }
    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=payload)
    if resp.status_code != 200:
        log.warning("anthropic API returned %s: %s", resp.status_code, resp.text[:300])
        return None
    data = resp.json()
    if data.get("stop_reason") == "refusal":
        log.warning("anthropic API declined the request: %s", data.get("stop_details"))
        return None
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    return text or None


async def _ask_groq(evidence: str) -> str | None:
    payload = {
        "model": GROQ_MODEL,
        "temperature": 0.2,
        "max_tokens": 700,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Dispute evidence (JSON):\n\n{evidence}"},
        ],
    }
    headers = {"Authorization": f"Bearer {settings.groq_api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(GROQ_URL, headers=headers, json=payload)
    if resp.status_code != 200:
        log.warning("groq API returned %s: %s", resp.status_code, resp.text[:300])
        return None
    choices = resp.json().get("choices") or []
    text = ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
    return text or None


async def explain_dispute(request_pda: str) -> str:
    try:
        evidence = await _gather_evidence(request_pda)
    except Exception as e:  # noqa: BLE001
        log.exception("evidence gathering failed for %s", request_pda)
        return (f"Verity could not assemble the evidence for request {request_pda} right now ({type(e).__name__}). "
                "The on-chain record remains authoritative; please try again shortly.")
    if evidence is None:
        return f"No request {request_pda} was found in Verity's index or on chain."

    text: str | None = None
    ev_text = _evidence_text(evidence)
    if settings.anthropic_api_key:
        try:
            text = await _ask_anthropic(ev_text)
        except Exception as e:  # noqa: BLE001
            log.warning("anthropic call failed: %s", e)
    if not text and settings.groq_api_key:
        try:
            text = await _ask_groq(ev_text)
        except Exception as e:  # noqa: BLE001
            log.warning("groq call failed: %s", e)
    if not text:
        try:
            text = _template(evidence)
        except Exception as e:  # noqa: BLE001
            log.warning("template explanation failed: %s", e)
            text = ("Verity gathered the evidence but could not summarise it automatically. "
                    "Check the attestations table and timeline; the on-chain verdict is authoritative.")

    try:
        await asyncio.to_thread(
            lambda: table("disputes").update({"ai_explanation": text}).eq("request_pda", request_pda).execute()
        )
    except Exception as e:  # noqa: BLE001
        log.warning("could not store ai_explanation for %s: %s", request_pda, e)
    return text
