"""Rule-set (WASM program) registry."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.audit import append_event
from app.auth import User, get_current_user
from app.db import BUCKET_PROGRAMS, table, upload_blob, upsert
from app.engine.runner import ExecutionError, validate_module
from app.ipfs import pin_bytes
from app.routes.common import call_any, db_program, decorate_program
from app.utils import sha256_hex

log = logging.getLogger("verity.routes.programs")
router = APIRouter(tags=["programs"])

MAX_WASM_BYTES = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 2 * 1024 * 1024


def _parse_json_field(name: str, raw: str | None) -> Any:
    if raw is None or not str(raw).strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"{name} is not valid JSON: {e.msg} (line {e.lineno}, col {e.colno})") from e


def _norm_hash(h: str) -> str:
    h = h.strip().lower().removeprefix("0x")
    if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
        raise HTTPException(400, "program hash must be 64 hex characters")
    return h


@router.get("/programs")
async def list_programs() -> list[dict[str, Any]]:
    rows = await asyncio.to_thread(
        lambda: table("programs").select("*").order("created_at", desc=True).execute().data or []
    )
    return [decorate_program(r) for r in rows]


@router.get("/programs/{program_hash}")
async def get_program(program_hash: str) -> dict[str, Any]:
    h = _norm_hash(program_hash)
    row = await asyncio.to_thread(db_program, h)
    if not row:
        raise HTTPException(404, "program not found")
    usage = await asyncio.to_thread(
        lambda: table("requests").select("request_pda", count="exact").eq("program_hash", h).limit(1).execute()
    )
    out = decorate_program(row) or {}
    out["request_count"] = getattr(usage, "count", None)
    return out


@router.post("/programs", status_code=201)
async def register_program(
    wasm: UploadFile = File(..., description="Compiled rule-set .wasm"),
    source: UploadFile | None = File(default=None, description="Optional source code"),
    name: str = Form(..., min_length=1, max_length=120),
    description: str | None = Form(default=None),
    version: str | None = Form(default=None),
    language: str | None = Form(default=None),
    input_schema: str | None = Form(default=None),
    output_schema: str | None = Form(default=None),
    example_input: str | None = Form(default=None),
    expected_hash: str | None = Form(default=None),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    wasm_bytes = await wasm.read()
    if not wasm_bytes:
        raise HTTPException(400, "wasm file is empty")
    if len(wasm_bytes) > MAX_WASM_BYTES:
        raise HTTPException(413, f"wasm exceeds {MAX_WASM_BYTES // (1024 * 1024)} MiB limit")

    program_hash = sha256_hex(wasm_bytes)
    if expected_hash and expected_hash.strip():
        if _norm_hash(expected_hash) != program_hash:
            raise HTTPException(
                400, f"hash mismatch: browser computed {expected_hash.strip().lower()}, server computed {program_hash}"
            )

    parsed_input_schema = _parse_json_field("input_schema", input_schema)
    parsed_output_schema = _parse_json_field("output_schema", output_schema)
    parsed_example = _parse_json_field("example_input", example_input)

    try:
        module_info = await asyncio.to_thread(validate_module, wasm_bytes)
    except ExecutionError as e:
        raise HTTPException(400, f"invalid rule-set module: {e}") from e

    source_bytes: bytes | None = None
    if source is not None:
        source_bytes = await source.read()
        if len(source_bytes) > MAX_SOURCE_BYTES:
            raise HTTPException(413, "source file too large")
        if not source_bytes:
            source_bytes = None

    wasm_uri = await asyncio.to_thread(
        upload_blob, BUCKET_PROGRAMS, f"{program_hash}.wasm", wasm_bytes, "application/wasm"
    )
    source_uri = None
    if source_bytes:
        source_uri = await asyncio.to_thread(
            upload_blob, BUCKET_PROGRAMS, f"{program_hash}.src.txt", source_bytes, "text/plain; charset=utf-8"
        )

    ipfs_cid = await call_any(pin_bytes, wasm_bytes, f"verity-program-{program_hash}.wasm")

    existing = await asyncio.to_thread(db_program, program_hash)
    row: dict[str, Any] = {
        "program_hash": program_hash,
        "name": name.strip(),
        "wasm_uri": wasm_uri,
        "wasm_size": len(wasm_bytes),
    }
    optional = {
        "description": description,
        "version": version,
        "language": language,
        "input_schema": parsed_input_schema,
        "output_schema": parsed_output_schema,
        "example_input": parsed_example,
        "source_uri": source_uri,
        "ipfs_cid": ipfs_cid,
    }
    row.update({k: v for k, v in optional.items() if v is not None})
    if not existing or not existing.get("created_by"):
        row["created_by"] = user.id
    await asyncio.to_thread(upsert, "programs", row, "program_hash")

    try:
        await asyncio.to_thread(
            append_event,
            "ProgramRegistered",
            {
                "program_hash": program_hash,
                "name": row["name"],
                "version": version,
                "language": language,
                "wasm_uri": wasm_uri,
                "source_uri": source_uri,
                "ipfs_cid": ipfs_cid,
                "wasm_size": len(wasm_bytes),
                "exports": module_info.get("exports") if isinstance(module_info, dict) else None,
                "registered_by": user.id,
                "updated": bool(existing),
            },
            None,
            user.email or user.id,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("audit append failed for ProgramRegistered: %s", e)

    saved = await asyncio.to_thread(db_program, program_hash)
    out = decorate_program(saved or row) or {}
    out["module"] = module_info
    out["already_registered"] = bool(existing)
    return out
