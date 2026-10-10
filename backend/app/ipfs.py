"""IPFS pinning via Pinata (optional). All failures are logged and swallowed."""
import json
import logging
from typing import Any

import httpx

from app.config import settings
from app.utils import canonical

log = logging.getLogger("verity.ipfs")

PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"
DEFAULT_GATEWAY = "gateway.pinata.cloud"
TIMEOUT_SECS = 20.0


def _auth_headers() -> dict[str, str] | None:
    if settings.pinata_jwt:
        return {"Authorization": f"Bearer {settings.pinata_jwt}"}
    if settings.pinata_api_key and settings.pinata_api_secret:
        return {
            "pinata_api_key": settings.pinata_api_key,
            "pinata_secret_api_key": settings.pinata_api_secret,
        }
    return None


def is_configured() -> bool:
    return _auth_headers() is not None


def pin_bytes(data: bytes, name: str) -> str | None:
    """Pin raw bytes to IPFS; returns the CID or None if not configured / on failure."""
    headers = _auth_headers()
    if headers is None:
        return None
    try:
        with httpx.Client(timeout=TIMEOUT_SECS) as client:
            resp = client.post(
                PIN_FILE_URL,
                headers=headers,
                files={"file": (name, data, "application/octet-stream")},
                data={
                    "pinataMetadata": json.dumps({"name": name}),
                    "pinataOptions": json.dumps({"cidVersion": 1}),
                },
            )
        if resp.status_code >= 400:
            log.warning("pinata pin failed for %s: HTTP %s %s", name, resp.status_code, resp.text[:300])
            return None
        cid = resp.json().get("IpfsHash")
        if not cid:
            log.warning("pinata response for %s had no IpfsHash: %s", name, resp.text[:300])
            return None
        return cid
    except Exception as exc:  # network errors, JSON errors, ...
        log.warning("pinata pin error for %s: %s", name, exc)
        return None


def pin_json(obj: Any, name: str) -> str | None:
    """Pin the canonical JSON encoding of `obj` (so the IPFS bytes hash to the same sha256)."""
    try:
        data = obj if isinstance(obj, (bytes, bytearray)) else canonical(obj)
    except Exception as exc:
        log.warning("pin_json could not encode %s: %s", name, exc)
        return None
    return pin_bytes(bytes(data), name)


def gateway_url(cid: str | None) -> str | None:
    if not cid:
        return None
    gw = (settings.pinata_gateway or DEFAULT_GATEWAY).strip().rstrip("/")
    if gw.startswith("http://") or gw.startswith("https://"):
        base = gw
    else:
        base = f"https://{gw}"
    if base.endswith("/ipfs"):
        base = base[: -len("/ipfs")]
    return f"{base}/ipfs/{cid}"
