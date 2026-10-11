"""Helpers shared by the provider / verifier / finalizer workers.

- blob loading (program WASM with a verified-only LRU cache, inputs never cached)
- deterministic tamper helper used by the chaos flags
- thread offloading
- per-job status registry (consumed by scheduler.worker_status())
- simple per-key exponential backoff so failing items don't spam every tick
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import logging
import threading
import time
from collections import OrderedDict, deque
from typing import Any, Callable

from app.db import BUCKET_INPUTS, BUCKET_PROGRAMS, download_blob, table, upload_blob, upsert
from app.utils import canonical, sha256_hex, utcnow_iso

logger = logging.getLogger("verity.workers")

TAMPER_DELTA = 100_000
_PROGRAM_CACHE_SIZE = 32


# ---------------------------------------------------------------- storage URIs


def program_uri(program_hash_hex: str) -> str:
    return f"{BUCKET_PROGRAMS}/{program_hash_hex.lower()}.wasm"


def input_uri(input_hash_hex: str) -> str:
    return f"{BUCKET_INPUTS}/{input_hash_hex.lower()}.json"


def _as_bytes(data: Any) -> bytes:
    if isinstance(data, (bytes, bytearray, memoryview)):
        return bytes(data)
    if isinstance(data, str):
        return data.encode("utf-8")
    raise TypeError(f"unexpected blob payload type {type(data).__name__}")


# ---------------------------------------------------------------- program cache

_program_cache: "OrderedDict[str, bytes]" = OrderedDict()
_program_lock = threading.Lock()


def load_program_wasm(program_hash_hex: str) -> bytes:
    """Return the WASM bytes stored at `programs/{hash}.wasm`.

    Only bytes whose sha256 equals the requested hash are cached; a mismatching
    blob is returned uncached so the caller's hash check detects the tamper.
    """
    key = program_hash_hex.lower()
    with _program_lock:
        cached = _program_cache.get(key)
        if cached is not None:
            _program_cache.move_to_end(key)
            return cached
    data = _as_bytes(download_blob(program_uri(key)))
    if sha256_hex(data) == key:
        with _program_lock:
            _program_cache[key] = data
            _program_cache.move_to_end(key)
            while len(_program_cache) > _PROGRAM_CACHE_SIZE:
                _program_cache.popitem(last=False)
    return data


def clear_program_cache() -> None:
    with _program_lock:
        _program_cache.clear()


def load_input(input_hash_hex: str) -> bytes:
    """Return the raw input blob at `inputs/{hash}.json` (never cached)."""
    return _as_bytes(download_blob(input_uri(input_hash_hex)))


def owned_request_pdas(pdas: list[str]) -> set[str]:
    """The requests created through this deployment: those with a requester input commitment in our DB.

    Several backends (local + Render, each with its own database and storage) can serve the same
    devnet program. Another deployment's request has its blobs in that deployment's storage, so
    this one must neither claim nor verify it. The commitment row is written before
    `create_request` is sent, so a request of ours is never missed.
    """
    owned: set[str] = set()
    unique = list(dict.fromkeys(pdas))
    for i in range(0, len(unique), 100):
        rows = (
            table("input_commitments").select("request_pda").in_("request_pda", unique[i : i + 100]).execute().data
            or []
        )
        owned.update(r["request_pda"] for r in rows)
    return owned


def pick_other_program(exclude_hash_hex: str) -> str | None:
    """Return the hash of some registered program other than `exclude_hash_hex`."""
    try:
        rows = (
            table("programs")
            .select("program_hash")
            .neq("program_hash", exclude_hash_hex.lower())
            .order("created_at")
            .limit(20)
            .execute()
            .data
            or []
        )
    except Exception as e:
        logger.warning("could not list programs for swap: %s", e)
        return None
    hashes = [r["program_hash"] for r in rows if r.get("program_hash")]
    if not hashes:
        return None
    # deterministic but rotating choice
    return hashes[int(time.time()) % len(hashes)]


# ---------------------------------------------------------------- tampering


def _bump_first_int(node: Any) -> tuple[Any, bool]:
    if isinstance(node, bool):
        return node, False
    if isinstance(node, int):
        return node + TAMPER_DELTA, True
    if isinstance(node, dict):
        for k in sorted(node.keys(), key=str):
            new, done = _bump_first_int(node[k])
            if done:
                node[k] = new
                return node, True
        return node, False
    if isinstance(node, list):
        for i, v in enumerate(node):
            new, done = _bump_first_int(v)
            if done:
                node[i] = new
                return node, True
        return node, False
    return node, False


def tamper_output(obj: Any) -> Any:
    """Deterministically corrupt a JSON value (returns a modified deep copy).

    Adds 100000 to the first integer found (depth-first, sorted keys); if there is
    no integer, appends a `_tampered` marker.
    """
    out = copy.deepcopy(obj)
    out, done = _bump_first_int(out)
    if done:
        return out
    if isinstance(out, dict):
        out["_tampered"] = True
        return out
    if isinstance(out, list):
        out.append({"_tampered": True})
        return out
    return {"value": out, "_tampered": True}


def tamper_stored_input(input_hash_hex: str) -> str:
    """Simulate an attacker overwriting an input blob in storage. Returns new sha256 hex."""
    import json

    original = load_input(input_hash_hex)
    try:
        obj = json.loads(original.decode("utf-8"))
    except Exception:
        obj = {"raw": original.decode("utf-8", errors="replace")}
    tampered = canonical(tamper_output(obj))
    upload_blob(BUCKET_INPUTS, f"{input_hash_hex.lower()}.json", tampered, "application/json")
    return sha256_hex(tampered)


# ---------------------------------------------------------------- async helpers


async def run_in_thread(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    return await asyncio.to_thread(fn, *args, **kwargs)


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def safe_append_event(
    event_type: str,
    payload: dict[str, Any],
    request_pda: str | None = None,
    actor: str | None = None,
    tx_sig: str | None = None,
) -> None:
    """append_event that never raises (audit failures must not break workers)."""
    from app.audit import append_event

    try:
        await run_in_thread(append_event, event_type, payload, request_pda, actor, tx_sig)
    except Exception as e:
        logger.error("failed to append audit event %s for %s: %s", event_type, request_pda, e)


async def safe_sync_request(request_pda: str, tx_sig: str | None = None) -> dict | None:
    from app.chain import indexer

    try:
        return await indexer.sync_request(request_pda, tx_sig)
    except Exception as e:
        logger.warning("indexer.sync_request(%s) failed: %s", request_pda, e)
        return None


async def safe_sync_provider(owner: str | None) -> None:
    if not owner:
        return
    from app.chain import indexer

    try:
        await indexer.sync_provider(owner)
    except Exception as e:
        logger.warning("indexer.sync_provider(%s) failed: %s", owner, e)


def set_receipt_output(request_pda: str, output_uri: str, ipfs_cid: str | None) -> None:
    row: dict[str, Any] = {"request_pda": request_pda, "output_uri": output_uri}
    if ipfs_cid:
        row["output_ipfs_cid"] = ipfs_cid
    upsert("receipts", row, on_conflict="request_pda")


def chain_error_details(exc: BaseException) -> dict[str, Any]:
    logs = list(getattr(exc, "logs", None) or [])
    return {
        "error": str(exc)[:500],
        "code": getattr(exc, "code", None),
        "logs": [str(line)[:300] for line in logs[-10:]],
    }


# ---------------------------------------------------------------- status registry

_status_lock = threading.Lock()
_status: dict[str, dict[str, Any]] = {}


def _blank_status() -> dict[str, Any]:
    return {
        "running": False,
        "runs": 0,
        "last_run": None,
        "last_ok": None,
        "last_duration_ms": None,
        "last_result": None,
        "last_error": None,
        "last_error_at": None,
        "error_count": 0,
        "recent_errors": deque(maxlen=20),
    }


def _entry(job: str) -> dict[str, Any]:
    st = _status.get(job)
    if st is None:
        st = _blank_status()
        _status[job] = st
    return st


def job_started(job: str) -> None:
    with _status_lock:
        st = _entry(job)
        st["running"] = True
        st["last_run"] = utcnow_iso()


def job_finished(
    job: str,
    ok: bool,
    duration_s: float,
    result: Any = None,
    error: BaseException | str | None = None,
) -> None:
    with _status_lock:
        st = _entry(job)
        st["running"] = False
        st["runs"] += 1
        st["last_duration_ms"] = round(duration_s * 1000, 1)
        if ok:
            st["last_ok"] = utcnow_iso()
            st["last_result"] = _summarize(result)
    if not ok and error is not None:
        record_error(job, error)


def record_error(job: str, exc: BaseException | str, context: str | None = None) -> None:
    msg = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
    code = None if isinstance(exc, str) else getattr(exc, "code", None)
    if context:
        msg = f"{context}: {msg}"
    msg = msg[:1000]
    now = utcnow_iso()
    with _status_lock:
        st = _entry(job)
        st["last_error"] = msg
        st["last_error_at"] = now
        st["error_count"] += 1
        st["recent_errors"].append({"at": now, "error": msg, "code": code})
    logger.warning("[%s] %s", job, msg)


def _summarize(result: Any) -> Any:
    if result is None or isinstance(result, (bool, int, float, str)):
        return result
    if isinstance(result, dict):
        return {str(k): _summarize(v) for k, v in list(result.items())[:20]}
    if isinstance(result, (list, tuple)):
        return [_summarize(v) for v in list(result)[:20]]
    return str(result)[:200]


def status_snapshot() -> dict[str, dict[str, Any]]:
    with _status_lock:
        out: dict[str, dict[str, Any]] = {}
        for job, st in _status.items():
            d = dict(st)
            d["recent_errors"] = list(st["recent_errors"])
            out[job] = d
        return out


# ---------------------------------------------------------------- backoff


class Backoff:
    """Per-key exponential backoff: base * 2^(failures-1), capped."""

    def __init__(self, base: float = 10.0, cap: float = 300.0):
        self.base = base
        self.cap = cap
        self._state: dict[Any, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def ready(self, key: Any) -> bool:
        with self._lock:
            st = self._state.get(key)
        return st is None or time.time() >= st[1]

    def failure(self, key: Any) -> int:
        with self._lock:
            n = self._state.get(key, (0, 0.0))[0] + 1
            delay = min(self.cap, self.base * (2 ** (n - 1)))
            self._state[key] = (n, time.time() + delay)
            if len(self._state) > 5000:  # bound memory
                oldest = sorted(self._state.items(), key=lambda kv: kv[1][1])[:1000]
                for k, _ in oldest:
                    self._state.pop(k, None)
            return n

    def success(self, key: Any) -> None:
        with self._lock:
            self._state.pop(key, None)
