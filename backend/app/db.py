"""Supabase access (service role): tables, storage blobs, chaos flags."""
import time
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import settings

BUCKET_PROGRAMS = "programs"
BUCKET_INPUTS = "inputs"
BUCKET_OUTPUTS = "outputs"


def trace_blob_path(request_pda: str) -> str:
    """Published TRACE_V2 document for a request (inside the outputs bucket)."""
    return f"{request_pda}.trace.json"


@lru_cache
def get_db() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def table(name: str):
    return get_db().table(name)


# ------------------------------------------------------------------ storage

def upload_blob(bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload (upsert) a blob and return its storage URI `bucket/path`."""
    get_db().storage.from_(bucket).upload(
        path, data, {"content-type": content_type, "upsert": "true"}
    )
    return f"{bucket}/{path}"


def download_blob(uri: str) -> bytes:
    """Download a blob given a `bucket/path` URI."""
    bucket, _, path = uri.partition("/")
    return get_db().storage.from_(bucket).download(path)


def public_url(uri: str | None) -> str | None:
    if not uri:
        return None
    bucket, _, path = uri.partition("/")
    return f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{path}"


# ------------------------------------------------------------------ helpers

def first(resp) -> dict[str, Any] | None:
    data = getattr(resp, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    return data


def upsert(name: str, row: dict[str, Any], on_conflict: str | None = None) -> None:
    q = table(name)
    (q.upsert(row, on_conflict=on_conflict) if on_conflict else q.upsert(row)).execute()


# ------------------------------------------------------------------ chaos flags

CHAOS_FLAGS = [
    "PROVIDER_TAMPER_OUTPUT",
    "PROVIDER_SWAP_PROGRAM",
    "STORAGE_TAMPER_INPUT",
    "STORAGE_TAMPER_OUTPUT",
    "PROVIDER_BAD_SIG",
    "VERIFIER_LAZY",
    "ZK_CORRUPT_PROOF",
]

import logging
import threading

_log = logging.getLogger("verity.db")
_chaos_lock = threading.Lock()
_chaos_state: dict[str, bool] = {flag: False for flag in CHAOS_FLAGS}
# Flags live in memory (read on every worker tick) and are written through to the
# chaos_flags table; they are loaded back from it once per process so a restart
# keeps whatever an operator armed.
_chaos_loaded = False
_CHAOS_RETRY_SECS = 30.0
_chaos_next_try = 0.0


def load_chaos_flags(force: bool = False) -> bool:
    """Load persisted flags from the chaos_flags table. Returns True once loaded."""
    global _chaos_loaded, _chaos_next_try
    if _chaos_loaded and not force:
        return True
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return False
    if not force and time.monotonic() < _chaos_next_try:
        return False
    try:
        rows = table("chaos_flags").select("name,enabled").execute().data or []
    except Exception as e:  # noqa: BLE001 - DB unreachable: keep in-memory defaults, retry later
        _chaos_next_try = time.monotonic() + _CHAOS_RETRY_SECS
        _log.warning("could not load chaos flags (keeping in-memory state): %s", e)
        return False
    with _chaos_lock:
        for r in rows:
            if r.get("name") in _chaos_state:
                _chaos_state[r["name"]] = bool(r.get("enabled"))
        _chaos_loaded = True
    armed = [n for n, on in _chaos_state.items() if on]
    if armed:
        _log.warning("chaos flags restored from database: %s", ", ".join(armed))
    return True


def get_chaos_flags(max_age: float = 0.0) -> dict[str, bool]:
    load_chaos_flags()
    with _chaos_lock:
        return dict(_chaos_state)


def chaos(name: str) -> bool:
    load_chaos_flags()
    with _chaos_lock:
        return bool(_chaos_state.get(name, False))


def set_chaos_flag(name: str, enabled: bool) -> None:
    from app.utils import utcnow_iso

    # Load first, so a later lazy load cannot overwrite this change with stale rows.
    load_chaos_flags()
    with _chaos_lock:
        _chaos_state[name] = enabled
    try:
        upsert("chaos_flags", {"name": name, "enabled": enabled, "updated_at": utcnow_iso()})
    except Exception as e:  # noqa: BLE001 - the in-memory flag still applies to this process
        _log.warning("could not persist chaos flag %s=%s: %s", name, enabled, e)

